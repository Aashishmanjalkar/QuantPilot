import {
  backtestResultSchema,
  strategySchema,
  type BacktestResult,
  type Strategy,
} from "@quantpilot/shared";
import { z } from "zod";
import type { ErrorDetail } from "./errors";

const quantErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

/** A failure talking to services/quant. `retryable` is false for caller-input errors. */
export class QuantError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string,
    readonly retryable: boolean,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
  }
}

export interface QuantClient {
  validate(strategy: unknown): Promise<Strategy>;
  backtest(strategy: Strategy): Promise<BacktestResult>;
}

export function createQuantClient(baseUrl: string, timeoutMs: number): QuantClient {
  async function post(path: string, body: unknown, timeout: number): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(new URL(path, baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      throw new QuantError(
        timedOut ? "Quant service timed out" : "Quant service is unavailable",
        null,
        timedOut ? "quant_timeout" : "quant_unavailable",
        true,
      );
    }
    const json: unknown = await res.json().catch(() => null);
    if (res.ok) return json;

    // QP-STD-002: quant responses are external input too.
    const parsed = quantErrorSchema.safeParse(json);
    const message = parsed.success
      ? parsed.data.error.message
      : `Quant service error ${res.status}`;
    const code = parsed.success ? parsed.data.error.code : "quant_error";
    const retryable = res.status >= 500 || res.status === 429;
    throw new QuantError(message, res.status, code, retryable, parsed.data?.error.details);
  }

  return {
    async validate(strategy) {
      const json = await post("/strategies/validate", strategy, Math.min(timeoutMs, 10_000));
      return parseOrThrow(strategySchema, json, "strategy");
    },
    async backtest(strategy) {
      const json = await post("/backtest", { strategy }, timeoutMs);
      return parseOrThrow(backtestResultSchema, json, "backtest result");
    },
  };
}

function parseOrThrow<T extends z.ZodTypeAny>(schema: T, json: unknown, what: string): z.output<T> {
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new QuantError(
      `Quant service returned an invalid ${what}`,
      200,
      "quant_bad_response",
      false,
    );
  }
  return parsed.data;
}
