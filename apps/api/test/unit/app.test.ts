import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { QuantError } from "../../src/quantClient";
import { fakeQuant, memoryStore, validStrategy } from "../fakes";

function setup(overrides: Parameters<typeof fakeQuant>[0] = {}, enqueueFails = false) {
  const store = memoryStore();
  const enqueue = vi.fn(async (_runId: string) => {
    if (enqueueFails) throw new Error("redis down");
  });
  const app = createApp({
    store,
    quant: fakeQuant(overrides),
    queue: { enqueue },
    corsOrigin: "http://localhost:3000",
  });
  return { app, store, enqueue };
}

describe("POST /api/backtests", () => {
  it("stores a queued run with schema defaults and enqueues it", async () => {
    const { app, store, enqueue } = setup();
    const res = await request(app).post("/api/backtests").send({ strategy: validStrategy });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("queued");
    expect(res.headers.location).toBe(`/api/backtests/${res.body.id}`);
    expect(res.body.strategy.costs).toEqual({ commission_bps: 5, slippage_bps: 5 });
    expect(enqueue).toHaveBeenCalledWith(res.body.id);
    expect(store.runs.size).toBe(1);
  });

  it("rejects a structurally invalid strategy with field paths and stores nothing", async () => {
    const { app, store, enqueue } = setup();
    const res = await request(app)
      .post("/api/backtests")
      .send({ strategy: { ...validStrategy, entry: { period: 1, operator: "sideways" } } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("validation_error");
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(
      expect.arrayContaining(["strategy.entry.period", "strategy.entry.operator"]),
    );
    expect(store.runs.size).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("passes on semantic validation errors from the quant service", async () => {
    const { app, store } = setup({
      validate: async () => {
        throw new QuantError("Strategy is invalid", 422, "validation_error", false, [
          { path: "", message: "Value error, end_date must be after start_date" },
        ]);
      },
    });
    const res = await request(app).post("/api/backtests").send({ strategy: validStrategy });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0]).toEqual({
      path: "strategy",
      message: "Value error, end_date must be after start_date",
    });
    expect(store.runs.size).toBe(0);
  });

  it("returns 503 when the quant service cannot validate", async () => {
    const { app } = setup({
      validate: async () => {
        throw new QuantError("Quant service is unavailable", null, "quant_unavailable", true);
      },
    });
    const res = await request(app).post("/api/backtests").send({ strategy: validStrategy });
    expect(res.status).toBe(503);
  });

  it("marks the run failed and returns 503 when enqueueing fails", async () => {
    const { app, store } = setup({}, true);
    const res = await request(app).post("/api/backtests").send({ strategy: validStrategy });
    expect(res.status).toBe(503);
    expect([...store.runs.values()][0]?.status).toBe("failed");
  });

  it("rejects malformed JSON with 400", async () => {
    const { app } = setup();
    const res = await request(app)
      .post("/api/backtests")
      .set("content-type", "application/json")
      .send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
  });
});

describe("GET /api/backtests/:id", () => {
  it("returns a stored run", async () => {
    const { app } = setup();
    const created = await request(app).post("/api/backtests").send({ strategy: validStrategy });
    const res = await request(app).get(`/api/backtests/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
  });

  it("returns 404 for an unknown run", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/backtests/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });
});
