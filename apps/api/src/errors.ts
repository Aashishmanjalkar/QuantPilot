import type { ErrorRequestHandler } from "express";
import type { ZodError } from "zod";

/** One JSON error shape for the API: {"error": {code, message, details?}}. */
export interface ErrorDetail {
  path: string;
  message: string;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
  }
}

export function zodDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }
  if (isBodyParseError(err)) {
    res.status(400).json({ error: { code: "bad_request", message: "Malformed JSON body" } });
    return;
  }
  console.error("unhandled error", err instanceof Error ? err.name : typeof err);
  res.status(500).json({ error: { code: "internal_error", message: "Internal server error" } });
};

function isBodyParseError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    (err as { type: unknown }).type === "entity.parse.failed"
  );
}
