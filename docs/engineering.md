# Engineering standards

Accepted at setup (2026-11-23). Rule IDs are stable: never renumber or reuse an ID;
retire a rule by marking it **Retired** with a reason. Cite IDs in plans and reviews.

| ID | Rule | Applies to |
|---|---|---|
| QP-STD-001 | TypeScript `strict` mode; no `any` (use `unknown` + narrowing). Exceptions need an inline comment with the reason. | `apps/*`, `packages/*` |
| QP-STD-002 | Validate all external input at the boundary: Zod in Node (HTTP bodies, query, env, quant responses), Pydantic in Python (requests, LLM output, provider data). Internal code may trust validated types. | All services |
| QP-STD-003 | No lookahead bias: a signal computed at bar *t* may use only data up to and including bar *t*'s close; the resulting order fills at bar *t+1*'s open. | `services/quant` engine and indicators |
| QP-STD-004 | Every backtest models transaction costs and slippage; defaults are explicit config values, never silently zero. | `services/quant` engine |
| QP-STD-005 | Each of QP-STD-003 and QP-STD-004 has at least one test whose expected values are computed by hand (independent oracle), not copied from engine output. | `services/quant/tests` |
| QP-STD-006 | Secrets come only from environment variables. `.env.example` is committed with placeholder values; real `.env` files are git-ignored. No keys, tokens, or user data in code, logs, or error messages. | Whole repo |
| QP-STD-007 | LLM output is untrusted: it must pass strategy-schema validation before use, is never executed as code, and failures return a user-facing validation error. | `services/quant` AI module |
| QP-STD-008 | Lint, format, and type checks pass in CI on every PR: ESLint + Prettier + `tsc` for TypeScript; Ruff + mypy for Python. | Whole repo, `.github/workflows` |

## Conventions (guidance, not rules)

- Keep modules small with one owner per concern; cross-service contracts live in
  `packages/shared` (generated) and the FastAPI OpenAPI spec.
- Prefer vectorized pandas over row loops in the engine; correctness first, then speed.
- Error responses use one JSON shape per service; document it when the first endpoint lands.
