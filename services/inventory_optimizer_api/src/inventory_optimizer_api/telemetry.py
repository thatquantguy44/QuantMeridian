from __future__ import annotations

import json
import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

LOGGER = logging.getLogger("inventory_optimizer_api")


def emit(event: str, **metadata: Any) -> None:
    LOGGER.info(json.dumps({"event": event, **metadata}, sort_keys=True, default=str))


@contextmanager
def timed(event: str, **metadata: Any) -> Iterator[None]:
    started = time.perf_counter()
    try:
        yield
    finally:
        emit(event, elapsed_ms=round((time.perf_counter() - started) * 1000, 2), **metadata)
