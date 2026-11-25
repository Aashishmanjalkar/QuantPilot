# Architecture decision records

Record a decision here when it involves a significant tradeoff whose reasons should
survive later work. Not every choice needs an ADR.

Format: `NNNN-short-title.md` with Status, Context, Decision, Consequences, Alternatives.
Numbers are never reused; superseded ADRs stay with a link to their replacement.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-monorepo-and-service-split.md) | pnpm monorepo with Node API and Python quant service | Accepted |
| [0002](0002-strategy-schema-ownership.md) | Strategy schema owned by Python Pydantic models | Accepted |
| [0003](0003-llm-provider.md) | Claude API for strategy parsing, behind a provider interface | Accepted |
| [0004](0004-market-data-source.md) | yfinance with caching behind a DataProvider interface | Accepted |
