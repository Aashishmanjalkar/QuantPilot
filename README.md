# QuantPilot

Describe a trading strategy, backtest it on historical market data with realistic costs,
and read the result. Milestone 1 supports a fixed RSI mean-reversion form on one ticker.

Results are historical simulations, not investment advice.

## Run it

```sh
cp .env.example .env   # set POSTGRES_PASSWORD; QUANT_DATA_PROVIDER=fixture runs offline
docker compose up -d --build --wait
```

Open http://localhost:3000. With the fixture provider, use ticker `DEMO` (2022–2023).

## Layout

| Path              | What                                                                   |
| ----------------- | ---------------------------------------------------------------------- |
| `apps/web`        | Next.js UI                                                             |
| `apps/api`        | Express API, Prisma, BullMQ worker, WebSocket progress                 |
| `services/quant`  | FastAPI: strategy schema (source of truth), data, RSI, backtest engine |
| `packages/shared` | JSON Schema + Zod types generated from the Python schema               |
| `e2e`             | Playwright tests against the Compose stack                             |

Docs: [architecture](docs/architecture.md), [standards](docs/engineering.md),
[testing](docs/testing.md), [environment](docs/environment.md), [ADRs](docs/adr/README.md).
