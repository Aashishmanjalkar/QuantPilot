"""FastAPI app. Internal service: only apps/api calls it (docs/architecture.md).

Error responses use one shape: {"error": {"code": str, "message": str, "details"?: list}}.
"""

from __future__ import annotations

import datetime as dt
import logging
import math
from pathlib import Path
from typing import Any, Literal

import pandas as pd
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic_settings import BaseSettings, SettingsConfigDict

from quant.data import (
    CachingProvider,
    DataError,
    DataProvider,
    DataProviderError,
    FixtureProvider,
    PostgresBarCache,
    YFinanceProvider,
)
from quant.engine import run_backtest
from quant.schema import BacktestRequest, BacktestResult, Strategy

log = logging.getLogger("quant")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="QUANT_", extra="ignore")

    data_provider: Literal["yfinance", "fixture"] = "yfinance"
    fixture_dir: Path = Path(__file__).resolve().parents[2] / "fixtures" / "bars"
    cache_database_url: str | None = None


def build_provider(settings: Settings) -> DataProvider:
    inner: DataProvider
    if settings.data_provider == "fixture":
        inner = FixtureProvider(settings.fixture_dir)
    else:
        inner = YFinanceProvider()
    if settings.cache_database_url:
        return CachingProvider(inner, PostgresBarCache(settings.cache_database_url))
    return inner


def warmup_days(period: int) -> dt.timedelta:
    """Calendar days to fetch before start_date so RSI has ~3x period bars of history."""
    return dt.timedelta(days=math.ceil(period * 3 * 7 / 5) + 10)


def _error(status: int, code: str, message: str, details: Any = None) -> JSONResponse:
    body: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        body["details"] = details
    return JSONResponse(status_code=status, content={"error": body})


def create_app(provider: DataProvider | None = None) -> FastAPI:
    data = provider if provider is not None else build_provider(Settings())
    app = FastAPI(title="QuantPilot quant service", version="0.1.0")

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {
                "path": ".".join(str(p) for p in err.get("loc", ()) if p != "body"),
                "message": err.get("msg", "invalid value"),
            }
            for err in exc.errors()
        ]
        return _error(422, "validation_error", "Strategy is invalid", details)

    @app.exception_handler(DataError)
    async def _data_error(_: Request, exc: DataError) -> JSONResponse:
        return _error(422, "no_data", str(exc))

    @app.exception_handler(DataProviderError)
    async def _provider_error(_: Request, exc: DataProviderError) -> JSONResponse:
        return _error(502, "data_provider_error", str(exc))

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "data_provider": data.name}

    @app.post("/strategies/validate")
    def validate_strategy(strategy: Strategy) -> Strategy:
        return strategy

    @app.post("/backtest")
    def backtest(request: BacktestRequest) -> BacktestResult:
        s = request.strategy
        fetch_start = s.start_date - warmup_days(max(s.entry.period, s.exit.period))
        bars = data.get_daily_bars(s.ticker, fetch_start, s.end_date)
        if not (bars.index >= pd.Timestamp(s.start_date)).any():
            raise DataError(f"no price data for {s.ticker} in the requested range")
        return run_backtest(s, bars, data_source=data.name)

    return app
