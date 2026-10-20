"""Which loans are on loan at each event step (spec020 PLAN section 4, decision 5).

An open loan returns at an exponential time with hazard

    base * (recallable_multiplier if the loan is recallable) * exp(stress_sensitivity * max(0,
    -Z_eq))

per year, where Z_eq is the standardized equity factor return over the run horizon, so returns come
in waves when equities fall. A term loan runs to its maturity and does not return early.

* Desk view: a returned loan stays returned and a matured term loan stays matured.
* Annual view: the book is constant. A loan that returns (or matures) in a step is off on that
  step's event day and replaced by the next, so the pool sees the cash leave and come back.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from .book import Book
from .grid import YEAR_DAYS, Grid


@dataclass(frozen=True)
class ReturnNoise:
    exp: np.ndarray  # (n, L) standard exponential draws: return times in the desk view
    u: np.ndarray  # (n, K, L) uniform draws: per-step returns in the annual view


def draw_return_noise(
    rng: np.random.Generator, n_paths: int, steps: int, n_loans: int
) -> ReturnNoise:
    return ReturnNoise(
        rng.standard_exponential((n_paths, n_loans)), rng.random((n_paths, steps, n_loans))
    )


def build_activity(
    book: Book, returns: dict[str, Any], z_eq: np.ndarray, grid: Grid, noise: ReturnNoise
) -> np.ndarray:
    """Boolean (n, K + 1, L): True when the loan is on loan on that event day."""
    days = grid.event_days
    n, n_loans = len(z_eq), len(book.loan_ids)
    base = returns["open_loan_hazard_annual"] / YEAR_DAYS
    per_day = base * np.where(book.loan_recallable, returns["recallable_multiplier"], 1.0)  # (L,)
    stress = np.exp(returns["stress_sensitivity"] * np.maximum(0.0, -z_eq))  # (n,)
    rate = stress[:, None] * per_day[None, :]  # (n, L) per business day
    open_loan = np.isinf(book.loan_maturity)
    out = np.ones((n, len(days), n_loans), dtype=bool)

    if book.mode == "desk":
        with np.errstate(divide="ignore"):
            return_day = np.where(rate > 0, noise.exp / np.where(rate > 0, rate, 1.0), np.inf)
        for k, day in enumerate(days):
            on = np.where(open_loan[None, :], day < return_day, day < book.loan_maturity[None, :])
            out[:, k, :] = on
        return out

    for k in range(1, len(days)):
        step = days[k] - days[k - 1]
        returned = noise.u[:, k - 1, :] < -np.expm1(-rate * step)
        crossed = np.floor(days[k] / book.loan_maturity) > np.floor(
            days[k - 1] / book.loan_maturity
        )
        out[:, k, :] = ~np.where(open_loan[None, :], returned, crossed[None, :])
    return out
