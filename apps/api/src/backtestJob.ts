import type { QuantClient } from "./quantClient";
import { QuantError } from "./quantClient";
import type { RunStore } from "./store";

export const BACKTEST_QUEUE = "backtests";

export interface BacktestJobData {
  runId: string;
}

/** Queue-agnostic view of one job attempt. */
export interface JobAttempt {
  runId: string;
  /** 1-based number of this attempt. */
  attempt: number;
  maxAttempts: number;
  reportProgress(progress: number): Promise<void>;
}

/** Thrown when a failure must not be retried (caller input, bad data). */
export class PermanentJobError extends Error {}

/** Message stored when a job fails outside the processor (e.g. it stalled repeatedly). */
export const LOST_JOB_MESSAGE = "Backtest was interrupted; please run it again";

/**
 * Runs one backtest attempt: running -> quant /backtest -> completed.
 * On the final failed attempt (or a permanent error) the run is marked failed with a
 * user-facing message; otherwise the error is rethrown for the queue to retry.
 * Once the result is stored, later progress notifications are best-effort and can no
 * longer turn the run into a failure.
 */
export async function processBacktest(
  job: JobAttempt,
  deps: { store: RunStore; quant: QuantClient },
): Promise<void> {
  const run = await deps.store.getRun(job.runId);
  if (!run) throw new PermanentJobError(`run ${job.runId} not found`);
  if (run.status === "completed") return;

  try {
    await deps.store.markRunning(job.runId, 10);
    await job.reportProgress(10);
    const result = await deps.quant.backtest(run.strategy);
    await deps.store.markCompleted(job.runId, result);
  } catch (err) {
    const permanent = err instanceof QuantError ? !err.retryable : false;
    const lastAttempt = job.attempt >= job.maxAttempts;
    if (permanent || lastAttempt) {
      await deps.store.markFailed(job.runId, userMessage(err));
      throw new PermanentJobError(userMessage(err));
    }
    throw err;
  }

  await job.reportProgress(100).catch(() => undefined);
}

function userMessage(err: unknown): string {
  if (err instanceof QuantError) return err.message;
  return "Backtest failed due to an internal error";
}
