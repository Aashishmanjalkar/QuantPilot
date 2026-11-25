"""Technical indicators. Each value at bar t uses data up to and including bar t only
(QP-STD-003)."""

from __future__ import annotations

import numpy as np
import pandas as pd


def rsi(close: pd.Series, period: int) -> pd.Series:
    """Wilder's RSI.

    The first average gain/loss is the simple mean of the first `period` changes;
    later averages use Wilder smoothing: avg_t = (avg_{t-1} * (period - 1) + x_t) / period.
    Bars before index `period` are NaN. If the average loss is 0 the RSI is 100
    (or 50 when there is also no gain).
    """
    if period < 1:
        raise ValueError("period must be >= 1")
    values = close.to_numpy(dtype=float)
    out = np.full(len(values), np.nan)
    if len(values) <= period:
        return pd.Series(out, index=close.index, name=f"rsi_{period}")

    delta = np.diff(values)
    gains = np.clip(delta, 0, None)
    losses = np.clip(-delta, 0, None)

    avg_gain = gains[:period].mean()
    avg_loss = losses[:period].mean()
    out[period] = _rsi_value(avg_gain, avg_loss)
    for i in range(period, len(delta)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        out[i + 1] = _rsi_value(avg_gain, avg_loss)
    return pd.Series(out, index=close.index, name=f"rsi_{period}")


def _rsi_value(avg_gain: float, avg_loss: float) -> float:
    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0
    rs = avg_gain / avg_loss
    return float(100.0 - 100.0 / (1.0 + rs))
