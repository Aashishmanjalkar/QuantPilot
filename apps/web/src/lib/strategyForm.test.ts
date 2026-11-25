import { strategySchema } from "@quantpilot/shared";
import { describe, expect, it } from "vitest";
import { defaultFormValues, fieldLabel, formToStrategy } from "./strategyForm";
import { pct } from "./format";

describe("formToStrategy", () => {
  it("maps the default form to a schema-valid strategy", () => {
    const s = formToStrategy(defaultFormValues);
    const parsed = strategySchema.parse(s);
    expect(parsed.entry).toEqual({
      indicator: "rsi",
      period: 14,
      operator: "below",
      threshold: 30,
    });
    expect(parsed.exit).toEqual({ indicator: "rsi", period: 14, operator: "above", threshold: 70 });
    expect(parsed.costs).toEqual({ commission_bps: 5, slippage_bps: 5 });
  });

  it("normalizes the ticker", () => {
    expect(formToStrategy({ ...defaultFormValues, ticker: " reliance.ns " }).ticker).toBe(
      "RELIANCE.NS",
    );
  });

  it("turns blank numbers into values the schema rejects", () => {
    const s = formToStrategy({ ...defaultFormValues, initialCapital: "" });
    const result = strategySchema.safeParse(s);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["initial_capital"]);
  });
});

describe("helpers", () => {
  it("labels API error paths", () => {
    expect(fieldLabel("strategy.entry.threshold")).toBe("Buy when RSI below");
    expect(fieldLabel("strategy.unknown")).toBe("strategy.unknown");
  });

  it("formats signed percentages", () => {
    expect(pct(12.345)).toBe("+12.35%");
    expect(pct(-3)).toBe("-3.00%");
    expect(pct(null)).toBe("—");
  });
});
