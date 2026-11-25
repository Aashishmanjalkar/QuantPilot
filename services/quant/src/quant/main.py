"""ASGI entry point: `uvicorn quant.main:app`."""

import logging

from quant.app import create_app

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

app = create_app()
