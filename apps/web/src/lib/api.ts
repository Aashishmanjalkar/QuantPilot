import { backtestResultSchema, strategySchema, type StrategyInput } from "@quantpilot/shared";
import { z } from "zod";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// QP-STD-002: API responses are validated before the UI trusts them.
export const runSchema = z.object({
  id: z.string(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  progress: z.number(),
  strategy: strategySchema,
  result: backtestResultSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Run = z.infer<typeof runSchema>;

const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof errorSchema>["error"];

export class ApiError extends Error {
  constructor(readonly body: ApiErrorBody) {
    super(body.message);
  }
}

async function parseResponse<T extends z.ZodTypeAny>(
  res: Response,
  schema: T,
): Promise<z.output<T>> {
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = errorSchema.safeParse(json);
    throw new ApiError(
      err.success
        ? err.data.error
        : { code: "http_error", message: `Request failed (${res.status})` },
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError({ code: "bad_response", message: "Unexpected response from the server" });
  }
  return parsed.data;
}

export async function createBacktest(strategy: StrategyInput): Promise<Run> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/backtests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ strategy }),
    });
  } catch {
    throw new ApiError({ code: "network_error", message: "Cannot reach the QuantPilot API" });
  }
  return parseResponse(res, runSchema);
}

export async function getBacktest(id: string): Promise<Run> {
  const res = await fetch(`${API_URL}/api/backtests/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  return parseResponse(res, runSchema);
}

const socketMessage = z.object({ type: z.literal("run"), run: runSchema });

/** Subscribes to run updates. Returns an unsubscribe function. */
export function watchBacktest(
  id: string,
  onRun: (run: Run) => void,
  onClose: (cleanEnd: boolean) => void,
): () => void {
  const url = `${API_URL.replace(/^http/, "ws")}/ws?runId=${encodeURIComponent(id)}`;
  const ws = new WebSocket(url);
  let terminal = false;
  ws.onmessage = (event) => {
    let data: unknown = null;
    try {
      data = JSON.parse(String(event.data));
    } catch {
      // handled below as an invalid message
    }
    const parsed = socketMessage.safeParse(data);
    if (!parsed.success) {
      // Unexpected shape: close (unclean) so the caller falls back to the HTTP read,
      // which reports the problem instead of waiting forever.
      ws.close();
      return;
    }
    const run = parsed.data.run;
    if (run.status === "completed" || run.status === "failed") terminal = true;
    onRun(run);
  };
  ws.onclose = () => onClose(terminal);
  return () => ws.close();
}
