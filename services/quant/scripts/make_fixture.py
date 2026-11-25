"""Generate the deterministic synthetic DEMO ticker used by tests and the E2E stack.

Usage (cwd services/quant): python scripts/make_fixture.py
The output is committed; regenerate only on purpose.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parents[1] / "fixtures" / "bars" / "DEMO.csv"


def main() -> None:
    rng = np.random.default_rng(20261123)
    dates = pd.bdate_range("2022-01-03", "2023-12-29")
    n = len(dates)
    t = np.arange(n)
    drift = 0.0002 * t
    cycle = 0.12 * np.sin(2 * np.pi * t / 60)
    noise = np.cumsum(rng.normal(0, 0.008, n))
    close = 100 * np.exp(drift + cycle + noise)
    open_ = close * np.exp(rng.normal(0, 0.004, n))
    high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, 0.004, n)))
    low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, 0.004, n)))
    volume = rng.integers(500_000, 2_000_000, n)
    df = pd.DataFrame(
        {
            "date": dates.strftime("%Y-%m-%d"),
            "open": open_.round(4),
            "high": high.round(4),
            "low": low.round(4),
            "close": close.round(4),
            "volume": volume,
        }
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT, index=False, lineterminator="\n")
    print(f"wrote {OUT} ({n} bars)")


if __name__ == "__main__":
    main()
