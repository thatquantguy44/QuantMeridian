"""Borrower default probabilities (spec020 decision 2, IND-018).

Each borrower has a constant hazard rate. By default it comes from the snapshot's rating to one-year
PD table, ``hazard = -ln(1 - PD_1y)``. A user-entered credit spread overrides the table for that
borrower, ``hazard = spread / (1 - recovery)``. The source of each hazard is carried into the
results and the model card.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

RATING_TABLE = "RATING_TABLE"
USER_SPREAD = "USER_SPREAD"


@dataclass(frozen=True)
class BorrowerCredit:
    borrower_id: str
    rating: str
    source: str
    hazard: float
    pd_1y: float
    """Recovery used to convert the spread; None when the hazard comes from the table."""
    recovery: float | None


def hazard_from_pd(pd_1y: float) -> float:
    if not 0 < pd_1y < 1:
        raise ValueError(f"one-year PD must be in (0, 1), got {pd_1y}")
    return -math.log1p(-pd_1y)


def hazard_from_spread(spread_bps: float, recovery: float) -> float:
    if not spread_bps > 0:
        raise ValueError(f"credit spread must be positive, got {spread_bps} bps")
    if not 0 <= recovery < 1:
        raise ValueError(f"recovery must be in [0, 1), got {recovery}")
    return (spread_bps / 10_000.0) / (1.0 - recovery)


def default_probability(hazard: float, t_years: float) -> float:
    """Probability of default by time t under a constant hazard rate."""
    return -math.expm1(-hazard * t_years)


def resolve_borrower_credit(
    borrower: dict[str, Any], table: dict[str, Any], default_recovery: float
) -> BorrowerCredit:
    rating = borrower["rating"]
    spread = borrower.get("spread_bps")
    if spread is not None:
        recovery = borrower.get("recovery")
        recovery = default_recovery if recovery is None else recovery
        hazard = hazard_from_spread(spread, recovery)
        return BorrowerCredit(
            borrower["id"], rating, USER_SPREAD, hazard, default_probability(hazard, 1.0), recovery
        )
    pd_1y = table["pd_1y"].get(rating)
    if pd_1y is None:
        raise ValueError(f"rating table has no PD for rating {rating}")
    return BorrowerCredit(borrower["id"], rating, RATING_TABLE, hazard_from_pd(pd_1y), pd_1y, None)


def resolve_credit(snapshot: dict[str, Any]) -> dict[str, BorrowerCredit]:
    table = snapshot["rating_pd_table"]
    default_recovery = snapshot["model"]["default_recovery"]
    return {
        b["id"]: resolve_borrower_credit(b, table, default_recovery) for b in snapshot["borrowers"]
    }
