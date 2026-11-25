# Project workflow guide

Scope: the whole QuantPilot repository (pnpm monorepo). No package has its own
instruction file yet; if one is added (for example `services/quant/CLAUDE.md`),
its rules apply within that path in addition to the root rules.

Purpose: find current project authorities. This map grants no execution permissions
and is not evidence that any check passes.

Status: milestone 1 landed (2026-11-23); `apps/api`, `apps/web`, `services/quant`,
`packages/shared`, and `e2e` exist. A `setup-project` refresh is still due.

| Concern | Read when / scope | Authoritative source |
|---|---|---|
| Instructions | Every task | [CLAUDE.md](../CLAUDE.md) |
| Purpose and architecture | Interfaces, new modules, cross-service changes | [Architecture](architecture.md) |
| Engineering standards | Any behavior change; cite rule IDs in reviews | [Standards index](engineering.md) |
| Verification and test IDs | Planning acceptance checks, writing tests, verifying | [Testing guide](testing.md) |
| Requirements, tracker, commits, PRs | Planning, branching, committing, opening PRs | [Work conventions](work.md) |
| Environment and services | Running the stack, env vars, secrets, cleanup | [Environment guide](environment.md) |
| Significant decisions | Changing anything an ADR covers, or making a new tradeoff | [ADR index](adr/README.md) |
| Domain vocabulary | Naming, strategy/backtest semantics | [Glossary](glossary.md) |
| Command catalogs | Running checks; cwd: repository root | `package.json` scripts and `services/quant/pyproject.toml` |

## Skill routing

Workflow selection: **Default for matching tasks** (selected by the user at setup).

| Requested outcome | Skill |
|---|---|
| Project setup or refresh | `agent-engineering:setup-project` |
| Plan only | `agent-engineering:plan-change` |
| Full implementation workflow | `agent-engineering:deliver-change` |
| Implement an accepted slice only | `agent-engineering:implement-change` |
| Verify only | `agent-engineering:verify-change` |
| Analyze a change | `agent-engineering:review-change` |
| Review a GitHub PR | `agent-engineering:review-pr` (preserve report-only or feedback limits) |
| Correct review findings | `agent-engineering:remediate-findings` |
| Authorized commit, push, or draft PR | `agent-engineering:publish-change` |

Routing selects a procedure; it does not authorize commits, pushes, PR comments,
merges, or deployment beyond what the task request grants.

## Adoption record

Approach: **Adopt our recommended baseline** (selected by the user at setup).
Workflow selection: **Default for matching tasks** (selected by the user at setup).

| Practice | Disposition | Source or decision | Scope and rationale |
|---|---|---|---|
| Shared workflow contract (phase boundaries, review, remediation limits) | Established | agent-engineering plugin contract | All tasks |
| pnpm monorepo with api / web / quant / shared | Accepted | [ADR-0001](adr/0001-monorepo-and-service-split.md) | Whole repo; one portfolio project, one compose file |
| Strategy schema owned by Python Pydantic | Accepted | [ADR-0002](adr/0002-strategy-schema-ownership.md) | `services/quant`, `packages/shared` |
| Claude API as LLM provider behind an interface | Accepted | [ADR-0003](adr/0003-llm-provider.md) | `services/quant` AI module |
| yfinance + cache behind a DataProvider interface | Accepted | [ADR-0004](adr/0004-market-data-source.md) | `services/quant` data module |
| Standards QP-STD-001..008 | Accepted | [Standards index](engineering.md) | Paths listed per rule |
| Test stack (Vitest, Supertest, pytest, Playwright) and test-case IDs | Accepted | [Testing guide](testing.md) | All packages |
| Behavioral test IDs for integration/E2E/regressions | Established | Shared workflow contract | Mechanism (ID catalog check) is Proposed below |
| Test-ID catalog check script | Proposed | [Testing guide](testing.md#test-case-ids) | Add once more than a handful of tests exist; blocks nothing |
| GitHub Issues as requirements owner | Accepted | [Work conventions](work.md) | All feature work |
| Conventional Commits, feature branches, squash-merge PRs | Accepted | [Work conventions](work.md) | All commits |
| Lint/format/type checks in GitHub Actions | Accepted | [Standards](engineering.md) QP-STD-008 | CI workflow not yet created |
| GitHub remote repository | Pending | — | Blocks issue creation and PRs only; local work continues |

## Coverage

| Baseline topic | Coverage |
|---|---|
| Purpose and architecture | Documented (planned design) |
| Engineering standards | Documented |
| Verification | Documented; command catalogs gap until packages exist |
| Work and collaboration | Documented; GitHub remote pending |
| Environment | Documented (planned); compose file not yet created |
| Decisions and vocabulary | Documented (4 ADRs, glossary) |
| Workflow selection | Documented above |

Refresh this guide (run `setup-project` again) after the first milestone lands,
so the planned paths and command catalogs can be checked against real files.
