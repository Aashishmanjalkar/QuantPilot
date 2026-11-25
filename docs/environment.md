# Environment

Status: milestone 1 (2026-11-23). `compose.yaml`, `compose.test.yaml`, and
`.env.example` files exist; the commands below were run during milestone 1 delivery.

## Quick start

```sh
cp .env.example .env            # set POSTGRES_PASSWORD
docker compose up -d --build --wait
# web: http://localhost:3000  api: http://localhost:4000  (quant is internal only)
```

Set `QUANT_DATA_PROVIDER=fixture` to run offline against the synthetic `DEMO` ticker.

Local development without Docker for the apps: start only `postgres` and `redis`
(`docker compose up -d postgres redis`), run `pnpm install`, copy each `.env.example`
to `.env`, then run `uvicorn quant.main:app --port 8000` in `services/quant` (after
`pip install -e ".[dev]"`), `pnpm --filter @quantpilot/api prisma:migrate`,
`pnpm --filter @quantpilot/api dev`, and `pnpm --filter @quantpilot/web dev`.

pnpm is pinned through `packageManager`; use `corepack pnpm` if `pnpm` is not on PATH.

## Toolchain

Node.js 22+ with pnpm, Python 3.12+, Docker with Compose, Git.
Exact versions are pinned in `package.json` (`engines`, `packageManager`) and
`services/quant/pyproject.toml`; those files are the authority.

## Services (Docker Compose)

| Service | Purpose |
|---|---|
| `postgres` | App data (users, strategies, results) and market-data cache |
| `redis` | BullMQ queue, short-lived cache |
| `api` | `apps/api` |
| `quant` | `services/quant` (internal network only) |
| `web` | `apps/web` |

## Configuration and secrets

- Each service reads env vars; `.env.example` files list every variable with placeholders.
- Real `.env` files are git-ignored (QP-STD-006). Secrets include the Claude API key,
  JWT secret, and database passwords.

## Isolation and cleanup

- Tests that need Postgres/Redis use a separate Compose project name or database so they
  do not touch development data: `compose.test.yaml` (project `quantpilot-test`, ports
  55432/56379, tmpfs data) for integration tests, and `docker compose -p quantpilot-e2e`
  with alternate `*_PORT` values for E2E runs.
- Remove containers and volumes a verification run created (`docker compose down -v`
  for that project only) and keep logs needed as evidence.
