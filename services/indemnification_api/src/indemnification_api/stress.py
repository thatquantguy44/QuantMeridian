"""Named deterministic stress scenarios (spec020 IND-011, IND-020).

Each scenario is one hand-built price path with no randomness, closed out under the snapshot's
close-out profile (optionally overridden for the scenario alone). The default is forced at the first
step and the shock lands one day later, inside the close-out period: collateral was last reset
before the shock, so the move is a real gap loss. (A shock at the default day would be absorbed by
that day's margin call.)

* ``largest_borrower_default``: equity down 20% and the borrower with the most securities on loan
  defaults.
* ``squeeze``: the most concentrated hard-to-borrow loan rises 60% and its borrower defaults.
* ``rates_shock``: yields up 150 bp. Each borrower's figure is its own default under the shock, not
  a joint event.
* ``fx_shock``: the base currency gains 15% on every other currency. Each borrower's figure is its
  own default. Only non-base-currency positions are affected.
* ``reinvestment_run``: credit spreads up 200 bp, the largest BANK issuer in the pool defaults and
  30% of the cash collateral is returned within a week.

Default losses go to owners pro rata to starting loan value; reinvestment losses go to borrowers by
cash collateral share and to owners by the pool's owner shares.
"""

from __future__ import annotations

import copy
import math
from typing import Any

import numpy as np

from .attribution import owner_shares, pool_owner_shares
from .book import build_book
from .closeout import cash_requirements, default_activity, evaluate, required_days
from .contracts import seal
from .grid import build_grid
from .market import MarketModel, Paths, build_market
from .pool import build_pool, run_pool
from .profile import resolve_all
from .schema import require_valid_snapshot

SCENARIOS = (
    "largest_borrower_default",
    "squeeze",
    "rates_shock",
    "fx_shock",
    "reinvestment_run",
)
SHOCK_DAY = 2
STRESS_HORIZON = 21
EQUITY_SHOCK, SQUEEZE_SHOCK, RATES_SHOCK, FX_SHOCK = -0.20, 0.60, 0.015, -0.15
SPREAD_SHOCK, RETURNED_SHARE, RETURN_DAY = 0.02, 0.30, 5


def _paths(
    market: MarketModel,
    days: int,
    *,
    factor_shock: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0),
    security_shock: dict[str, float] | None = None,
    shock_day: int = SHOCK_DAY,
) -> Paths:
    """One path with no noise: a shock to factors and/or single securities from `shock_day`."""
    factors = np.zeros((1, days + 1, 4))
    factors[0, shock_day:, :] = factor_shock
    log_price = np.zeros((1, days + 1, len(market.security_ids)))
    log_price[0, shock_day:, :] = np.asarray(factor_shock) @ market.loadings.T
    for security, log_move in (security_shock or {}).items():
        log_price[0, shock_day:, market.index[security]] += log_move
    return Paths(factors, log_price, np.zeros((1, 0), dtype=int))


def _stress_snapshot(snapshot: dict[str, Any], overrides: dict[str, Any] | None) -> dict[str, Any]:
    s = copy.deepcopy(snapshot)
    s["run"] = {**s["run"], "mode": "desk", "horizon_days": STRESS_HORIZON, "step": "daily"}
    s["closeout_profile"]["defaults"].update(overrides or {})
    s = seal(s)
    require_valid_snapshot(s)  # an override that breaks the profile schema is rejected here
    return s


def run_stresses(
    snapshot: dict[str, Any], *, profile_overrides: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    snap = _stress_snapshot(snapshot, profile_overrides)
    market = build_market(snap)
    book = build_book(snap, market)
    grid = build_grid(snap["run"])
    n_b = book.n_borrowers
    shares = owner_shares(snap, book.borrower_ids, market)
    owner_ids = [o["id"] for o in snap["owners"]]
    pool = build_pool(snap, market)
    days = required_days(book, grid)
    if pool is not None:
        days = max(days, grid.horizon_days + int(pool.mpor.max()))
    activity = default_activity(book)

    def default_losses(paths: Paths) -> np.ndarray:
        """Shortfall if each borrower defaults at the first step, (B,)."""
        return evaluate(book, market, paths, grid, activity=activity).shortfall[0, :, 0]

    start_value = np.zeros(n_b)
    for i in range(len(book.loan_ids)):
        start_value[book.loan_borrower[i]] += book.loan_qty[i] * market.price0[book.loan_sec[i]]
    base = snap["currency"]
    held = {x["security_id"] for x in snap["loans"]} | {
        x["security_id"] for x in snap["collateral"] if x["security_id"]
    }
    foreign = any(s["currency"] != base for s in snap["securities"] if s["id"] in held)

    def single(losses: np.ndarray, b: int) -> np.ndarray:
        out = np.zeros(n_b)
        out[b] = losses[b]
        return out

    results: dict[str, tuple[str, np.ndarray, np.ndarray]] = {}
    zero = np.zeros(n_b)

    largest = int(np.argmax(start_value))
    losses = default_losses(_paths(market, days, factor_shock=(EQUITY_SHOCK, 0.0, 0.0, 0.0)))
    results["largest_borrower_default"] = (
        "Largest borrower defaults with equities down 20%: only that borrower defaults.",
        single(losses, largest),
        zero,
    )

    rows = {row.position_id: row for row in resolve_all(snap)}
    securities = {s["id"]: s for s in snap["securities"]}
    concentration = [
        book.loan_qty[i] / max(rows[loan_id].adv_units, 1e-12)
        for i, loan_id in enumerate(book.loan_ids)
    ]
    hard = [
        i
        for i, loan in enumerate(snap["loans"])
        if securities[loan["security_id"]]["hard_to_borrow"]
    ]
    target = max(hard or range(len(book.loan_ids)), key=lambda i: concentration[i])
    target_security = snap["loans"][target]["security_id"]
    squeeze_borrower = int(book.loan_borrower[target])
    losses = default_losses(
        _paths(market, days, security_shock={target_security: math.log1p(SQUEEZE_SHOCK)})
    )
    note = "" if hard else " (no hard-to-borrow loans, so the most concentrated loan overall)"
    results["squeeze"] = (
        f"{target_security} up 60% on the most concentrated hard-to-borrow loan; "
        f"its borrower defaults{note}.",
        single(losses, squeeze_borrower),
        zero,
    )

    losses = default_losses(_paths(market, days, factor_shock=(0.0, RATES_SHOCK, 0.0, 0.0)))
    results["rates_shock"] = (
        "Yields up 150 bp. Each borrower's figure is its own default under the shock, "
        "not a joint event.",
        losses,
        zero,
    )

    losses = default_losses(_paths(market, days, factor_shock=(0.0, 0.0, 0.0, FX_SHOCK)))
    fx_note = (
        "Each borrower's figure is its own default under the shock."
        if foreign
        else f"The book has no non-{base} positions, so the shock has no effect."
    )
    results["fx_shock"] = (f"{base} up 15% against every other currency. {fx_note}", losses, zero)

    results["reinvestment_run"] = _reinvestment_run(snap, market, book, grid, pool, days, activity)

    out = []
    for scenario in SCENARIOS:
        label, default, reinvestment = results[scenario]
        owner_default = default @ shares
        pool_shares = pool_owner_shares(snap)
        total_reinvestment = float(reinvestment.sum())
        out.append(
            {
                "id": scenario,
                "label": label,
                "by_borrower": [
                    {
                        "borrower_id": book.borrower_ids[b],
                        "default_shortfall": float(default[b]),
                        "reinvestment": float(reinvestment[b]),
                    }
                    for b in range(n_b)
                ],
                "by_owner": [
                    {
                        "owner_id": owner_ids[o],
                        "default_shortfall": float(owner_default[o]),
                        "reinvestment": total_reinvestment * pool_shares.get(owner_ids[o], 0.0),
                    }
                    for o in range(len(owner_ids))
                ],
            }
        )
    return out


def _reinvestment_run(
    snap: dict[str, Any],
    market: MarketModel,
    book: Any,
    grid: Any,
    pool: Any,
    days: int,
    activity: Any,
) -> tuple[str, np.ndarray, np.ndarray]:
    n_b = book.n_borrowers
    if pool is None:
        return (
            "The snapshot has no reinvestment pool, so there is nothing to stress.",
            np.zeros(n_b),
            np.zeros(n_b),
        )
    paths = _paths(market, days, factor_shock=(0.0, 0.0, SPREAD_SHOCK, 0.0), shock_day=1)
    owed = cash_requirements(book, market, paths, grid, activity)
    owed[:, :, grid.event_days >= RETURN_DAY] *= 1.0 - RETURNED_SHARE
    u = np.full((1, len(grid.event_days) - 1, pool.n_positions), 0.999999)
    bank = [
        j
        for j, position in enumerate(snap["pool"]["positions"])
        if position["credit_bucket"] == "BANK"
    ]
    if bank:
        u[0, 0, max(bank, key=lambda j: pool.alloc[j])] = 0.0
    loss = float(run_pool(pool, market, paths, grid, owed, u).loss[0])
    cash = owed[0, :, 0]
    share = cash / cash.sum() if cash.sum() > 0 else np.zeros(n_b)
    note = "" if bank else " (the pool has no BANK issuer to default)"
    return (
        "Credit spreads up 200 bp, the largest BANK issuer defaults and 30% of the cash "
        f"collateral is returned within a week{note}.",
        np.zeros(n_b),
        loss * share,
    )
