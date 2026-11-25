import { describe, expect, it } from "vitest";
import { strategySchema } from "../src";

const minimal = {
  name: "x",
  ticker: "AAPL",
  start_date: "2020-01-01",
  end_date: "2021-01-01",
  initial_capital: 1000,
  entry: { period: 14, operator: "below", threshold: 30 },
  exit: { period: 14, operator: "above", threshold: 70 },
};

describe("generated strategy schema", () => {
  it("applies the explicit non-zero cost defaults (QP-STD-004)", () => {
    const s = strategySchema.parse(minimal);
    expect(s.costs).toEqual({ commission_bps: 5, slippage_bps: 5 });
    expect(s.schema_version).toBe(1);
  });

  it("rejects unknown fields and bad values", () => {
    expect(strategySchema.safeParse({ ...minimal, extra: 1 }).success).toBe(false);
    expect(strategySchema.safeParse({ ...minimal, ticker: "aapl" }).success).toBe(false);
    expect(
      strategySchema.safeParse({ ...minimal, entry: { ...minimal.entry, period: 1 } }).success,
    ).toBe(false);
  });
});
