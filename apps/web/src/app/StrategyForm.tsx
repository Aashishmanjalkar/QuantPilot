"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, createBacktest, type ApiErrorBody } from "@/lib/api";
import {
  defaultFormValues,
  fieldLabel,
  formToStrategy,
  type StrategyFormValues,
} from "@/lib/strategyForm";

type Field = keyof StrategyFormValues;

interface InputSpec {
  field: Field;
  label: string;
  type: "text" | "date" | "number";
  hint?: string;
  step?: string;
}

const SECTIONS: { legend: string; inputs: InputSpec[] }[] = [
  {
    legend: "Instrument",
    inputs: [
      { field: "name", label: "Name", type: "text" },
      { field: "ticker", label: "Ticker", type: "text", hint: "e.g. AAPL or RELIANCE.NS" },
      { field: "startDate", label: "Start date", type: "date" },
      { field: "endDate", label: "End date", type: "date" },
      { field: "initialCapital", label: "Initial capital", type: "number", step: "any" },
    ],
  },
  {
    legend: "RSI rules",
    inputs: [
      { field: "rsiPeriod", label: "RSI period", type: "number", step: "1" },
      { field: "entryBelow", label: "Buy when RSI below", type: "number", step: "any" },
      { field: "exitAbove", label: "Sell when RSI above", type: "number", step: "any" },
    ],
  },
  {
    legend: "Costs",
    inputs: [
      {
        field: "commissionBps",
        label: "Commission (bps)",
        type: "number",
        step: "any",
        hint: "Per fill, of traded value",
      },
      {
        field: "slippageBps",
        label: "Slippage (bps)",
        type: "number",
        step: "any",
        hint: "Adverse, per fill",
      },
    ],
  },
];

export function StrategyForm() {
  const router = useRouter();
  const [values, setValues] = useState<StrategyFormValues>(defaultFormValues);
  const [error, setError] = useState<ApiErrorBody | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const run = await createBacktest(formToStrategy(values));
      router.push(`/backtests/${run.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.body : { code: "unknown", message: "Something went wrong" },
      );
      setSubmitting(false);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      {error && (
        <div className="error" role="alert">
          {error.message}
          {error.details && error.details.length > 0 && (
            <ul>
              {error.details.map((d, i) => (
                <li key={i}>
                  {fieldLabel(d.path)}: {d.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {SECTIONS.map((section) => (
        <fieldset key={section.legend}>
          <legend>{section.legend}</legend>
          <div className="form-grid">
            {section.inputs.map((input) => (
              <label key={input.field}>
                {input.label}
                <input
                  name={input.field}
                  type={input.type}
                  step={input.step}
                  value={values[input.field]}
                  onChange={(e) => setValues({ ...values, [input.field]: e.target.value })}
                />
                {input.hint && <span className="hint">{input.hint}</span>}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <button type="submit" disabled={submitting}>
        {submitting ? "Submitting…" : "Run backtest"}
      </button>
    </form>
  );
}
