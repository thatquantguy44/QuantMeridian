"""The lending book as arrays (spec020 PLAN sections 3 and 3a).

Loans, collateral and the resolved close-out settings are flattened into arrays so the close-out can
be evaluated for every path at once. Loans that share a borrower, security and close-out settings
are one *leg*, so market impact is charged on the aggregate quantity. Collateral securities are legs
of the same kind; each takes a share of the borrower's non-cash requirement equal to its share of
the borrower's security collateral at the start.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np

from .market import FACTORS, MarketModel
from .profile import EffectiveSettings, resolve_all

# Direction of each factor that hurts liquidity (stress multiplier): equities and FX down, yields
# and
# credit spreads up.
ADVERSE_SIGN = np.array([-1.0, 1.0, 1.0, -1.0])


@dataclass(frozen=True)
class Legs:
    borrower: np.ndarray  # (G,) int
    sec: np.ndarray  # (G,) int
    mpor: np.ndarray  # (G,) int, business days
    k: np.ndarray
    alpha: np.ndarray
    floor: np.ndarray  # decimal
    cap: np.ndarray  # decimal, inf when there is no cap
    stress_beta: np.ndarray
    stress_factor: np.ndarray  # (G,) int index into FACTORS
    even: np.ndarray  # (G,) bool, True for an even unwind
    adv: np.ndarray
    vol: np.ndarray
    weight: np.ndarray  # share of the borrower's non-cash requirement (collateral legs)

    def __len__(self) -> int:
        return len(self.borrower)


@dataclass(frozen=True)
class Book:
    mode: str
    borrower_ids: list[str]
    loan_ids: list[str]
    loan_borrower: np.ndarray
    loan_sec: np.ndarray
    loan_qty: np.ndarray
    loan_margin: np.ndarray  # fraction, e.g. 1.02
    loan_cash: np.ndarray  # bool
    loan_maturity: np.ndarray  # business days; inf for open loans
    loan_call: np.ndarray  # margin call interval in business days
    loan_leg: np.ndarray  # leg index of each loan
    loan_legs: Legs
    coll_legs: Legs
    borrower_call: np.ndarray  # (B,) shortest margin call interval among the borrower's loans
    signs: np.ndarray  # (B,) wrong-way signs

    @property
    def n_borrowers(self) -> int:
        return len(self.borrower_ids)

    @property
    def max_mpor(self) -> int:
        longest = [int(legs.mpor.max()) for legs in (self.loan_legs, self.coll_legs) if len(legs)]
        return max(longest) if longest else 0


def _leg_key(row: EffectiveSettings, sec: int, borrower: int) -> tuple:
    s = row.settings
    cap = math.inf if s["cost_cap_bps"] is None else s["cost_cap_bps"] / 1e4
    return (
        borrower,
        sec,
        row.mpor_days,
        s["impact_k"],
        s["impact_alpha"],
        s["half_spread_floor_bps"] / 1e4,
        cap,
        s["stress_beta"],
        FACTORS.index(s["stress_factor"]),
        s["unwind"] == "even",
        row.adv_units,
        row.daily_vol,
    )


def _legs(keys: list[tuple], weights: list[float]) -> Legs:
    cols = list(zip(*keys, strict=True)) if keys else [()] * 12
    arr = lambda i, dtype: np.array(cols[i], dtype=dtype)  # noqa: E731
    return Legs(
        borrower=arr(0, int),
        sec=arr(1, int),
        mpor=arr(2, int),
        k=arr(3, float),
        alpha=arr(4, float),
        floor=arr(5, float),
        cap=arr(6, float),
        stress_beta=arr(7, float),
        stress_factor=arr(8, int),
        even=arr(9, bool),
        adv=arr(10, float),
        vol=arr(11, float),
        weight=np.array(weights, dtype=float),
    )


def build_book(snapshot: dict[str, Any], market: MarketModel) -> Book:
    effective = {row.position_id: row for row in resolve_all(snapshot)}
    borrower_ids = sorted({loan["borrower_id"] for loan in snapshot["loans"]})
    b_index = {b: i for i, b in enumerate(borrower_ids)}
    n_b = len(borrower_ids)

    loans = snapshot["loans"]
    loan_keys = []
    for loan in loans:
        sec = market.index[loan["security_id"]]
        loan_keys.append(_leg_key(effective[loan["id"]], sec, b_index[loan["borrower_id"]]))
    leg_keys = list(dict.fromkeys(loan_keys))
    loan_leg = np.array([leg_keys.index(k) for k in loan_keys], dtype=int)
    loan_legs = _legs(leg_keys, [1.0] * len(leg_keys))

    call = np.array(
        [effective[loan["id"]].settings["margin_call_every_days"] for loan in loans], dtype=int
    )
    loan_borrower = np.array([b_index[loan["borrower_id"]] for loan in loans], dtype=int)
    borrower_call = np.ones(n_b, dtype=int)
    for b in range(n_b):
        mine = call[loan_borrower == b]
        borrower_call[b] = int(mine.min()) if len(mine) else 1

    # Collateral securities: value shares per borrower at the start
    price0 = market.price0
    rows = [
        h for h in snapshot["collateral"] if h["kind"] == "SECURITY" and h["borrower_id"] in b_index
    ]
    totals: dict[int, float] = {}
    for h in rows:
        b = b_index[h["borrower_id"]]
        totals[b] = totals.get(b, 0.0) + h["quantity"] * price0[market.index[h["security_id"]]]
    coll: dict[tuple, float] = {}
    for h in rows:
        b = b_index[h["borrower_id"]]
        sec = market.index[h["security_id"]]
        key = _leg_key(effective[h["id"]], sec, b)
        coll[key] = coll.get(key, 0.0) + h["quantity"] * price0[sec] / totals[b]
    coll_legs = _legs(list(coll), list(coll.values()))

    for b, borrower in enumerate(borrower_ids):
        needs_securities = any(
            (not loan["collateral_type"] == "CASH") and loan["borrower_id"] == borrower
            for loan in loans
        )
        if needs_securities and b not in totals:
            raise ValueError(f"borrower {borrower} has non-cash loans but no security collateral")

    # Wrong-way sign: +1 when the borrower's exposure rises with equities
    beta = market.loadings[:, 0]
    loan_delta = np.zeros(n_b)
    for loan in loans:
        s = market.index[loan["security_id"]]
        loan_delta[b_index[loan["borrower_id"]]] += loan["quantity"] * price0[s] * beta[s]
    coll_delta = np.zeros(n_b)
    for h in rows:
        s = market.index[h["security_id"]]
        coll_delta[b_index[h["borrower_id"]]] += h["quantity"] * price0[s] * beta[s]
    signs = np.where(loan_delta >= coll_delta, 1.0, -1.0)

    return Book(
        mode=snapshot["run"]["mode"],
        borrower_ids=borrower_ids,
        loan_ids=[loan["id"] for loan in loans],
        loan_borrower=loan_borrower,
        loan_sec=np.array([market.index[loan["security_id"]] for loan in loans], dtype=int),
        loan_qty=np.array([loan["quantity"] for loan in loans], dtype=float),
        loan_margin=np.array([loan["margin_pct"] / 100.0 for loan in loans], dtype=float),
        loan_cash=np.array([loan["collateral_type"] == "CASH" for loan in loans], dtype=bool),
        loan_maturity=np.array(
            [loan["maturity_days"] if loan["term"] == "term" else math.inf for loan in loans],
            dtype=float,
        ),
        loan_call=call,
        loan_leg=loan_leg,
        loan_legs=loan_legs,
        coll_legs=coll_legs,
        borrower_call=borrower_call,
        signs=signs,
    )
