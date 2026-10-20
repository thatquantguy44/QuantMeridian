"""Assemble a run into the ``result-1.0`` contract (spec020 IND-006, IND-008, IND-014, IND-017).

Loss metrics come in three channels (default shortfall, reinvestment, total) for the Gaussian copula
with and without the wrong-way link, and for the Student-t sensitivity. Owner losses split a
borrower's default loss pro rata to the value of each owner's securities on loan to it at the start,
and reinvestment losses by the pool's owner shares. Sensitivities, stresses, the Basel cross-check
and pricing are separate tasks and are empty or null here.
"""

from __future__ import annotations

import hashlib
import math
from datetime import UTC, datetime
from typing import Any

import numpy as np

from . import MODEL_VERSION
from .attribution import owner_shares
from .basel import comprehensive_approach
from .contracts import profile_hash
from .engine import GAUSSIAN_NO_WW, GAUSSIAN_WW, STUDENT_T_WW, RunOutput, VariantLosses
from .metrics import Metric, channel_metrics, euler_expected_shortfall, euler_metrics, value_at_risk
from .pricing import allocate_capital, price_borrower
from .profile import resolve_all

LIMITATIONS = (
    "Synthetic data and illustrative parameters: this shows how the model behaves, not "
    "real-world risk levels."
)
NO_POOL_NOTE = (
    " The snapshot has no reinvestment pool, so the reinvestment channel is not modelled and "
    "reports zero."
)
CROSS_CHECK_LABEL = (
    "Basel comprehensive approach at the start of the run, with illustrative supervisory haircuts "
    "scaled by sqrt(MPOR / base); read it beside the Monte Carlo PFE99 (peak over the horizon). "
    "A reasonableness bound, not regulatory capital."
)
NO_PRICING_NOTE = (
    " Indemnification cost is shown only for the annual view over 252 business days, so no "
    "pricing is reported for this run."
)
PREVIEW_NOTE = " Preview run with a reduced path count; do not use for reported figures."
DESK_NOTE = (
    " Desk view of today's book over a short horizon: tail metrics need defaults, which are "
    "rare over a month for investment-grade borrowers."
)


def _dict(metrics: dict[str, Metric]) -> dict[str, Any]:
    return {name: m.as_dict() for name, m in metrics.items()}


def _channels(
    cond: np.ndarray, sampled: np.ndarray, pool: np.ndarray, exposure: np.ndarray, output: RunOutput
) -> dict[str, Any]:
    grid = output.grid
    return {
        "total": _dict(
            channel_metrics(cond=cond + pool, sampled=sampled + pool, exposure=exposure, grid=grid)
        ),
        "default_shortfall": _dict(
            channel_metrics(cond=cond, sampled=sampled, exposure=exposure, grid=grid)
        ),
        "reinvestment": _dict(channel_metrics(cond=pool, sampled=pool, exposure=None, grid=grid)),
    }


def _profile(exposure: np.ndarray, output: RunOutput) -> dict[str, Any]:
    return {
        "times_days": output.grid.event_days.astype(float).tolist(),
        "ee": exposure.mean(axis=0).tolist(),
        "pfe95": np.quantile(exposure, 0.95, axis=0, method="higher").tolist(),
        "pfe99": np.quantile(exposure, 0.99, axis=0, method="higher").tolist(),
    }


def _mean_metric(x: np.ndarray) -> Metric:
    se = float(x.std(ddof=1) / math.sqrt(len(x))) if len(x) > 1 else None
    return Metric(float(x.mean()), se)


def _pricing(
    snapshot: dict[str, Any],
    output: RunOutput,
    gaussian: VariantLosses,
    pool_by_borrower: np.ndarray,
) -> list[dict[str, Any] | None]:
    """Per-borrower pricing, or None for every borrower unless this is a 252-day annual run."""
    n_b = output.book.n_borrowers
    run = snapshot["run"]
    if run["mode"] != "annual" or run["horizon_days"] != 252:
        return [None] * n_b
    el = (gaussian.cond + pool_by_borrower).mean(axis=0)
    total_loss = gaussian.sampled.sum(axis=1) + pool_by_borrower.sum(axis=1)
    euler, _ = euler_expected_shortfall(
        gaussian.sampled + pool_by_borrower, np.zeros(output.n_paths), 0.999
    )
    capital = allocate_capital(
        var999=value_at_risk(total_loss, 0.999),
        program_el=float(el.sum()),
        euler=euler,
        el=el,
    )
    value, fee = np.zeros(n_b), np.zeros(n_b)
    index = {b: i for i, b in enumerate(output.book.borrower_ids)}
    for loan in snapshot["loans"]:
        v = loan["quantity"] * output.market.price0[output.market.index[loan["security_id"]]]
        b = index[loan["borrower_id"]]
        value[b] += v
        fee[b] += v * loan["rate_bps"]
    e_star = {r["borrower_id"]: r["e_star"] for r in comprehensive_approach(snapshot)}
    return [
        price_borrower(
            el=float(el[b]),
            capital=float(capital[b]),
            avg_loan_value=float(value[b]),
            fee_bps=float(fee[b] / value[b]),
            proxy_exposure=e_star[output.book.borrower_ids[b]],
            rating=output.credits[b].rating,
            pricing=snapshot["pricing"],
        )
        for b in range(n_b)
    ]


def _convergence(output: RunOutput) -> dict[str, Any]:
    chunks = len(output.chunk_bounds)
    if chunks < 2:
        return {"checked": False, "max_shift_in_standard_errors": None, "passed": None}
    half = output.chunk_bounds[chunks // 2 - 1][1]
    v = output.variants[GAUSSIAN_WW]
    exposure = output.exposure.sum(axis=1).astype(float)

    def metrics(end: int | None) -> dict[str, Metric]:
        s = slice(0, end)
        return channel_metrics(
            cond=v.cond[s].sum(axis=1),
            sampled=v.sampled[s].sum(axis=1),
            exposure=exposure[s],
            grid=output.grid,
        )

    full, partial = metrics(None), metrics(half)
    shifts = [
        abs(full[name].value - partial[name].value) / partial[name].std_error
        for name in ("el", "pfe99", "es99")
        if partial[name].std_error
    ]
    worst = float(max(shifts, default=0.0))
    return {"checked": True, "max_shift_in_standard_errors": worst, "passed": bool(worst < 2.0)}


MIN_LOSS_PATHS_FOR_AGREEMENT = 30


def _validation(
    output: RunOutput,
    program: dict[str, Any],
    contributions: list[Metric],
    pool_part: Metric,
    total: np.ndarray,
) -> list[dict[str, Any]]:
    v = output.variants[GAUSSIAN_WW]
    cond, sampled = v.cond.sum(axis=1), v.sampled.sum(axis=1)
    se = math.hypot(cond.std(ddof=1), sampled.std(ddof=1)) / math.sqrt(len(cond))
    gap = abs(cond.mean() - sampled.mean())
    agree = gap == 0.0 or (se > 0 and gap / se < 4.0)
    # The sampled estimator is mostly zeros when defaults are rare, so its standard error says
    # little. With too few loss paths the comparison is not made, and the card says so instead of
    # passing or failing.
    loss_paths = int((sampled > 0).sum())
    assessed = loss_paths >= MIN_LOSS_PATHS_FOR_AGREEMENT
    es = program["gaussian"]["with_wrong_way"]["total"]["es99"]["value"]
    euler = sum(c.value for c in contributions) + pool_part.value
    return [
        {
            "check": "snapshot schema, cross-field rules and hash",
            "passed": bool(output.extras.get("validated", False)),
            "note": "validated before the run"
            if output.extras.get("validated")
            else "validation was skipped by the caller",
        },
        {
            "check": "conditional and sampled expected loss agree",
            "passed": bool(agree) if assessed else None,
            "note": (
                f"difference {gap / se:.2f} standard errors"
                if assessed and se > 0
                else "no sampled losses"
                if assessed
                else f"not assessed: only {loss_paths} sampled paths have a default loss, "
                f"{MIN_LOSS_PATHS_FOR_AGREEMENT} are needed"
            ),
        },
        {
            "check": "borrower Euler contributions sum to program expected shortfall",
            "passed": bool(abs(euler - es) <= 1e-9 * max(1.0, abs(es))),
            "note": None,
        },
    ]


def build_result(
    snapshot: dict[str, Any],
    output: RunOutput,
    *,
    created_at: str | None = None,
    sensitivities: list[dict[str, Any]] | None = None,
    stresses: list[dict[str, Any]] | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    run = snapshot["run"]
    pool = output.pool_loss
    program_exposure = output.exposure.sum(axis=1).astype(float)
    n_b = output.book.n_borrowers

    def program_channels(v: VariantLosses) -> dict[str, Any]:
        return _channels(v.cond.sum(axis=1), v.sampled.sum(axis=1), pool, program_exposure, output)

    gaussian = output.variants[GAUSSIAN_WW]
    no_ww = output.variants[GAUSSIAN_NO_WW]
    student = output.variants.get(STUDENT_T_WW)
    program = {
        "gaussian": {
            "with_wrong_way": program_channels(gaussian),
            "without_wrong_way": program_channels(no_ww),
        },
        "student_t": None if student is None else program_channels(student),
    }

    # Each borrower carries a share of the pool's loss equal to its share of the cash collateral
    cash_share = np.asarray(output.extras.get("cash_share", np.zeros(n_b)))
    pool_by_borrower = pool[:, None] * cash_share[None, :]
    contributions, pool_part = euler_metrics(
        gaussian.sampled + pool_by_borrower, np.zeros(output.n_paths), 0.99
    )
    borrowers = []
    for b, borrower_id in enumerate(output.book.borrower_ids):
        credit = output.credits[b]
        exposure = output.exposure[:, b, :].astype(float)

        def by_borrower(
            v: VariantLosses, b: int = b, exposure: np.ndarray = exposure
        ) -> dict[str, Any]:
            return _channels(
                v.cond[:, b], v.sampled[:, b], pool_by_borrower[:, b], exposure, output
            )

        borrowers.append(
            {
                "borrower_id": borrower_id,
                "credit_source": credit.source,
                "pd_1y": credit.pd_1y,
                "hazard": credit.hazard,
                "metrics": {
                    "with_wrong_way": by_borrower(gaussian),
                    "without_wrong_way": by_borrower(no_ww),
                },
                "euler_es99": contributions[b].as_dict(),
                "exposure_profile": _profile(exposure, output),
                "pricing": None,
            }
        )

    shares = owner_shares(snapshot, output.book.borrower_ids, output.market)
    owner_ids = [o["id"] for o in snapshot["owners"]]
    pool_shares = {s["owner_id"]: s["share"] for s in snapshot["pool"]["owner_shares"]}
    owners = []
    for o, owner_id in enumerate(owner_ids):
        default = _mean_metric(gaussian.cond @ shares[:, o])
        reinvestment = _mean_metric(pool * pool_shares.get(owner_id, 0.0))
        total = _mean_metric(gaussian.cond @ shares[:, o] + pool * pool_shares.get(owner_id, 0.0))
        owners.append(
            {
                "owner_id": owner_id,
                "el": {
                    "total": total.as_dict(),
                    "default_shortfall": default.as_dict(),
                    "reinvestment": reinvestment.as_dict(),
                },
            }
        )

    priced = _pricing(snapshot, output, gaussian, pool_by_borrower)
    for borrower, pricing in zip(borrowers, priced, strict=True):
        borrower["pricing"] = pricing

    mc_pfe99 = {
        b["borrower_id"]: b["metrics"]["with_wrong_way"]["default_shortfall"]["pfe99"]["value"]
        for b in borrowers
    }
    cross_check = [
        {**row, "mc_pfe99": mc_pfe99[row["borrower_id"]]}
        for row in comprehensive_approach(snapshot)
    ]

    limitations = LIMITATIONS + ("" if output.extras.get("pool_modelled") else NO_POOL_NOTE)
    limitations += NO_PRICING_NOTE if priced[0] is None else ""
    limitations += PREVIEW_NOTE if run["preview"] else ""
    limitations += DESK_NOTE if run["mode"] == "desk" else ""
    card = {
        "model_card_schema_version": "1.0",
        "model_version": MODEL_VERSION,
        "snapshot_hash": snapshot["snapshot_hash"],
        "profile_name": snapshot["closeout_profile"]["name"],
        "profile_hash": profile_hash(snapshot["closeout_profile"]),
        "mode": run["mode"],
        "seed": run["seed"],
        "paths": run["paths"],
        "preview": run["preview"],
        "horizon_days": run["horizon_days"],
        "step": run["step"],
        "convergence": _convergence(output),
        "validation": _validation(
            output, program, contributions, pool_part, gaussian.sampled.sum(axis=1) + pool
        ),
        "data_label": snapshot["source"]["label"],
        "limitations": limitations,
    }
    if run_id is None:
        digest = hashlib.sha256(f"{snapshot['snapshot_hash']}|{MODEL_VERSION}".encode())
        run_id = digest.hexdigest()[:32]
    assert n_b == len(borrowers)
    return {
        "api_schema_version": "1.0",
        "run_id": run_id,
        "snapshot_hash": snapshot["snapshot_hash"],
        "created_at": created_at or datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": snapshot["source"]["label"],
        "run": {k: run[k] for k in ("mode", "seed", "paths", "preview", "horizon_days", "step")},
        "model_card": card,
        "effective_settings": [row.as_dict() for row in resolve_all(snapshot)],
        "program": program,
        "exposure_profile": _profile(program_exposure, output),
        "borrowers": borrowers,
        "owners": owners,
        "cross_check": {"label": CROSS_CHECK_LABEL, "borrowers": cross_check},
        "sensitivities": sensitivities or [],
        "stresses": stresses or [],
    }
