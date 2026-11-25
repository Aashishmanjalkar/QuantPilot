import type { PrismaClient } from "@prisma/client";
import type { BacktestResult, Strategy } from "@quantpilot/shared";

export type RunStatus = "queued" | "running" | "completed" | "failed";

export interface RunView {
  id: string;
  status: RunStatus;
  progress: number;
  strategy: Strategy;
  result: BacktestResult | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Persistence for strategies and backtest runs. */
export interface RunStore {
  createRun(strategy: Strategy): Promise<RunView>;
  getRun(id: string): Promise<RunView | null>;
  markRunning(id: string, progress: number): Promise<void>;
  setProgress(id: string, progress: number): Promise<void>;
  markCompleted(id: string, result: BacktestResult): Promise<void>;
  /** Marks the run failed unless it already completed. */
  markFailed(id: string, error: string): Promise<void>;
  /** Marks the run failed only if it is still queued or running (reconciliation). */
  failIfUnfinished(id: string, error: string): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPrismaStore(prisma: PrismaClient): RunStore {
  type Row = NonNullable<Awaited<ReturnType<typeof find>>>;
  const find = (id: string) =>
    prisma.backtestRun.findUnique({ where: { id }, include: { strategy: true } });

  // Rows were validated before they were written; JSON columns are read back as stored.
  const view = (row: Row): RunView => ({
    id: row.id,
    status: row.status,
    progress: row.progress,
    strategy: row.strategy.definition as unknown as Strategy,
    result: (row.result as unknown as BacktestResult | null) ?? null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });

  return {
    async createRun(strategy) {
      const run = await prisma.backtestRun.create({
        data: { strategy: { create: { name: strategy.name, definition: strategy } } },
        include: { strategy: true },
      });
      return view(run);
    },
    async getRun(id) {
      if (!UUID.test(id)) return null;
      const row = await find(id);
      return row ? view(row) : null;
    },
    async markRunning(id, progress) {
      await prisma.backtestRun.update({
        where: { id },
        data: { status: "running", progress, error: null },
      });
    },
    async setProgress(id, progress) {
      await prisma.backtestRun.update({ where: { id }, data: { progress } });
    },
    async markCompleted(id, result) {
      await prisma.backtestRun.update({
        where: { id },
        data: { status: "completed", progress: 100, result, error: null },
      });
    },
    async markFailed(id, error) {
      // Never overwrite a completed run.
      await prisma.backtestRun.updateMany({
        where: { id, status: { not: "completed" } },
        data: { status: "failed", error },
      });
    },
    async failIfUnfinished(id, error) {
      await prisma.backtestRun.updateMany({
        where: { id, status: { in: ["queued", "running"] } },
        data: { status: "failed", error },
      });
    },
  };
}
