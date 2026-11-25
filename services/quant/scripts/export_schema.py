"""Export JSON Schema for the strategy and backtest result into packages/shared.

Usage (cwd services/quant): python scripts/export_schema.py [--check]
With --check, exits 1 if the committed files are stale (ADR-0002).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from quant.schema import BacktestResult, Strategy

OUT_DIR = Path(__file__).resolve().parents[3] / "packages" / "shared" / "schema"
MODELS = {"strategy.schema.json": Strategy, "backtest-result.schema.json": BacktestResult}


def render(model: type[Strategy] | type[BacktestResult]) -> str:
    schema = model.model_json_schema(
        mode="serialization" if model is BacktestResult else "validation"
    )
    return json.dumps(schema, indent=2, sort_keys=True) + "\n"


def main() -> int:
    check = "--check" in sys.argv[1:]
    stale: list[str] = []
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for filename, model in MODELS.items():
        path = OUT_DIR / filename
        content = render(model)
        current = path.read_text(encoding="utf-8") if path.exists() else None
        if current != content:
            if check:
                stale.append(filename)
            else:
                path.write_text(content, encoding="utf-8", newline="\n")
                print(f"wrote {path}")
    if stale:
        print(f"stale generated schema: {', '.join(stale)}; run export_schema.py", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
