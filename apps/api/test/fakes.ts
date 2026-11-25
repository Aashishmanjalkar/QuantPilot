import { randomUUID } from "node:crypto";
import { strategySchema, type BacktestResult, type Strategy } from "@quantpilot/shared";
import type { QuantClient } from "../src/quantClient";
import type { RunStore, RunView } from "../src/store";

export const validStrategy = {
  name: "RSI mean reversion",
  ticker: "DEMO",
  start_date: "2022-01-01",
  end_date: "2023-12-31",
  initial_capital: 10000,
  entry: { period: 14, operator: "below", threshold: 35 },
  exit: { period: 14, operator: "above", threshold: 60 },
};

export const sampleResult: BacktestResult = {
  schema_version: 1,
  ticker: "DEMO",
  start_date: "2022-01-03",
  end_date: "2022-01-04",
  bars: 2,
  metrics: {
    total_return_pct: 1,
    cagr_pct: 1,
    sharpe: null,
    max_drawdown_pct: 0,
    num_trades: 0,
    win_rate_pct: null,
    exposure_pct: 0,
    total_costs: 0,
    benchmark_total_return_pct: 2,
  },
  trades: [],
  equity_curve: [
    { date: "2022-01-03", equity: 10000, benchmark: 10000 },
    { date: "2022-01-04", equity: 10100, benchmark: 10200 },
  ],
  assumptions: {
    fill: "next_bar_open",
    price_adjustment: "split_and_dividend_adjusted",
    commission_bps: 5,
    slippage_bps: 5,
    benchmark: "buy_and_hold_same_ticker",
    data_source: "fixture",
    warmup_bars: 0,
    open_position_valuation: "last_close_before_exit_costs",
  },
};

export function memoryStore(): RunStore & { runs: Map<string, RunView> } {
  const runs = new Map<string, RunView>();
  const patch = (id: string, p: Partial<RunView>) => {
    const run = runs.get(id);
    if (!run) throw new Error("missing run");
    runs.set(id, { ...run, ...p, updatedAt: new Date().toISOString() });
  };
  return {
    runs,
    async createRun(strategy: Strategy) {
      const now = new Date().toISOString();
      const run: RunView = {
        id: randomUUID(),
        status: "queued",
        progress: 0,
        strategy,
        result: null,
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      runs.set(run.id, run);
      return run;
    },
    async getRun(id) {
      return runs.get(id) ?? null;
    },
    async markRunning(id, progress) {
      patch(id, { status: "running", progress, error: null });
    },
    async setProgress(id, progress) {
      patch(id, { progress });
    },
    async markCompleted(id, result) {
      patch(id, { status: "completed", progress: 100, result, error: null });
    },
    async markFailed(id, error) {
      if (runs.get(id)?.status !== "completed") patch(id, { status: "failed", error });
    },
    async failIfUnfinished(id, error) {
      const status = runs.get(id)?.status;
      if (status === "queued" || status === "running") patch(id, { status: "failed", error });
    },
  };
}

export function fakeQuant(overrides: Partial<QuantClient> = {}): QuantClient {
  return {
    async validate(strategy) {
      return strategySchema.parse(strategy);
    },
    async backtest() {
      return sampleResult;
    },
    ...overrides,
  };
}
