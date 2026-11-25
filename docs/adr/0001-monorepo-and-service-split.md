# ADR-0001: pnpm monorepo with Node API and Python quant service

Status: Accepted (2026-11-23, project setup)

## Context

QuantPilot needs a web app, a public API with auth and job orchestration, and numeric
backtesting plus LLM work. Node/TypeScript suits the API and UI; Python's pandas
ecosystem suits backtesting. It is a single portfolio project.

## Decision

One pnpm workspace repository:
`apps/web` (Next.js), `apps/api` (Express + Prisma + BullMQ), `services/quant`
(FastAPI, Python), `packages/shared` (generated schema types). One Docker Compose file
runs everything. `services/quant` is internal and called only by `apps/api`.

## Consequences

- Two languages and two toolchains in one repo; CI runs both.
- Cross-service contract changes land in one PR.
- An HTTP hop between API and quant adds latency and a failure mode the API must handle
  (timeouts, retries via the job queue).

## Alternatives

- npm workspaces: no extra tool, but slower installs and weaker workspace filtering.
- Separate repositories: more overhead and less visible as one project.
- All-Node backtesting: avoids two languages but loses pandas/numeric libraries.
