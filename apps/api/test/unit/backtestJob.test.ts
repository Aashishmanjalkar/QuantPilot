import { strategySchema } from "@quantpilot/shared";
import { describe, expect, it, vi } from "vitest";
import { LOST_JOB_MESSAGE, PermanentJobError, processBacktest } from "../../src/backtestJob";
import { reconcileFailedJob } from "../../src/queue";
import { QuantError } from "../../src/quantClient";
import { fakeQuant, memoryStore, sampleResult, validStrategy } from "../fakes";

async function setup() {
  const store = memoryStore();
  const run = await store.createRun(strategySchema.parse(validStrategy));
  const progress: number[] = [];
  const job = (attempt = 1, maxAttempts = 2) => ({
    runId: run.id,
    attempt,
    maxAttempts,
    reportProgress: async (p: number) => {
      progress.push(p);
    },
  });
  return { store, run, progress, job };
}

describe("processBacktest", () => {
  it("runs queued -> running -> completed and stores the result", async () => {
    const { store, run, progress, job } = await setup();
    const backtest = vi.fn(async () => sampleResult);
    await processBacktest(job(), { store, quant: fakeQuant({ backtest }) });
    expect(backtest).toHaveBeenCalledWith(run.strategy);
    expect(progress).toEqual([10, 100]);
    const done = await store.getRun(run.id);
    expect(done?.status).toBe("completed");
    expect(done?.result).toEqual(sampleResult);
  });

  it("fails permanently on a non-retryable quant error", async () => {
    const { store, run, job } = await setup();
    const quant = fakeQuant({
      backtest: async () => {
        throw new QuantError("no price data for DEMO", 422, "no_data", false);
      },
    });
    await expect(processBacktest(job(1, 2), { store, quant })).rejects.toBeInstanceOf(
      PermanentJobError,
    );
    const failed = await store.getRun(run.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("no price data for DEMO");
  });

  it("leaves a retryable failure for the queue, then fails on the last attempt", async () => {
    const { store, run, job } = await setup();
    const quant = fakeQuant({
      backtest: async () => {
        throw new QuantError("Quant service timed out", null, "quant_timeout", true);
      },
    });
    await expect(processBacktest(job(1, 2), { store, quant })).rejects.toBeInstanceOf(QuantError);
    expect((await store.getRun(run.id))?.status).toBe("running");

    await expect(processBacktest(job(2, 2), { store, quant })).rejects.toBeInstanceOf(
      PermanentJobError,
    );
    const failed = await store.getRun(run.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("Quant service timed out");
  });

  it("does not leak internal error text to the user (QP-STD-006)", async () => {
    const { store, run, job } = await setup();
    const quant = fakeQuant({
      backtest: async () => {
        throw new Error("connect ECONNREFUSED postgres://user:secret@db");
      },
    });
    await expect(processBacktest(job(2, 2), { store, quant })).rejects.toThrow();
    expect((await store.getRun(run.id))?.error).toBe("Backtest failed due to an internal error");
  });

  it("keeps a stored result when the final progress notification fails", async () => {
    const { store, run } = await setup();
    const job = {
      runId: run.id,
      attempt: 2,
      maxAttempts: 2,
      reportProgress: async (p: number) => {
        if (p === 100) throw new Error("redis down");
      },
    };
    await processBacktest(job, { store, quant: fakeQuant() });
    expect((await store.getRun(run.id))?.status).toBe("completed");
  });
});

describe("reconcileFailedJob", () => {
  type FakeJob = { isFailed(): Promise<boolean> } | undefined;
  const queueWith = (job: FakeJob) =>
    ({ getJob: async () => job }) as unknown as Parameters<typeof reconcileFailedJob>[0];

  it("fails a run whose job ended failed without the processor marking it", async () => {
    const { store, run } = await setup();
    await store.markRunning(run.id, 10);
    await reconcileFailedJob(queueWith({ isFailed: async () => true }), store)(run.id);
    expect(await store.getRun(run.id)).toMatchObject({ status: "failed", error: LOST_JOB_MESSAGE });
  });

  it("leaves a run alone while its job waits for a retry", async () => {
    const { store, run } = await setup();
    await store.markRunning(run.id, 10);
    await reconcileFailedJob(queueWith({ isFailed: async () => false }), store)(run.id);
    expect((await store.getRun(run.id))?.status).toBe("running");
  });

  it("does not overwrite a completed or already-failed run", async () => {
    const { store, run } = await setup();
    await store.markFailed(run.id, "no price data for DEMO");
    await reconcileFailedJob(queueWith(undefined), store)(run.id);
    expect((await store.getRun(run.id))?.error).toBe("no price data for DEMO");
  });
});
