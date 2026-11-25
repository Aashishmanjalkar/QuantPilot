import { strategySchema } from "@quantpilot/shared";
import cors from "cors";
import express, { type Express } from "express";
import { z } from "zod";
import { errorHandler, HttpError, zodDetails } from "./errors";
import type { Enqueuer } from "./queue";
import { QuantError, type QuantClient } from "./quantClient";
import type { RunStore } from "./store";

export interface AppDeps {
  store: RunStore;
  quant: QuantClient;
  queue: Enqueuer;
  corsOrigin: string;
}

const createBody = z.object({ strategy: z.unknown() }).strict();

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: deps.corsOrigin }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/backtests", async (req, res) => {
    // QP-STD-002: structural validation with the generated schema...
    const body = createBody.safeParse(req.body);
    if (!body.success) {
      throw new HttpError(422, "validation_error", "Request is invalid", zodDetails(body.error));
    }
    const shape = strategySchema.safeParse(body.data.strategy);
    if (!shape.success) {
      throw new HttpError(422, "validation_error", "Strategy is invalid", prefix(shape.error));
    }
    // ...then semantic validation by the schema owner (ADR-0002), e.g. date order.
    let strategy;
    try {
      strategy = await deps.quant.validate(shape.data);
    } catch (err) {
      if (err instanceof QuantError && err.status === 422) {
        throw new HttpError(422, "validation_error", err.message, prefixDetails(err.details));
      }
      throw new HttpError(503, "quant_unavailable", "Strategy validation is unavailable");
    }

    const run = await deps.store.createRun(strategy);
    try {
      await deps.queue.enqueue(run.id);
    } catch {
      await deps.store.markFailed(run.id, "Could not queue the backtest");
      throw new HttpError(503, "queue_unavailable", "Could not queue the backtest");
    }
    res.status(202).location(`/api/backtests/${run.id}`).json(run);
  });

  app.get("/api/backtests/:id", async (req, res) => {
    const run = await deps.store.getRun(req.params.id);
    if (!run) throw new HttpError(404, "not_found", "Backtest not found");
    res.json(run);
  });

  app.use((_req, _res, next) => next(new HttpError(404, "not_found", "Route not found")));
  app.use(errorHandler);
  return app;
}

function prefix(error: z.ZodError) {
  return zodDetails(error).map((d) => ({ ...d, path: d.path ? `strategy.${d.path}` : "strategy" }));
}

function prefixDetails(details: { path: string; message: string }[] | undefined) {
  return details?.map((d) => ({ ...d, path: d.path ? `strategy.${d.path}` : "strategy" }));
}
