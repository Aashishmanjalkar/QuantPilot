export { strategySchema, type Strategy } from "./generated/strategy";
export { backtestResultSchema, type BacktestResult } from "./generated/backtest-result";
export type { z } from "zod";

/** Input type of the strategy schema: fields with defaults are optional. */
export type StrategyInput = import("zod").input<
  typeof import("./generated/strategy").strategySchema
>;
