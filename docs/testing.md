# Testing and verification

Accepted at setup (2026-11-23). Commands below exist as of milestone 1; the command
catalogs remain the authority.

## Stack

| Level | Tool | Scope |
|---|---|---|
| Unit | Vitest | Pure logic in `apps/api`, `apps/web`, `packages/shared` |
| Integration (Node) | Vitest + Supertest | `apps/api` HTTP endpoints against real Postgres/Redis (Docker) and a stubbed or real quant service |
| Unit / integration (Python) | pytest | Engine, indicators, metrics, schema, FastAPI endpoints via `TestClient` |
| E2E | Playwright | Main journey: submit strategy → see results, against the full Compose stack |

## Command catalogs

- Node: root `package.json` scripts (pnpm workspaces); cwd: repository root.
  - `pnpm check`: generated-code staleness, ESLint, Prettier, `tsc`, unit tests.
  - `pnpm test:integration`: `apps/api` against `compose.test.yaml`
    (`docker compose -f compose.test.yaml up -d --wait` first; `down -v` after).
  - `pnpm test:e2e`: Playwright against a running stack started with
    `QUANT_DATA_PROVIDER=fixture`; set `E2E_BASE_URL` / `E2E_API_URL` for non-default ports.
- Python: `services/quant/pyproject.toml`; cwd: `services/quant`.
  - `pytest`, `ruff format --check .`, `ruff check .`, `mypy`,
    `python scripts/export_schema.py --check`.
- CI: `.github/workflows/ci.yml` runs all of the above.

## Oracles

Expected backtest values come from hand-computed fixtures (small OHLCV series where
trades, fills, costs, and returns can be worked out on paper), not from engine output.
See QP-STD-005 in [engineering.md](engineering.md).

## Test-case IDs

- Integration, E2E, and material regression tests carry a stable ID in the test name:
  `QP-IT-###` (integration), `QP-E2E-###` (end to end), `QP-REG-###` (bug regression).
  Example: `test("QP-IT-001 POST /backtests enqueues a job", ...)`.
- IDs survive renames and moves; removed cases are listed as retired in this file;
  IDs are never reused.
- Acceptance-criterion IDs (`AC-<issue>-<n>`, see [work.md](work.md)) are separate;
  link tests to criteria in the test description or issue, not by sharing IDs.
- **Proposed:** a small script that lists IDs across both languages and fails on
  duplicates; add it once more than a handful of tests exist.

Current IDs (milestone 1):

| ID | Test | Location |
|---|---|---|
| QP-IT-001 | POST stores, queues, runs, pushes completion over WebSocket | `apps/api/test/integration/backtests.test.ts` |
| QP-IT-002 | Invalid strategy → 422, nothing stored | same |
| QP-IT-003 | Quant input error fails the run with a user-facing message | same |
| QP-IT-004 | GET returns the persisted run | same |
| QP-E2E-001 | Submit RSI strategy, see metrics, chart, trades; run persisted | `e2e/tests/backtest.spec.ts` |
| QP-E2E-002 | Invalid strategy shows field errors, stays on form | same |
| QP-E2E-003 | Unknown ticker shows a failed run with the reason | same |

Retired IDs: none.

## Real-interface verification

Once Docker Compose exists, verification of user-facing changes runs the stack per
[environment.md](environment.md) and drives `apps/web` (Playwright) or the `apps/api`
HTTP surface, checking side effects (DB rows, job state) as well as responses.
