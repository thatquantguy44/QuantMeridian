"""Basel comprehensive approach cross-check (spec020 IND-009, AC-006).

Per borrower (one netting set), at the start of the run:

    E* = max(0, E * (1 + He) - C * (1 - Hc - Hfx))

summed over the borrower's positions with each position's own haircut. Haircuts come from the
snapshot's illustrative supervisory table (set for ``base_mpor_days``) and are scaled by ``sqrt(MPOR
/ base)`` using the position's own close-out period. Cash has no haircut; collateral in a different
currency from the security it covers takes the FX mismatch haircut. This is a deterministic
reasonableness bound to read beside the Monte Carlo PFE, not regulatory capital.
"""

from __future__ import annotations

import math
from typing import Any

from .profile import resolve_all


def supervisory_haircut(security: dict[str, Any], table: dict[str, Any]) -> float:
    """The table haircut for a security at the base close-out period."""
    asset_class = security["asset_class"]
    if asset_class in ("EQUITY", "ETF"):
        main_index = asset_class == "ETF" or (
            security["liquidity_class"] == "liquid" and not security["hard_to_borrow"]
        )
        return table["equity_main_index"] if main_index else table["equity_other"]
    if asset_class not in ("GOVT", "CORP"):
        return table["equity_other"]  # anything else takes the highest haircut
    bands = table["sovereign" if asset_class == "GOVT" else "corporate"]
    duration = security["rate_duration"]
    return (
        bands["le_1y"] if duration <= 1 else bands["1y_to_5y"] if duration <= 5 else bands["gt_5y"]
    )


def comprehensive_approach(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    table = snapshot["basel_haircuts"]
    base = table["base_mpor_days"]
    securities = {s["id"]: s for s in snapshot["securities"]}
    rows = {row.position_id: row for row in resolve_all(snapshot)}
    sets: dict[str, dict[str, float]] = {}

    def netting_set(borrower_id: str) -> dict[str, float]:
        return sets.setdefault(borrower_id, {"e": 0.0, "e_adj": 0.0, "c": 0.0, "c_adj": 0.0})

    for loan in snapshot["loans"]:
        sec = securities[loan["security_id"]]
        value = loan["quantity"] * sec["price"]
        scale = math.sqrt(rows[loan["id"]].mpor_days / base)
        s = netting_set(loan["borrower_id"])
        s["e"] += value
        s["e_adj"] += value * (1.0 + supervisory_haircut(sec, table) * scale)

    loan_currencies: dict[str, set[str]] = {}
    for loan in snapshot["loans"]:
        loan_currencies.setdefault(loan["borrower_id"], set()).add(
            securities[loan["security_id"]]["currency"]
        )
    for holding in snapshot["collateral"]:
        s = netting_set(holding["borrower_id"])
        if holding["kind"] == "CASH":
            s["c"] += holding["cash_amount"]
            s["c_adj"] += holding["cash_amount"]
            continue
        sec = securities[holding["security_id"]]
        value = holding["quantity"] * sec["price"]
        scale = math.sqrt(rows[holding["id"]].mpor_days / base)
        mismatch = sec["currency"] not in loan_currencies.get(
            holding["borrower_id"], {sec["currency"]}
        )
        haircut = (
            supervisory_haircut(sec, table) + (table["fx_mismatch"] if mismatch else 0.0)
        ) * scale
        s["c"] += value
        s["c_adj"] += value * (1.0 - haircut)

    return [
        {
            "borrower_id": borrower_id,
            "exposure": s["e"],
            "collateral": s["c"],
            "e_star": max(0.0, s["e_adj"] - s["c_adj"]),
        }
        for borrower_id, s in sorted(sets.items())
    ]
