"""One-parameter sensitivities on common random numbers (spec020 IND-010, AC-003).

A sweep re-runs the model once per value with the same seed. The random draws do not depend on the
swept parameter, so every point sees identical paths and defaults, and a quantity that is monotone
in the parameter path by path (shortfall in margin, in the close-out period, in the liquidity cost)
is exactly monotone in the sweep, not just on average. Sweeps may use fewer paths than the main run.

Parameters:

* ``margin_pct``: every loan's margin, in percent.
* ``mpor_days``: one close-out period for every position (``mpor_fixed_days`` in the profile
  defaults).
* ``rho_w``: the wrong-way correlation.
* ``collateral_substitution``: the share (0 to 1) of one borrower's security collateral, by value,
  replaced with the snapshot's most liquid government security. The borrower defaults to the one
  with the most security collateral.
* ``profile:<setting>``: any numeric setting in the close-out profile defaults.
"""

from __future__ import annotations

import copy
import math
from typing import Any

from .contracts import seal
from .engine import GAUSSIAN_WW, simulate
from .metrics import Metric, channel_metrics
from .schema import SnapshotRejected, require_valid_snapshot

PARAMETERS = ("margin_pct", "mpor_days", "rho_w", "collateral_substitution")
DEFAULT_SWEEPS: dict[str, list[float]] = {
    "margin_pct": [102.0, 105.0, 108.0, 110.0],
    "mpor_days": [3, 5, 10, 20],
    "rho_w": [0.0, 0.15, 0.3, 0.5],
    "collateral_substitution": [0.0, 0.5, 1.0],
}
MIN_PATHS = 1000


def _mean_metric(x: Any) -> Metric:
    se = float(x.std(ddof=1) / math.sqrt(len(x))) if len(x) > 1 else None
    return Metric(float(x.mean()), se)


def _security_holders(snapshot: dict[str, Any]) -> dict[str, float]:
    prices = {s["id"]: s["price"] for s in snapshot["securities"]}
    value: dict[str, float] = {}
    for h in snapshot["collateral"]:
        if h["kind"] == "SECURITY":
            value[h["borrower_id"]] = (
                value.get(h["borrower_id"], 0.0) + h["quantity"] * prices[h["security_id"]]
            )
    return value


def _substitute(snapshot: dict[str, Any], share: float, borrower_id: str | None) -> None:
    holders = _security_holders(snapshot)
    if not holders:
        raise ValueError(
            "collateral_substitution needs a borrower with security collateral; "
            "the snapshot has no security collateral"
        )
    govts = [s for s in snapshot["securities"] if s["asset_class"] == "GOVT"]
    if not govts:
        raise ValueError(
            "collateral_substitution needs a government security in the snapshot to substitute"
        )
    borrower = borrower_id or max(holders, key=holders.__getitem__)
    if borrower not in holders:
        raise ValueError(f"borrower {borrower} has no security collateral to substitute")
    target = max(govts, key=lambda s: s["adv_units"])
    prices = {s["id"]: s["price"] for s in snapshot["securities"]}
    moved = 0.0
    for h in snapshot["collateral"]:
        if h["kind"] == "SECURITY" and h["borrower_id"] == borrower:
            moved += h["quantity"] * prices[h["security_id"]] * share
            h["quantity"] *= 1.0 - share
    snapshot["collateral"] = [
        h for h in snapshot["collateral"] if h["kind"] != "SECURITY" or h["quantity"] > 0
    ]
    existing = next(
        (
            h
            for h in snapshot["collateral"]
            if h["borrower_id"] == borrower and h["security_id"] == target["id"]
        ),
        None,
    )
    if moved > 0:
        if existing is not None:
            existing["quantity"] += moved / target["price"]
        else:
            snapshot["collateral"].append(
                {
                    "id": f"SUB-{borrower}",
                    "borrower_id": borrower,
                    "kind": "SECURITY",
                    "security_id": target["id"],
                    "quantity": moved / target["price"],
                    "cash_amount": None,
                    "provenance": "user_input",
                }
            )


def _requirements(snapshot: dict[str, Any]) -> dict[str, list[float]]:
    """Per borrower, [cash required, non-cash required] by starting loan value and margin."""
    prices = {s["id"]: s["price"] for s in snapshot["securities"]}
    out: dict[str, list[float]] = {}
    for item in snapshot["loans"]:
        need = item["quantity"] * prices[item["security_id"]] * item["margin_pct"] / 100.0
        out.setdefault(item["borrower_id"], [0.0, 0.0])[
            0 if item["collateral_type"] == "CASH" else 1
        ] += need
    return out


def _resize_collateral(s: dict[str, Any], old: dict[str, list[float]]) -> None:
    """After margins change, resize each borrower's holdings and the reinvestment pool to match.

    The pool holds the cash collateral, so when cash owed grows by a factor the pool grows by the
    same factor (keeping its mix and any opening gap). Without this a margin sweep would run on a
    book that does not add up.
    """
    new = _requirements(s)
    for item in s["collateral"]:
        before, after = old.get(item["borrower_id"]), new.get(item["borrower_id"])
        if not before or not after:
            continue
        slot = 0 if item["kind"] == "CASH" else 1
        if before[slot] > 0:
            ratio = after[slot] / before[slot]
            if item["kind"] == "CASH":
                item["cash_amount"] *= ratio
            else:
                item["quantity"] *= ratio
    old_cash, new_cash = sum(v[0] for v in old.values()), sum(v[0] for v in new.values())
    if old_cash > 0:
        for position in s["pool"]["positions"]:
            position["allocation"] *= new_cash / old_cash


def _apply(
    snapshot: dict[str, Any], parameter: str, value: float, borrower_id: str | None
) -> dict[str, Any]:
    s = copy.deepcopy(snapshot)
    if parameter == "margin_pct":
        old = _requirements(s)
        for item in s["loans"]:
            item["margin_pct"] = value
        _resize_collateral(s, old)
    elif parameter == "mpor_days":
        s["closeout_profile"]["defaults"]["mpor_fixed_days"] = int(value)
    elif parameter == "rho_w":
        s["model"]["rho_w"] = value
    elif parameter == "collateral_substitution":
        if not 0.0 <= value <= 1.0:
            raise ValueError(f"collateral_substitution must be between 0 and 1, got {value}")
        _substitute(s, value, borrower_id)
    elif parameter.startswith("profile:"):
        setting = parameter.split(":", 1)[1]
        if setting not in s["closeout_profile"]["defaults"]:
            raise ValueError(f"unknown close-out profile setting {setting}")
        s["closeout_profile"]["defaults"][setting] = value
    else:
        raise ValueError(f"unknown parameter {parameter}")
    return s


def run_sensitivity(
    snapshot: dict[str, Any],
    parameter: str,
    values: list[float],
    *,
    paths: int | None = None,
    borrower_id: str | None = None,
) -> dict[str, Any]:
    if not values:
        raise ValueError("a sweep needs at least one value")
    if parameter not in PARAMETERS and not parameter.startswith("profile:"):
        raise ValueError(f"unknown parameter {parameter}")
    if paths is not None and paths < MIN_PATHS:
        raise ValueError(f"a sweep needs at least {MIN_PATHS} paths, got {paths}")
    el, el_default, el_reinvestment, pfe99 = [], [], [], []
    for value in values:
        point = _apply(snapshot, parameter, value, borrower_id)
        if paths is not None:
            point["run"] = {**point["run"], "paths": paths}
        point = seal(point)
        try:
            require_valid_snapshot(point)
        except SnapshotRejected as error:
            raise ValueError(
                f"{parameter} = {value} is not allowed: {'; '.join(error.issues)}"
            ) from error
        out = simulate(point, validate=False)
        v = out.variants[GAUSSIAN_WW]
        metrics = channel_metrics(
            cond=v.cond.sum(axis=1) + out.pool_loss,
            sampled=v.sampled.sum(axis=1) + out.pool_loss,
            exposure=out.exposure.sum(axis=1).astype(float),
            grid=out.grid,
        )
        el.append(metrics["el"].as_dict())
        pfe99.append(metrics["pfe99"].as_dict())
        cond = v.cond.sum(axis=1)
        el_default.append(_mean_metric(cond).as_dict())
        el_reinvestment.append(_mean_metric(out.pool_loss).as_dict())
    return {
        "parameter": parameter,
        "values": [float(v) for v in values],
        "el": el,
        "el_default_shortfall": el_default,
        "el_reinvestment": el_reinvestment,
        "pfe99": pfe99,
    }


def default_sensitivities(
    snapshot: dict[str, Any], *, paths: int | None = 5000
) -> list[dict[str, Any]]:
    """The standard sweeps: margin, close-out period, wrong-way correlation, collateral
    substitution.
    """
    limit = math.sqrt(snapshot["model"]["rho_d"])
    sweeps = []
    for parameter in PARAMETERS:
        values = DEFAULT_SWEEPS[parameter]
        if parameter == "rho_w":
            values = [v for v in values if v <= limit + 1e-12]
        if parameter == "collateral_substitution" and not (
            _security_holders(snapshot)
            and any(s["asset_class"] == "GOVT" for s in snapshot["securities"])
        ):
            continue
        sweeps.append(run_sensitivity(snapshot, parameter, values, paths=paths))
    return sweeps
