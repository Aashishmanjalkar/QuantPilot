"""Engine tests. Expected values are derived by hand from the execution rules in
docs/engineering.md (QP-STD-003/004/005), never copied from engine output."""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import pandas as pd
import pytest

from quant.data import FixtureProvider
from quant.engine import run_backtest
from quant.indicators import rsi
from quant.schema import Costs, RsiCondition, Strategy

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "bars"

# Hand scenario. RSI(2) on closes 10, 9, 8, 9, 10, 11, 10:
#   idx2: avg gain 0, avg loss 1        -> RSI 0     (entry: RSI < 30 -> buy at idx3 open)
#   idx3: 0.5 / 0.5                      -> RSI 50
#   idx4: 0.75 / 0.25                    -> RSI 75
#   idx5: 0.875 / 0.125                  -> RSI 87.5  (exit: RSI > 80 -> sell at idx6 open)
#   idx6: 0.4375 / 0.5625                -> RSI 43.75
CLOSES = [10.0, 9.0, 8.0, 9.0, 10.0, 11.0, 10.0]
OPENS = [10.0, 9.5, 8.5, 8.0, 9.5, 10.5, 11.0]
DATES = pd.bdate_range("2024-01-01", periods=len(CLOSES))
CAPITAL = 1000.0
COMM = 0.001  # 10 bps
SLIP = 0.002  # 20 bps


def hand_bars(closes: list[float] = CLOSES, opens: list[float] = OPENS) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "open": opens,
            "high": [max(o, c) for o, c in zip(opens, closes, strict=True)],
            "low": [min(o, c) for o, c in zip(opens, closes, strict=True)],
            "close": closes,
            "volume": [1000.0] * len(closes),
        },
        index=pd.bdate_range("2024-01-01", periods=len(closes)),
    )


def strategy(**overrides: object) -> Strategy:
    base: dict[str, object] = {
        "name": "hand",
        "ticker": "HAND",
        "start_date": dt.date(2024, 1, 1),
        "end_date": dt.date(2024, 12, 31),
        "initial_capital": CAPITAL,
        "entry": RsiCondition(period=2, operator="below", threshold=30),
        "exit": RsiCondition(period=2, operator="above", threshold=80),
        "costs": Costs(commission_bps=COMM * 10_000, slippage_bps=SLIP * 10_000),
    }
    base.update(overrides)
    return Strategy.model_validate(base)


def test_rsi_matches_hand_computation() -> None:
    values = rsi(pd.Series([10.0, 11.0, 10.0, 12.0, 12.0]), 2).tolist()
    assert pd.isna(values[0]) and pd.isna(values[1])
    assert values[2] == pytest.approx(50.0)
    assert values[3] == pytest.approx(100 - 100 / 6)  # rs = 1.25 / 0.25 = 5
    assert values[4] == pytest.approx(100 - 100 / 6)  # rs = 0.625 / 0.125 = 5


def test_rsi_of_scenario() -> None:
    values = rsi(pd.Series(CLOSES), 2).tolist()
    assert values[2:] == pytest.approx([0.0, 50.0, 75.0, 87.5, 43.75])


def test_signal_fills_at_next_bar_open_with_costs() -> None:
    """QP-STD-003 + QP-STD-005: signal at idx2 close fills at idx3 open; exit signal at
    idx5 close fills at idx6 open. Prices include adverse slippage."""
    result = run_backtest(strategy(), hand_bars(), data_source="test")

    assert len(result.trades) == 1
    trade = result.trades[0]
    assert trade.entry_date == DATES[3].date()
    assert trade.entry_price == pytest.approx(8.0 * (1 + SLIP))
    assert trade.exit_date == DATES[6].date()
    assert trade.exit_price == pytest.approx(11.0 * (1 - SLIP))

    qty = CAPITAL / (1 + COMM) / (8.0 * (1 + SLIP))  # 124.6258...
    assert trade.quantity == pytest.approx(qty)
    final = qty * 11.0 * (1 - SLIP) * (1 - COMM)  # ~1366.7747
    assert final == pytest.approx(1366.7747, abs=1e-3)
    assert trade.pnl == pytest.approx(final - CAPITAL)
    assert trade.return_pct == pytest.approx((final / CAPITAL - 1) * 100)

    equity = [p.equity for p in result.equity_curve]
    assert equity == pytest.approx([1000, 1000, 1000, qty * 9, qty * 10, qty * 11, final])
    assert result.metrics.total_return_pct == pytest.approx((final / CAPITAL - 1) * 100)
    assert result.metrics.max_drawdown_pct == pytest.approx((1 - final / (qty * 11)) * 100)
    assert result.metrics.num_trades == 1
    assert result.metrics.win_rate_pct == pytest.approx(100.0)
    assert result.metrics.exposure_pct == pytest.approx(3 / 7 * 100)  # held at idx3..5 closes


def test_costs_are_charged_on_every_fill() -> None:
    """QP-STD-004 + QP-STD-005: costs = commissions + slippage, worked out by hand."""
    result = run_backtest(strategy(), hand_bars(), data_source="test")
    qty = CAPITAL / (1 + COMM) / (8.0 * (1 + SLIP))
    buy_comm = CAPITAL / (1 + COMM) * COMM
    buy_slip = qty * 8.0 * SLIP
    sell_comm = qty * 11.0 * (1 - SLIP) * COMM
    sell_slip = qty * 11.0 * SLIP
    assert result.metrics.total_costs == pytest.approx(buy_comm + buy_slip + sell_comm + sell_slip)

    free = run_backtest(
        strategy(costs=Costs(commission_bps=0, slippage_bps=0)), hand_bars(), data_source="test"
    )
    # Without costs: buy 125 shares at 8, sell at 11.
    assert free.equity_curve[-1].equity == pytest.approx(125 * 11.0)
    assert free.metrics.total_costs == 0
    assert result.equity_curve[-1].equity < free.equity_curve[-1].equity


def test_default_costs_are_explicit_and_non_zero() -> None:
    s = Strategy.model_validate(strategy().model_dump(exclude={"costs"}))
    assert s.costs.commission_bps > 0
    assert s.costs.slippage_bps > 0


def test_signal_on_last_bar_does_not_fill() -> None:
    """Entry signal fires only at the final bar (idx2 of a 3-bar series): no next open."""
    result = run_backtest(strategy(), hand_bars(CLOSES[:3], OPENS[:3]), data_source="test")
    assert result.trades == []
    assert [p.equity for p in result.equity_curve] == pytest.approx([CAPITAL] * 3)


def test_open_position_is_reported_and_marked_to_close() -> None:
    result = run_backtest(strategy(), hand_bars(CLOSES[:5], OPENS[:5]), data_source="test")
    assert len(result.trades) == 1
    assert result.trades[0].exit_date is None and result.trades[0].pnl is None
    qty = CAPITAL / (1 + COMM) / (8.0 * (1 + SLIP))
    assert result.equity_curve[-1].equity == pytest.approx(qty * 10.0)
    assert result.metrics.win_rate_pct is None


def test_benchmark_is_buy_and_hold_from_first_open() -> None:
    result = run_backtest(strategy(), hand_bars(), data_source="test")
    qty = CAPITAL / (1 + COMM) / (10.0 * (1 + SLIP))
    assert [p.benchmark for p in result.equity_curve] == pytest.approx([qty * c for c in CLOSES])
    assert result.metrics.benchmark_total_return_pct == pytest.approx(
        (qty * 10.0 / CAPITAL - 1) * 100
    )


def test_no_trades_gives_flat_metrics() -> None:
    s = strategy(entry=RsiCondition(period=2, operator="below", threshold=0))
    result = run_backtest(s, hand_bars(), data_source="test")
    assert result.trades == []
    assert result.metrics.total_return_pct == 0
    assert result.metrics.cagr_pct == 0
    assert result.metrics.sharpe is None
    assert result.metrics.max_drawdown_pct == 0


def test_future_bars_do_not_change_the_past() -> None:
    """QP-STD-003 property: results through bar k depend only on bars 0..k."""
    bars = FixtureProvider(FIXTURES).get_daily_bars(
        "DEMO", dt.date(2022, 1, 1), dt.date(2023, 12, 31)
    )
    s = strategy(
        ticker="DEMO",
        start_date=dt.date(2022, 1, 1),
        end_date=dt.date(2023, 12, 31),
        entry=RsiCondition(period=14, operator="below", threshold=35),
        exit=RsiCondition(period=14, operator="above", threshold=60),
    )
    full = run_backtest(s, bars, data_source="test")
    assert full.metrics.num_trades >= 2, "fixture should produce trades"

    for k in (100, 250, 400):
        part = run_backtest(s, bars.iloc[:k], data_source="test")
        assert [p.equity for p in part.equity_curve] == pytest.approx(
            [p.equity for p in full.equity_curve[:k]]
        )
        cutoff = bars.index[k - 1].date()
        closed_full = [t for t in full.trades if t.exit_date is not None and t.exit_date <= cutoff]
        closed_part = [t for t in part.trades if t.exit_date is not None]
        assert closed_part == closed_full


def test_warmup_bars_feed_indicators_but_not_trading() -> None:
    """F7: bars before start_date only warm up RSI; the window starts at start_date."""
    bars = hand_bars()
    s = strategy(start_date=DATES[3].date())
    result = run_backtest(s, bars, data_source="test")

    assert result.assumptions.warmup_bars == 3
    assert result.start_date == DATES[3].date()
    assert result.bars == 4
    # RSI at idx2 (=0) is a warm-up signal and must not trade. In the window, RSI is
    # 50, 75, 87.5, 43.75: never below 30, so no entry.
    assert result.trades == []
    assert [p.equity for p in result.equity_curve] == pytest.approx([CAPITAL] * 4)
    # Benchmark buys at the first window bar's open (8.0), not bar 0's.
    qty = CAPITAL / (1 + COMM) / (8.0 * (1 + SLIP))
    assert result.equity_curve[0].benchmark == pytest.approx(qty * 9.0)


def test_warmup_makes_rsi_available_on_the_first_window_bar() -> None:
    """With warm-up, an entry signal on the first window bar fills on the second."""
    s = strategy(
        start_date=DATES[2].date(),
        entry=RsiCondition(period=2, operator="below", threshold=30),
    )
    result = run_backtest(s, hand_bars(), data_source="test")
    assert result.trades[0].entry_date == DATES[3].date()
