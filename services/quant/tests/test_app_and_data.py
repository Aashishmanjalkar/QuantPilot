from __future__ import annotations

import datetime as dt
import subprocess
import sys
from pathlib import Path
from typing import Any

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from quant.app import create_app
from quant.data import (
    CachingProvider,
    DataError,
    DataProviderError,
    FixtureProvider,
    MemoryBarCache,
    validate_bars,
)
from quant.schema import BacktestResult

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures" / "bars"


def demo_strategy(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "name": "RSI mean reversion",
        "ticker": "DEMO",
        "start_date": "2022-01-01",
        "end_date": "2023-12-31",
        "initial_capital": 10000,
        "entry": {"period": 14, "operator": "below", "threshold": 35},
        "exit": {"period": 14, "operator": "above", "threshold": 60},
    }
    body.update(overrides)
    return body


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(FixtureProvider(FIXTURES)))


def test_health(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok", "data_provider": "fixture"}


def test_validate_normalizes_defaults(client: TestClient) -> None:
    res = client.post("/strategies/validate", json=demo_strategy())
    assert res.status_code == 200
    body = res.json()
    assert body["schema_version"] == 1
    assert body["costs"] == {"commission_bps": 5.0, "slippage_bps": 5.0}
    assert body["position_sizing"] == {"kind": "fraction_of_equity", "fraction": 1.0}


@pytest.mark.parametrize(
    ("overrides", "path"),
    [
        ({"end_date": "2021-01-01"}, ""),
        ({"ticker": "aapl; drop"}, "ticker"),
        ({"entry": {"period": 1, "operator": "below", "threshold": 30}}, "entry.period"),
        ({"unknown": 1}, "unknown"),
    ],
)
def test_validate_rejects_invalid(client: TestClient, overrides: dict[str, Any], path: str) -> None:
    res = client.post("/strategies/validate", json=demo_strategy(**overrides))
    assert res.status_code == 422
    error = res.json()["error"]
    assert error["code"] == "validation_error"
    assert path in [d["path"] for d in error["details"]]


def test_backtest_on_fixture(client: TestClient) -> None:
    res = client.post("/backtest", json={"strategy": demo_strategy()})
    assert res.status_code == 200
    result = BacktestResult.model_validate(res.json())
    assert result.ticker == "DEMO"
    assert result.bars == 520
    assert len(result.equity_curve) == 520
    assert result.metrics.num_trades >= 2
    assert result.assumptions.data_source == "fixture"
    assert result.assumptions.fill == "next_bar_open"


def test_backtest_unknown_ticker_is_422(client: TestClient) -> None:
    res = client.post("/backtest", json={"strategy": demo_strategy(ticker="NOPE")})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "no_data"


def test_backtest_provider_failure_is_502() -> None:
    class Broken:
        name = "broken"

        def get_daily_bars(self, ticker: str, start: dt.date, end: dt.date) -> pd.DataFrame:
            raise DataProviderError("market data provider request failed")

    res = TestClient(create_app(Broken())).post("/backtest", json={"strategy": demo_strategy()})
    assert res.status_code == 502
    assert res.json()["error"] == {
        "code": "data_provider_error",
        "message": "market data provider request failed",
    }


def _bars(**cols: list[float]) -> pd.DataFrame:
    base = {"open": [1.0, 2.0], "high": [1.5, 2.5], "low": [0.5, 1.5], "close": [1.2, 2.2]}
    base.update(cols)
    df = pd.DataFrame(base, index=pd.to_datetime(["2024-01-02", "2024-01-03"]))
    df["volume"] = [10, None]
    return df


def test_validate_bars_accepts_and_normalizes() -> None:
    df = validate_bars(_bars(), "X")
    assert list(df.columns) == ["open", "high", "low", "close", "volume"]
    assert df["volume"].tolist() == [10.0, 0.0]


@pytest.mark.parametrize("cols", [{"close": [1.2, -1.0]}, {"high": [0.1, 2.5]}])
def test_validate_bars_rejects_bad_prices(cols: dict[str, list[float]]) -> None:
    with pytest.raises(DataProviderError):
        validate_bars(_bars(**cols), "X")


def test_validate_bars_rejects_empty() -> None:
    with pytest.raises(DataError):
        validate_bars(_bars().iloc[0:0], "X")


def test_caching_provider_fetches_once() -> None:
    calls: list[str] = []
    inner = FixtureProvider(FIXTURES)

    class Counting:
        name = "fixture"

        def get_daily_bars(self, ticker: str, start: dt.date, end: dt.date) -> pd.DataFrame:
            calls.append(ticker)
            return inner.get_daily_bars(ticker, start, end)

    provider = CachingProvider(Counting(), MemoryBarCache())
    a = provider.get_daily_bars("DEMO", dt.date(2022, 1, 1), dt.date(2022, 6, 30))
    b = provider.get_daily_bars("DEMO", dt.date(2022, 1, 1), dt.date(2022, 6, 30))
    assert calls == ["DEMO"]
    pd.testing.assert_frame_equal(a, b)


def test_generated_schema_is_current() -> None:
    """ADR-0002: committed packages/shared schema matches the Pydantic models."""
    proc = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "export_schema.py"), "--check"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr


def test_backtest_fetches_warmup_history(client: TestClient) -> None:
    res = client.post("/backtest", json={"strategy": demo_strategy(start_date="2022-06-01")})
    assert res.status_code == 200
    result = BacktestResult.model_validate(res.json())
    assert result.assumptions.warmup_bars >= 3 * 14
    assert result.start_date >= dt.date(2022, 6, 1)
    assert result.equity_curve[0].date == result.start_date


def test_caching_provider_skips_ranges_reaching_today() -> None:
    calls: list[str] = []
    inner = FixtureProvider(FIXTURES)

    class Counting:
        name = "fixture"

        def get_daily_bars(self, ticker: str, start: dt.date, end: dt.date) -> pd.DataFrame:
            calls.append(ticker)
            return inner.get_daily_bars(ticker, start, end)

    cache = MemoryBarCache()
    provider = CachingProvider(Counting(), cache, today=lambda: dt.date(2022, 6, 30))
    for _ in range(2):
        provider.get_daily_bars("DEMO", dt.date(2022, 1, 1), dt.date(2022, 6, 30))
    assert calls == ["DEMO", "DEMO"]
    assert cache.get("fixture:DEMO:2022-01-01:2022-06-30") is None


def test_yfinance_missing_ticker_is_input_error(monkeypatch: pytest.MonkeyPatch) -> None:
    import yfinance as yf
    from yfinance.exceptions import YFPricesMissingError

    from quant.data import YFinanceProvider

    class FakeTicker:
        def __init__(self, ticker: str) -> None: ...

        def history(self, **_: Any) -> pd.DataFrame:
            raise YFPricesMissingError("ZZZZ", "")

    monkeypatch.setattr(yf, "Ticker", FakeTicker)
    with pytest.raises(DataError):
        YFinanceProvider().get_daily_bars("ZZZZ", dt.date(2022, 1, 1), dt.date(2022, 2, 1))


def test_yfinance_network_failure_is_provider_error(monkeypatch: pytest.MonkeyPatch) -> None:
    import yfinance as yf

    from quant.data import YFinanceProvider

    class FakeTicker:
        def __init__(self, ticker: str) -> None: ...

        def history(self, **_: Any) -> pd.DataFrame:
            raise ConnectionError("connection reset")

    monkeypatch.setattr(yf, "Ticker", FakeTicker)
    with pytest.raises(DataProviderError):
        YFinanceProvider().get_daily_bars("AAPL", dt.date(2022, 1, 1), dt.date(2022, 2, 1))
