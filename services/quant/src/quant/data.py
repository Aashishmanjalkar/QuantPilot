"""Market data behind a DataProvider interface (ADR-0004).

Bars are a DataFrame indexed by date (ascending, unique) with columns
open, high, low, close, volume. Prices are split- and dividend-adjusted.
Provider data is validated before use (QP-STD-002).
"""

from __future__ import annotations

import datetime as dt
import io
import json
import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

import pandas as pd
import psycopg

log = logging.getLogger(__name__)

COLUMNS = ["open", "high", "low", "close", "volume"]


class DataError(Exception):
    """The provider returned no usable data for the request (caller's input problem)."""


class DataProviderError(Exception):
    """The provider failed (network, rate limit, upstream change)."""


class DataProvider(Protocol):
    name: str

    def get_daily_bars(self, ticker: str, start: dt.date, end: dt.date) -> pd.DataFrame:
        """Daily bars with start <= date <= end."""
        ...


class BarCache(Protocol):
    def get(self, key: str) -> pd.DataFrame | None: ...

    def put(self, key: str, bars: pd.DataFrame) -> None: ...


def validate_bars(bars: pd.DataFrame, ticker: str) -> pd.DataFrame:
    missing = [c for c in COLUMNS if c not in bars.columns]
    if missing:
        raise DataProviderError(f"provider data for {ticker} is missing columns {missing}")
    df = bars[COLUMNS].copy()
    df.index = pd.DatetimeIndex(pd.to_datetime(df.index)).normalize()
    df = df.sort_index()
    df = df[~df.index.duplicated(keep="last")]
    df = df.dropna(subset=["open", "high", "low", "close"])
    if df.empty:
        raise DataError(f"no price data for {ticker} in the requested range")
    prices = df[["open", "high", "low", "close"]]
    if (prices <= 0).to_numpy().any():
        raise DataProviderError(f"provider data for {ticker} contains non-positive prices")
    if (df["high"] < df["low"]).any():
        raise DataProviderError(f"provider data for {ticker} has high < low")
    df["volume"] = df["volume"].fillna(0)
    return df.astype(float)


class FixtureProvider:
    """Reads `<dir>/<TICKER>.csv` (columns: date, open, high, low, close, volume).

    Used by tests and the E2E stack so they never call the network.
    """

    name = "fixture"

    def __init__(self, directory: Path) -> None:
        self._dir = directory

    def get_daily_bars(self, ticker: str, start: dt.date, end: dt.date) -> pd.DataFrame:
        path = self._dir / f"{ticker}.csv"
        if not path.is_file():
            raise DataError(f"no price data for {ticker}")
        df = pd.read_csv(path, parse_dates=["date"], index_col="date")
        df = df.loc[(df.index >= pd.Timestamp(start)) & (df.index <= pd.Timestamp(end))]
        return validate_bars(df, ticker)


class YFinanceProvider:
    name = "yfinance"

    def get_daily_bars(self, ticker: str, start: dt.date, end: dt.date) -> pd.DataFrame:
        import yfinance as yf

        try:
            raw = yf.Ticker(ticker).history(
                start=start.isoformat(),
                end=(end + dt.timedelta(days=1)).isoformat(),  # yfinance end is exclusive
                interval="1d",
                auto_adjust=True,
                actions=False,
                raise_errors=True,
            )
        except Exception as exc:
            # Unknown/delisted tickers and empty ranges are the caller's input problem
            # (no retry); anything else (network, rate limit) is a provider failure.
            input_errors = {"YFPricesMissingError", "YFTzMissingError", "YFTickerMissingError"}
            message = str(exc).lower()
            if type(exc).__name__ in input_errors or any(
                m in message for m in ("delisted", "no data", "not found", "no price data")
            ):
                raise DataError(f"no price data for {ticker} in the requested range") from exc
            log.warning("yfinance request failed for %s: %s", ticker, type(exc).__name__)
            raise DataProviderError("market data provider request failed") from exc
        if raw is None or raw.empty:
            raise DataError(f"no price data for {ticker} in the requested range")
        raw = raw.rename(columns=str.lower)
        if isinstance(raw.index, pd.DatetimeIndex) and raw.index.tz is not None:
            raw.index = raw.index.tz_localize(None)
        return validate_bars(raw, ticker)


def _utc_today() -> dt.date:
    return dt.datetime.now(dt.UTC).date()


class CachingProvider:
    """Caches validated bars per (provider, ticker, start, end).

    Ranges that reach today or later are never cached: their last bar may be partial
    and later sessions would be missing from a frozen copy.
    """

    def __init__(
        self, inner: DataProvider, cache: BarCache, today: Callable[[], dt.date] = _utc_today
    ) -> None:
        self._inner = inner
        self._cache = cache
        self._today = today
        self.name = inner.name

    def get_daily_bars(self, ticker: str, start: dt.date, end: dt.date) -> pd.DataFrame:
        if end >= self._today():
            return self._inner.get_daily_bars(ticker, start, end)
        key = f"{self._inner.name}:{ticker}:{start.isoformat()}:{end.isoformat()}"
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        bars = self._inner.get_daily_bars(ticker, start, end)
        self._cache.put(key, bars)
        return bars


class MemoryBarCache:
    def __init__(self) -> None:
        self._store: dict[str, pd.DataFrame] = {}

    def get(self, key: str) -> pd.DataFrame | None:
        hit = self._store.get(key)
        return hit.copy() if hit is not None else None

    def put(self, key: str, bars: pd.DataFrame) -> None:
        self._store[key] = bars.copy()


class PostgresBarCache:
    """Stores bars as JSON in a `quant_bar_cache` table created on first use.

    Cache failures are logged and treated as misses so a cache outage never fails
    a backtest.
    """

    def __init__(self, database_url: str) -> None:
        self._url = database_url
        self._ready = False

    def _connect(self) -> psycopg.Connection[tuple[Any, ...]]:
        conn = psycopg.connect(self._url, connect_timeout=5)
        if not self._ready:
            with conn.cursor() as cur:
                cur.execute(
                    "CREATE TABLE IF NOT EXISTS quant_bar_cache ("
                    " key TEXT PRIMARY KEY,"
                    " bars JSONB NOT NULL,"
                    " created_at TIMESTAMPTZ NOT NULL DEFAULT now())"
                )
            conn.commit()
            self._ready = True
        return conn

    def get(self, key: str) -> pd.DataFrame | None:
        try:
            with self._connect() as conn, conn.cursor() as cur:
                cur.execute("SELECT bars FROM quant_bar_cache WHERE key = %s", (key,))
                row = cur.fetchone()
        except Exception as exc:
            log.warning("bar cache read failed: %s", type(exc).__name__)
            return None
        if row is None:
            return None
        payload = row[0] if isinstance(row[0], str) else json.dumps(row[0])
        df = pd.read_json(io.StringIO(payload), orient="split")
        return validate_bars(df, key)

    def put(self, key: str, bars: pd.DataFrame) -> None:
        payload = bars.to_json(orient="split", date_format="iso")
        try:
            with self._connect() as conn, conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO quant_bar_cache (key, bars) VALUES (%s, %s::jsonb)"
                    " ON CONFLICT (key) DO UPDATE SET bars = EXCLUDED.bars, created_at = now()",
                    (key, payload),
                )
                conn.commit()
        except Exception as exc:
            log.warning("bar cache write failed: %s", type(exc).__name__)
