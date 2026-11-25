import { Queue, QueueEvents, UnrecoverableError, Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  BACKTEST_QUEUE,
  LOST_JOB_MESSAGE,
  PermanentJobError,
  processBacktest,
  type BacktestJobData,
} from "./backtestJob";
import type { QuantClient } from "./quantClient";
import type { RunStore } from "./store";

export interface Enqueuer {
  enqueue(runId: string): Promise<void>;
}

/** Notifies subscribers that a run changed; listeners re-read the run from the store. */
export interface RunEvents {
  subscribe(runId: string, listener: () => void): () => void;
}

const MAX_ATTEMPTS = 2;

/**
 * BullMQ classes are EventEmitters; an `error` event without a listener crashes the
 * process (e.g. on a Redis reconnect). Logged: error name and message (ioredis messages
 * name host:port, never credentials; QP-STD-006).
 */
function logErrors(name: string, emitter: { on(event: "error", fn: (e: Error) => void): unknown }) {
  emitter.on("error", (err: Error) => console.error(`${name} error: ${err.name}: ${err.message}`));
}

export function redisConnection(url: string): Redis {
  // BullMQ requires maxRetriesPerRequest: null for blocking connections.
  const redis = new Redis(url, { maxRetriesPerRequest: null });
  logErrors("redis", redis);
  return redis;
}

export function createQueue(
  connection: Redis,
  options: { backoffMs?: number } = {},
): Queue<BacktestJobData> & Enqueuer {
  const queue = new Queue<BacktestJobData>(BACKTEST_QUEUE, { connection });
  logErrors("queue", queue);
  return Object.assign(queue, {
    async enqueue(runId: string) {
      await queue.add(
        "backtest",
        { runId },
        {
          jobId: runId,
          attempts: MAX_ATTEMPTS,
          backoff: { type: "exponential", delay: options.backoffMs ?? 2_000 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );
    },
  });
}

export function createWorker(
  connection: Redis,
  deps: { store: RunStore; quant: QuantClient },
): Worker<BacktestJobData> {
  const worker = new Worker<BacktestJobData>(
    BACKTEST_QUEUE,
    async (job) => {
      try {
        await processBacktest(
          {
            runId: job.data.runId,
            attempt: job.attemptsMade + 1,
            maxAttempts: job.opts.attempts ?? 1,
            reportProgress: async (p) => {
              await deps.store.setProgress(job.data.runId, p);
              await job.updateProgress(p);
            },
          },
          deps,
        );
      } catch (err) {
        if (err instanceof PermanentJobError) throw new UnrecoverableError(err.message);
        throw err;
      }
    },
    { connection, concurrency: 2 },
  );
  logErrors("worker", worker);
  return worker;
}

/**
 * Returns a handler for QueueEvents `failed`: if the job really ended in the failed state
 * (not waiting for a retry) and the run is still queued/running (e.g. BullMQ failed a
 * stalled job without calling the processor), mark the run failed.
 */
export function reconcileFailedJob(
  queue: Queue<BacktestJobData>,
  store: RunStore,
): (jobId: string) => Promise<void> {
  return async (jobId) => {
    const job = await queue.getJob(jobId);
    if (job && !(await job.isFailed())) return;
    await store.failIfUnfinished(jobId, LOST_JOB_MESSAGE);
  };
}

export function createRunEvents(
  connection: Redis,
  options: { onFailed?: (jobId: string) => Promise<void> } = {},
): RunEvents & { ready(): Promise<void>; close(): Promise<void> } {
  const events = new QueueEvents(BACKTEST_QUEUE, { connection });
  logErrors("queue events", events);
  const listeners = new Map<string, Set<() => void>>();
  const notify = ({ jobId }: { jobId: string }) => {
    for (const l of listeners.get(jobId) ?? []) l();
  };
  events.on("progress", notify);
  events.on("completed", notify);
  events.on("active", notify);
  events.on("failed", ({ jobId }) => {
    const reconcile = options.onFailed?.(jobId) ?? Promise.resolve();
    reconcile
      .catch((err: unknown) =>
        console.error(`reconcile ${jobId} failed: ${err instanceof Error ? err.name : "?"}`),
      )
      .finally(() => notify({ jobId }));
  });

  return {
    subscribe(runId, listener) {
      const set = listeners.get(runId) ?? new Set();
      set.add(listener);
      listeners.set(runId, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(runId);
      };
    },
    ready: async () => {
      await events.waitUntilReady();
    },
    close: () => events.close(),
  };
}
