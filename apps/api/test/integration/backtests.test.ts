import { createServer, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { strategySchema } from "@quantpilot/shared";
import type { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp } from "../../src/app";
import type { BacktestJobData } from "../../src/backtestJob";
import {
  createQueue,
  createRunEvents,
  createWorker,
  reconcileFailedJob,
  redisConnection,
  type Enqueuer,
} from "../../src/queue";
import { createQuantClient } from "../../src/quantClient";
import { createPrismaStore, type RunView } from "../../src/store";
import { attachRunSocket } from "../../src/ws";
import { sampleResult, validStrategy } from "../fakes";
import { TEST_DATABASE_URL, TEST_REDIS_URL } from "./setup";

/**
 * Stub of services/quant: validates with the shared schema. Tickers select behavior:
 * NODATA -> 422 no_data; FLAKY -> 500 on the first /backtest call, then 200;
 * DOWN -> always 500; anything else -> 200.
 */
function startQuantStub(): Promise<{
  server: Server;
  url: string;
  calls: string[];
  backtestTickers: string[];
}> {
  const calls: string[] = [];
  const backtestTickers: string[] = [];
  let flakyFailed = false;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      calls.push(req.url ?? "");
      const body: unknown = JSON.parse(raw);
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url === "/strategies/validate") return send(200, strategySchema.parse(body));
      const ticker = (body as { strategy: { ticker: string } }).strategy.ticker;
      backtestTickers.push(ticker);
      if (ticker === "NODATA") {
        return send(422, { error: { code: "no_data", message: "no price data for NODATA" } });
      }
      if (ticker === "DOWN" || (ticker === "FLAKY" && !flakyFailed)) {
        if (ticker === "FLAKY") flakyFailed = true;
        return send(500, { error: { code: "internal_error", message: "boom" } });
      }
      return send(200, { ...sampleResult, ticker });
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        server,
        calls,
        backtestTickers,
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      }),
    ),
  );
}

let prisma: PrismaClient;
let api: Server;
let apiUrl: string;
let quantStub: Awaited<ReturnType<typeof startQuantStub>>;
let conns: Redis[];
let queue: Queue<BacktestJobData> & Enqueuer;
let worker: Worker<BacktestJobData>;
let events: ReturnType<typeof createRunEvents>;
let store: ReturnType<typeof createPrismaStore>;

beforeAll(async () => {
  prisma = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
  quantStub = await startQuantStub();
  conns = [0, 1, 2].map(() => redisConnection(TEST_REDIS_URL));
  const [qc, wc, ec] = conns as [Redis, Redis, Redis];
  store = createPrismaStore(prisma);
  const quant = createQuantClient(quantStub.url, 5000);
  queue = createQueue(qc, { backoffMs: 200 });
  worker = createWorker(wc, { store, quant });
  events = createRunEvents(ec, { onFailed: reconcileFailedJob(queue, store) });
  await events.ready();
  api = createServer(createApp({ store, quant, queue, corsOrigin: "http://localhost:3000" }));
  attachRunSocket(api, { store, events });
  await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
  apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await worker?.close();
  await Promise.allSettled([queue?.close(), events?.close()]);
  conns?.forEach((c) => c.disconnect());
  await new Promise<void>((r) => api?.close(() => r()));
  await new Promise<void>((r) => quantStub?.server.close(() => r()));
  await prisma?.$disconnect();
});

/** Collects WebSocket run snapshots until the server closes the socket. */
function watchRun(runId: string): Promise<RunView[]> {
  return new Promise((resolve, reject) => {
    const seen: RunView[] = [];
    const ws = new WebSocket(`${apiUrl.replace("http", "ws")}/ws?runId=${runId}`);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`timed out; saw ${seen.map((r) => r.status).join(",")}`));
    }, 20_000);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as { type: string; run: RunView };
      seen.push(msg.run);
    });
    ws.on("close", () => {
      clearTimeout(timer);
      resolve(seen);
    });
    ws.on("error", reject);
  });
}

describe("backtest flow against Postgres + Redis", () => {
  it("QP-IT-001 POST /api/backtests stores, queues, runs, and pushes completion over WebSocket", async () => {
    const res = await request(api).post("/api/backtests").send({ strategy: validStrategy });
    expect(res.status).toBe(202);
    const runId: string = res.body.id;

    const snapshots = await watchRun(runId);
    const last = snapshots.at(-1);
    expect(last?.status).toBe("completed");
    expect(last?.result?.ticker).toBe("DEMO");

    const row = await prisma.backtestRun.findUniqueOrThrow({
      where: { id: runId },
      include: { strategy: true },
    });
    expect(row.status).toBe("completed");
    expect(row.progress).toBe(100);
    expect(row.result).toEqual(sampleResult);
    expect(row.strategy.name).toBe(validStrategy.name);
    expect(row.strategy.definition).toMatchObject({
      ticker: "DEMO",
      costs: { commission_bps: 5, slippage_bps: 5 },
    });
    expect(quantStub.calls).toContain("/backtest");
  });

  it("QP-IT-002 an invalid strategy is rejected with 422 and nothing is stored", async () => {
    const before = await prisma.backtestRun.count();
    const res = await request(api)
      .post("/api/backtests")
      .send({ strategy: { ...validStrategy, initial_capital: -5 } });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].path).toBe("strategy.initial_capital");
    expect(await prisma.backtestRun.count()).toBe(before);
  });

  it("QP-IT-003 a quant input error fails the run with a user-facing message", async () => {
    const res = await request(api)
      .post("/api/backtests")
      .send({ strategy: { ...validStrategy, ticker: "NODATA" } });
    expect(res.status).toBe(202);
    const snapshots = await watchRun(res.body.id);
    expect(snapshots.at(-1)).toMatchObject({
      status: "failed",
      error: "no price data for NODATA",
    });
    const row = await prisma.backtestRun.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.status).toBe("failed");
    expect(row.result).toBeNull();
  });

  it("QP-IT-004 GET /api/backtests/:id returns the persisted run", async () => {
    const created = await request(api).post("/api/backtests").send({ strategy: validStrategy });
    await watchRun(created.body.id);
    const res = await request(api).get(`/api/backtests/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.body.id, status: "completed", progress: 100 });
    expect(res.body.result.metrics.total_return_pct).toBe(1);
  });

  it("QP-IT-005 a retryable quant failure is retried and the run completes", async () => {
    const res = await request(api)
      .post("/api/backtests")
      .send({ strategy: { ...validStrategy, ticker: "FLAKY" } });
    expect(res.status).toBe(202);
    const snapshots = await watchRun(res.body.id);
    expect(snapshots.at(-1)).toMatchObject({ status: "completed", error: null });
    expect(snapshots.some((r) => r.status === "failed")).toBe(false);
    expect(quantStub.backtestTickers.filter((t) => t === "FLAKY")).toHaveLength(2);
  });

  it("QP-IT-006 retries are exhausted and the run fails with a user-facing message", async () => {
    const res = await request(api)
      .post("/api/backtests")
      .send({ strategy: { ...validStrategy, ticker: "DOWN" } });
    const snapshots = await watchRun(res.body.id);
    expect(snapshots.at(-1)).toMatchObject({ status: "failed", error: "boom" });
    const job = await queue.getJob(res.body.id);
    expect(job?.attemptsMade).toBe(2);
    expect(await job?.isFailed()).toBe(true);
  });

  it("QP-IT-007 a malformed WebSocket frame does not crash the API", async () => {
    // A run with no job stays queued, so the socket stays open until the bad frame.
    const run = { body: await store.createRun(strategySchema.parse(validStrategy)) };
    const { port } = api.address() as AddressInfo;
    const closedBy = await new Promise<"server" | "timeout">((resolve, reject) => {
      const sock = connect(port, "127.0.0.1", () => {
        sock.write(
          [
            `GET /ws?runId=${run.body.id} HTTP/1.1`,
            "Host: 127.0.0.1",
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version: 13",
            "",
            "",
          ].join("\r\n"),
        );
      });
      sock.once("data", () => {
        // Unmasked client text frame: a protocol error the server must survive.
        sock.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));
      });
      sock.on("close", () => resolve("server"));
      sock.on("error", reject);
      setTimeout(() => {
        resolve("timeout");
        sock.destroy();
      }, 3000);
    });
    // The server dropped the misbehaving connection and kept serving.
    expect(closedBy).toBe("server");
    const health = await request(api).get("/health");
    expect(health.status).toBe(200);
  });
});
