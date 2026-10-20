"""Who bears a loss: borrower losses go to beneficial owners, pool losses to borrowers and owners.

* A borrower's default loss is shared among owners pro rata to the starting value of each owner's
  securities on loan to it.
* The pool's loss is shared among borrowers pro rata to their cash collateral, and among owners by
  the pool's own owner shares.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from .market import MarketModel


def owner_shares(
    snapshot: dict[str, Any], borrower_ids: list[str], market: MarketModel
) -> np.ndarray:
    """(B, O): each owner's share of the securities on loan to each borrower, by starting value."""
    owners = [o["id"] for o in snapshot["owners"]]
    o_index = {o: i for i, o in enumerate(owners)}
    b_index = {b: i for i, b in enumerate(borrower_ids)}
    value = np.zeros((len(b_index), len(owners)))
    for loan in snapshot["loans"]:
        sec = market.index[loan["security_id"]]
        value[b_index[loan["borrower_id"]], o_index[loan["owner_id"]]] += (
            loan["quantity"] * market.price0[sec]
        )
    return value / value.sum(axis=1, keepdims=True)


def pool_owner_shares(snapshot: dict[str, Any]) -> dict[str, float]:
    return {s["owner_id"]: s["share"] for s in snapshot["pool"]["owner_shares"]}
