"""Strategy and backtest-result schema.

Single source of truth for the strategy definition (ADR-0002). JSON Schema for
`packages/shared` is exported from these models by `scripts/export_schema.py`.
"""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

SCHEMA_VERSION: Literal[1] = 1

# Defaults are explicit, documented values, never silently zero (QP-STD-004).
DEFAULT_COMMISSION_BPS = 5.0
DEFAULT_SLIPPAGE_BPS = 5.0


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class RsiCondition(_Model):
    """True on a bar when RSI(period) at that bar's close is below/above threshold."""

    indicator: Literal["rsi"] = "rsi"
    period: int = Field(ge=2, le=100, description="RSI lookback in bars (Wilder smoothing).")
    operator: Literal["below", "above"]
    threshold: float = Field(ge=0, le=100)


class PositionSizing(_Model):
    kind: Literal["fraction_of_equity"] = "fraction_of_equity"
    fraction: float = Field(
        default=1.0, gt=0, le=1, description="Fraction of equity invested on entry."
    )


class Costs(_Model):
    commission_bps: float = Field(
        default=DEFAULT_COMMISSION_BPS,
        ge=0,
        le=1000,
        description="Commission per fill in basis points of traded notional.",
    )
    slippage_bps: float = Field(
        default=DEFAULT_SLIPPAGE_BPS,
        ge=0,
        le=1000,
        description="Adverse price slippage per fill in basis points of the open price.",
    )


class Strategy(_Model):
    """A long-only single-ticker strategy driven by RSI entry/exit conditions."""

    schema_version: Literal[1] = SCHEMA_VERSION
    name: str = Field(min_length=1, max_length=100)
    ticker: str = Field(
        min_length=1,
        max_length=20,
        pattern=r"^[A-Z0-9][A-Z0-9.\-^]{0,19}$",
        description="Upper-case ticker, e.g. AAPL or RELIANCE.NS.",
    )
    start_date: dt.date
    end_date: dt.date
    initial_capital: float = Field(gt=0, le=1e12)
    entry: RsiCondition
    exit: RsiCondition
    position_sizing: PositionSizing = PositionSizing()
    costs: Costs = Costs()

    @model_validator(mode="after")
    def _check_dates(self) -> Strategy:
        if self.end_date <= self.start_date:
            raise ValueError("end_date must be after start_date")
        return self


class Trade(_Model):
    entry_date: dt.date
    entry_price: float = Field(description="Fill price including slippage.")
    exit_date: dt.date | None
    exit_price: float | None
    quantity: float
    pnl: float | None = Field(description="Net of costs; null while the trade is open.")
    return_pct: float | None


class EquityPoint(_Model):
    date: dt.date
    equity: float
    benchmark: float


class Metrics(_Model):
    total_return_pct: float
    cagr_pct: float
    sharpe: float | None = Field(description="Annualized, risk-free rate 0; null if undefined.")
    max_drawdown_pct: float
    num_trades: int
    win_rate_pct: float | None
    exposure_pct: float
    total_costs: float
    benchmark_total_return_pct: float


class BacktestAssumptions(_Model):
    fill: Literal["next_bar_open"] = "next_bar_open"
    price_adjustment: Literal["split_and_dividend_adjusted"] = "split_and_dividend_adjusted"
    commission_bps: float
    slippage_bps: float
    benchmark: Literal["buy_and_hold_same_ticker"] = "buy_and_hold_same_ticker"
    data_source: str
    warmup_bars: int = Field(
        ge=0, description="Bars before start_date used only to warm up indicators."
    )
    open_position_valuation: Literal["last_close_before_exit_costs"] = (
        "last_close_before_exit_costs"
    )


class BacktestResult(_Model):
    schema_version: Literal[1] = SCHEMA_VERSION
    ticker: str
    start_date: dt.date
    end_date: dt.date
    bars: int
    metrics: Metrics
    trades: list[Trade]
    equity_curve: list[EquityPoint]
    assumptions: BacktestAssumptions


class BacktestRequest(_Model):
    strategy: Strategy
