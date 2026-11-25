import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { strategySchema } from "@quantpilot/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createQuantClient, QuantError } from "../../src/quantClient";
import { sampleResult, validStrategy } from "../fakes";

let server: Server | undefined;
afterEach(async () => {
  await closeServer();
});

function closeServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server?.listening) return resolve();
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

function stub(status: number, body: unknown, delayMs = 0): Promise<string> {
  const s = createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    }, delayMs);
  });
  server = s;
  return new Promise((resolve) =>
    s.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`),
    ),
  );
}

const strategy = strategySchema.parse(validStrategy);

describe("quant client", () => {
  it("returns a validated backtest result", async () => {
    const client = createQuantClient(await stub(200, sampleResult), 5000);
    await expect(client.backtest(strategy)).resolves.toEqual(sampleResult);
  });

  it("rejects a malformed success response (QP-STD-002)", async () => {
    const client = createQuantClient(await stub(200, { bars: "lots" }), 5000);
    await expect(client.backtest(strategy)).rejects.toMatchObject({
      code: "quant_bad_response",
      retryable: false,
    });
  });

  it("maps 4xx to a non-retryable error with the quant message", async () => {
    const client = createQuantClient(
      await stub(422, { error: { code: "no_data", message: "no price data for DEMO" } }),
      5000,
    );
    const err = await client.backtest(strategy).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuantError);
    expect(err).toMatchObject({
      status: 422,
      code: "no_data",
      message: "no price data for DEMO",
      retryable: false,
    });
  });

  it("maps 5xx to a retryable error", async () => {
    const client = createQuantClient(await stub(502, { nope: true }), 5000);
    await expect(client.backtest(strategy)).rejects.toMatchObject({ retryable: true });
  });

  it("maps a timeout to a retryable error", async () => {
    const client = createQuantClient(await stub(200, sampleResult, 500), 50);
    await expect(client.backtest(strategy)).rejects.toMatchObject({
      code: "quant_timeout",
      retryable: true,
    });
  });
});
