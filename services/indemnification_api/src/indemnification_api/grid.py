"""Run modes and the event grid (spec020 decision 5, IND-021).

Prices are always simulated daily. The event grid is the set of business days at which defaults and
exposures are evaluated; its step comes from ``run.step``. The desk view (default) looks at today's
book over one month; the annual view looks at a constant book over a year. The mode changes how the
book behaves (see ``book.py``), not the grid arithmetic.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

YEAR_DAYS = 252
STEP_DAYS = {"daily": 1, "weekly": 5, "monthly": 21}
MIN_HORIZON_DAYS = 21
MAX_HORIZON_DAYS = 1260


@dataclass(frozen=True)
class Grid:
    mode: str
    horizon_days: int
    step_days: int
    event_days: np.ndarray

    @property
    def years(self) -> np.ndarray:
        return self.event_days / YEAR_DAYS


def build_grid(run: dict[str, Any]) -> Grid:
    horizon = int(run["horizon_days"])
    if not MIN_HORIZON_DAYS <= horizon <= MAX_HORIZON_DAYS:
        raise ValueError(
            f"horizon_days must be between {MIN_HORIZON_DAYS} and {MAX_HORIZON_DAYS}, got {horizon}"
        )
    step = STEP_DAYS[run["step"]]
    days = list(range(0, horizon + 1, step))
    if days[-1] != horizon:
        days.append(horizon)
    return Grid(run["mode"], horizon, step, np.array(days, dtype=np.int64))
