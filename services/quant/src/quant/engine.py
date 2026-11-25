"""Backtest engine for long-only single-ticker strategies.

Execution model (see docs/engineering.md):
- QP-STD-003: a signal is evaluated at bar t's close using data up to bar t; the
  order it creates fills at bar t+1's open. A signal on the last bar never fills.
- QP-STD-004: every fill pays commission (bps of notional) and slippage (bps of the
  open price, always adverse) taken from the strategy's explicit cost config.

Sizing: on entry, `fraction` of current cash (commission included) buys fractional
shares. Equity at bar t is cash plus position marked at bar t's close. A position still
open at the end is valued at the last close, before exit costs.

Warm-up: bars dated before `strategy.start_date` are used only to compute indicators.
Signals, fills, equity and the benchmark start at the first bar on or after start_date.
"""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

from quant.indicators import rsi
from quant.schema import (
    BacktestAssumptions,
    BacktestResult,
    EquityPoint,
    Metrics,
    RsiCondition,
    Strategy,
    Trade,
)

TRADING_DAYS_PER_YEAR = 252
BARS_COLUMNS = ("open", "high", "low", "close", "volume")


def condition_signal(bars: pd.DataFrame, cond: RsiCondition) -> pd.Series:
    """Boolean per bar; False where the indicator is not yet defined."""
    values = rsi(bars["close"], cond.period)
    sig = values < cond.threshold if cond.operator == "below" else values > cond.threshold
    return sig.fillna(False).astype(bool)


@dataclass
class _OpenTrade:
    entry_date: dt.date
    entry_price: float
    quantity: float
    cost_basis: float  # notional + entry commission


def run_backtest(strategy: Strategy, bars: pd.DataFrame, data_source: str) -> BacktestResult:
    in_window = bars.index >= pd.Timestamp(strategy.start_date)
    if not in_window.any():
        raise ValueError("no bars on or after start_date")
    warmup_bars = int((~in_window).sum())

    # Indicators see the warm-up history; everything else sees only the window.
    entry_sig = condition_signal(bars, strategy.entry).to_numpy()[in_window]
    exit_sig = condition_signal(bars, strategy.exit).to_numpy()[in_window]
    bars = bars.loc[in_window]

    comm = strategy.costs.commission_bps / 10_000
    slip = strategy.costs.slippage_bps / 10_000
    fraction = strategy.position_sizing.fraction
    capital = strategy.initial_capital

    opens = bars["open"].to_numpy(dtype=float)
    closes = bars["close"].to_numpy(dtype=float)
    dates = [_as_date(d) for d in bars.index]

    cash = capital
    position: _OpenTrade | None = None
    pending: str | None = None  # "buy" | "sell", to fill at next bar's open
    trades: list[Trade] = []
    equity = np.empty(len(bars))
    in_market = np.zeros(len(bars), dtype=bool)
    total_costs = 0.0

    for t in range(len(bars)):
        if pending == "buy" and position is None:
            price = opens[t] * (1 + slip)
            budget = cash * fraction
            notional = budget / (1 + comm)
            commission = notional * comm
            qty = notional / price
            cash -= notional + commission
            total_costs += commission + qty * opens[t] * slip
            position = _OpenTrade(dates[t], price, qty, notional + commission)
        elif pending == "sell" and position is not None:
            price = opens[t] * (1 - slip)
            proceeds = position.quantity * price
            commission = proceeds * comm
            cash += proceeds - commission
            total_costs += commission + position.quantity * opens[t] * slip
            pnl = proceeds - commission - position.cost_basis
            trades.append(
                Trade(
                    entry_date=position.entry_date,
                    entry_price=position.entry_price,
                    exit_date=dates[t],
                    exit_price=price,
                    quantity=position.quantity,
                    pnl=pnl,
                    return_pct=pnl / position.cost_basis * 100,
                )
            )
            position = None
        pending = None

        held = position.quantity if position is not None else 0.0
        equity[t] = cash + held * closes[t]
        in_market[t] = position is not None

        # Signal at bar t's close -> order for bar t+1's open.
        if position is None and entry_sig[t]:
            pending = "buy"
        elif position is not None and exit_sig[t]:
            pending = "sell"

    if position is not None:
        trades.append(
            Trade(
                entry_date=position.entry_date,
                entry_price=position.entry_price,
                exit_date=None,
                exit_price=None,
                quantity=position.quantity,
                pnl=None,
                return_pct=None,
            )
        )

    benchmark = _buy_and_hold(capital, opens, closes, comm, slip)
    metrics = _metrics(capital, dates, equity, benchmark, trades, in_market, total_costs)

    return BacktestResult(
        ticker=strategy.ticker,
        start_date=dates[0],
        end_date=dates[-1],
        bars=len(bars),
        metrics=metrics,
        trades=trades,
        equity_curve=[
            EquityPoint(date=d, equity=float(e), benchmark=float(b))
            for d, e, b in zip(dates, equity, benchmark, strict=True)
        ],
        assumptions=BacktestAssumptions(
            commission_bps=strategy.costs.commission_bps,
            slippage_bps=strategy.costs.slippage_bps,
            data_source=data_source,
            warmup_bars=warmup_bars,
        ),
    )


def _buy_and_hold(
    capital: float, opens: np.ndarray, closes: np.ndarray, comm: float, slip: float
) -> np.ndarray:
    """All capital buys at the first bar's open with the same costs, held to the end."""
    qty = capital / (1 + comm) / (float(opens[0]) * (1 + slip))
    return np.asarray(closes, dtype=float) * qty


def _metrics(
    capital: float,
    dates: list[dt.date],
    equity: np.ndarray,
    benchmark: np.ndarray,
    trades: list[Trade],
    in_market: np.ndarray,
    total_costs: float,
) -> Metrics:
    final = float(equity[-1])
    total_return = final / capital - 1
    years = (dates[-1] - dates[0]).days / 365.25
    cagr = (final / capital) ** (1 / years) - 1 if years > 0 and final > 0 else total_return

    series = np.concatenate([[capital], equity])
    returns = series[1:] / series[:-1] - 1
    sharpe: float | None = None
    if len(returns) >= 2:
        std = float(np.std(returns, ddof=1))
        if std > 0 and math.isfinite(std):
            sharpe = float(np.mean(returns) / std * math.sqrt(TRADING_DAYS_PER_YEAR))

    peaks = np.maximum.accumulate(series)
    max_dd = float(np.max(1 - series / peaks))

    closed = [t for t in trades if t.pnl is not None]
    wins = [t for t in closed if t.pnl is not None and t.pnl > 0]

    return Metrics(
        total_return_pct=total_return * 100,
        cagr_pct=cagr * 100,
        sharpe=sharpe,
        max_drawdown_pct=max_dd * 100,
        num_trades=len(trades),
        win_rate_pct=len(wins) / len(closed) * 100 if closed else None,
        exposure_pct=float(in_market.mean() * 100),
        total_costs=total_costs,
        benchmark_total_return_pct=(float(benchmark[-1]) / capital - 1) * 100,
    )


def _as_date(value: object) -> dt.date:
    if isinstance(value, pd.Timestamp):
        return value.date()
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    raise TypeError(f"unsupported index value: {value!r}")
