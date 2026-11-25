# Architecture

Status: milestone 1 implemented (2026-11-23): all four modules exist and the main flow
below runs end to end for the fixed RSI form. Plain-English parsing, result explanation,
auth, and plan limits are not built yet. Update this file as modules land, and record
significant changes as ADRs.

## Purpose

QuantPilot lets a user describe a trading strategy in plain English, turns it into a
validated strategy definition, backtests it on historical market data with realistic
costs, and explains the result. It is a portfolio project, so clarity of design and
honest backtest methodology matter more than feature count.

## Modules

| Path | Tech | Responsibility | Talks to |
|---|---|---|---|
| `apps/web` | Next.js, TypeScript | UI: strategy input, saved strategies, results charts, job progress | `apps/api` (HTTP + WebSocket) |
| `apps/api` | Express, TypeScript, Prisma, BullMQ | Auth (JWT), users, saved strategies, plan limits, job queue, progress events. Public API surface. | Postgres, Redis, `services/quant` |
| `services/quant` | Python, FastAPI, Pydantic, pandas | Strategy schema (owner), NL→strategy parsing via LLM, market data, indicators, backtest engine, metrics, result explanation | Claude API, market data provider, Postgres/Redis (cache) |
| `packages/shared` | TypeScript | Generated strategy JSON Schema and TS types consumed by `apps/*` | — |

Infrastructure (Docker Compose): Postgres, Redis, the three services.

## Main flow (first milestone)

1. User submits a strategy (fixed RSI form at first; plain English later) to `apps/api`.
2. `apps/api` validates input, stores the strategy, enqueues a BullMQ backtest job.
3. A worker in `apps/api` calls `services/quant` `POST /backtest` with the strategy JSON.
4. `services/quant` loads (cached) OHLCV data, computes indicators, runs the vectorized
   engine, returns trades, equity curve, and metrics.
5. `apps/api` stores the result and pushes progress/completion over WebSocket.
6. `apps/web` renders the equity curve and metrics.

First milestone = steps 1–6 for one RSI strategy on one ticker, end to end.

### As built (milestone 1)

- `apps/api`: `POST /api/backtests` validates the body with the generated Zod schema, then
  asks `services/quant` `POST /strategies/validate` for semantic checks (for example date
  order) before storing anything; it returns `202` with the run. `GET /api/backtests/:id`
  returns the run. `GET /ws?runId=` sends `{"type":"run","run":...}` snapshots read from
  Postgres on connect and on each BullMQ event, then closes at `completed`/`failed`.
- The BullMQ worker runs inside the `apps/api` process (`RUN_WORKER=true`); two attempts for
  retryable failures (quant timeout/5xx), none for input errors (quant 4xx).
- `services/quant` endpoints: `GET /health`, `POST /strategies/validate`, `POST /backtest`.
  Market data comes from `yfinance` or, for tests and E2E, a fixture provider reading
  `services/quant/fixtures/bars/<TICKER>.csv` (synthetic `DEMO` ticker). Fetched bars are
  cached in Postgres table `quant_bar_cache`; the planned Redis lookup cache is not built.
- Engine: long-only, fractional shares, `fraction` of cash invested on entry; signal at bar
  t's close fills at bar t+1's open; an open position at the end is marked to the last close.
- Error shape for both services: `{"error": {"code", "message", "details"?: [{path, message}]}}`.
- No authentication yet: every run is anonymous. Do not expose the stack publicly.

## Boundaries and constraints

- `services/quant` is internal: not exposed publicly; only `apps/api` calls it.
- The strategy schema is defined once in Python ([ADR-0002](adr/0002-strategy-schema-ownership.md)).
- The LLM never executes code; it only produces strategy JSON that is schema-validated
  before use ([ADR-0003](adr/0003-llm-provider.md)).
- Market data goes through a `DataProvider` interface ([ADR-0004](adr/0004-market-data-source.md)).
- Backtest correctness rules (no lookahead, costs) are in [engineering.md](engineering.md).
- Not investment advice: results are historical simulations; the UI must say so.
