import type { StrategyInput } from "@quantpilot/shared";

/** Raw form field values (strings, as the inputs hold them). */
export interface StrategyFormValues {
  name: string;
  ticker: string;
  startDate: string;
  endDate: string;
  initialCapital: string;
  rsiPeriod: string;
  entryBelow: string;
  exitAbove: string;
  commissionBps: string;
  slippageBps: string;
}

export const defaultFormValues: StrategyFormValues = {
  name: "RSI mean reversion",
  ticker: "AAPL",
  startDate: "2020-01-01",
  endDate: "2024-12-31",
  initialCapital: "10000",
  rsiPeriod: "14",
  entryBelow: "30",
  exitAbove: "70",
  commissionBps: "5",
  slippageBps: "5",
};

/**
 * Maps the fixed RSI form to a strategy definition. The schema (owned by
 * services/quant) and the API do the validation; this only converts types.
 */
export function formToStrategy(v: StrategyFormValues): StrategyInput {
  const period = toNumber(v.rsiPeriod);
  return {
    schema_version: 1,
    name: v.name.trim(),
    ticker: v.ticker.trim().toUpperCase(),
    start_date: v.startDate,
    end_date: v.endDate,
    initial_capital: toNumber(v.initialCapital),
    entry: { indicator: "rsi", period, operator: "below", threshold: toNumber(v.entryBelow) },
    exit: { indicator: "rsi", period, operator: "above", threshold: toNumber(v.exitAbove) },
    position_sizing: { kind: "fraction_of_equity", fraction: 1 },
    costs: {
      commission_bps: toNumber(v.commissionBps),
      slippage_bps: toNumber(v.slippageBps),
    },
  };
}

function toNumber(value: string): number {
  // Empty or non-numeric input becomes NaN, which schema validation rejects with a field error.
  return value.trim() === "" ? Number.NaN : Number(value);
}

/** Maps API error paths (e.g. "strategy.entry.threshold") to form labels. */
const FIELD_LABELS: Record<string, string> = {
  "strategy.name": "Name",
  "strategy.ticker": "Ticker",
  "strategy.start_date": "Start date",
  "strategy.end_date": "End date",
  "strategy.initial_capital": "Initial capital",
  "strategy.entry.period": "RSI period",
  "strategy.exit.period": "RSI period",
  "strategy.entry.threshold": "Buy when RSI below",
  "strategy.exit.threshold": "Sell when RSI above",
  "strategy.costs.commission_bps": "Commission (bps)",
  "strategy.costs.slippage_bps": "Slippage (bps)",
  strategy: "Strategy",
};

export function fieldLabel(path: string): string {
  return FIELD_LABELS[path] ?? path;
}
