# ADR-0004: yfinance with caching behind a DataProvider interface

Status: Accepted (2026-11-23, project setup)

## Context

Backtests need daily OHLCV history for US and Indian (NSE, `.NS`) tickers. The first
version should run without paid API keys.

## Decision

Use `yfinance` through a `DataProvider` interface in `services/quant`. Cache fetched
bars (Postgres for history, Redis for short-lived lookups) so repeated backtests do
not refetch.

## Consequences

- yfinance is unofficial: it can rate-limit, change, or return gaps. Data is validated
  (QP-STD-002) and failures surface as clear job errors.
- Adjusted vs. unadjusted prices must be chosen explicitly and documented in results.
- Survivorship bias is a known limitation (delisted tickers are missing); state it in the UI.
- Tests use stored fixtures, never live network calls.

## Alternatives

- Polygon or Alpha Vantage from the start: more reliable, but needs a paid key.
