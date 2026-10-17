"""Continuous MMKT allocation LP, assembled from the strict API contract."""

from __future__ import annotations

import hashlib
import math
from collections import defaultdict
from datetime import date
from typing import Any

from optimization_core import HighsBackend, SparseProblemBuilder, verify_solution

from .contracts import OptimizeRequest

TOLERANCE = 1e-7
MAX_LP_VARIABLES = 50_000

# Common long-term rating notches, normalized to a larger-is-better integer scale.
_RATING_SCORE = {
    "D": 0, "C": 1, "CC": 2, "CCC-": 3, "CCC": 4, "CCC+": 5,
    "B-": 6, "B": 7, "B+": 8, "BB-": 9, "BB": 10, "BB+": 11,
    "BBB-": 12, "BBB": 13, "BBB+": 14, "A-": 15, "A": 16, "A+": 17,
    "AA-": 18, "AA": 19, "AA+": 20, "AAA": 21,
    "Caa3": 3, "Caa2": 4, "Caa1": 5, "B3": 6, "B2": 7, "B1": 8,
    "Ba3": 9, "Ba2": 10, "Ba1": 11, "Baa3": 12, "Baa2": 13,
    "Baa1": 14, "A3": 15, "A2": 16, "A1": 17, "Aa3": 18,
    "Aa2": 19, "Aa1": 20, "Aaa": 21,
}


class ModelInputError(ValueError):
    """An input cannot be represented faithfully by the current continuous LP."""


class ModelSolveError(RuntimeError):
    """The shared LP backend did not return a verified optimum."""

    def __init__(self, status: str, message: str) -> None:
        super().__init__(message)
        self.status = status


def _name(prefix: str, *parts: object) -> str:
    raw = "|".join(str(part) for part in parts)
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
    return f"{prefix}_{digest}"


def _score(rating: str | None) -> int | None:
    if rating is None:
        return None
    return _RATING_SCORE.get(rating.strip())


def _active(position: dict[str, Any], as_of: date) -> bool:
    return position["settlement_date"] <= as_of < position["maturity_date"]


def _matches(limit: Any, candidate: Any) -> bool:
    if limit.dimension == "issuer":
        return candidate.issuer_id == limit.key
    if limit.dimension == "counterparty":
        return candidate.counterparty_id == limit.key
    if limit.dimension == "fund":
        return limit.key in (candidate.candidate_id, candidate.rate_instrument_id)
    if limit.dimension == "rating":
        return candidate.rating == limit.key
    return candidate.instrument_type == "fed_rrp" and limit.key.lower() in ("fed_rrp", "rrp", candidate.candidate_id.lower())


def _period_receipt_date(maturity: date, period_dates: list[date]) -> date | None:
    return next((day for day in period_dates if day >= maturity), None)


def solve_currency(payload: OptimizeRequest, currency: str) -> dict[str, Any]:
    """Solve and independently verify one currency portfolio as a continuous LP relaxation."""
    periods = payload.horizon.period_dates
    horizon_end = payload.horizon.end_date
    candidates = [item for item in payload.instrument_candidates if item.currency == currency]
    forecast = [point for point in payload.cash_forecast if point.currency == currency]
    accounts: dict[tuple[str, str, str], dict[date, Any]] = defaultdict(dict)
    for point in forecast:
        key = (point.legal_entity_id, point.account_id, point.currency)
        if point.period_date in accounts[key]:
            raise ModelInputError("cash forecast has duplicate account/date points")
        accounts[key][point.period_date] = point

    if not accounts:
        raise ModelInputError(f"currency {currency} has no cash forecast.")
    expected_periods = set(periods)
    for key, points in accounts.items():
        if set(points) != expected_periods:
            raise ModelInputError(
                f"cash forecast for account {key[1]} must include every declared horizon period"
            )
        ordered = [points[day] for day in periods]
        for previous, current in zip(ordered, ordered[1:], strict=False):
            projected_opening = (
                previous.opening_cash
                + previous.known_net_flow
                + previous.estimated_residual_p50
            )
            if not math.isclose(current.opening_cash, projected_opening, rel_tol=1e-8, abs_tol=0.01):
                raise ModelInputError(
                    f"opening_cash for account {key[1]} does not continue its prior p50 cash forecast"
                )

    rate_by_id = {row.instrument_id: row for row in payload.rate_snapshot.rows}
    builder = SparseProblemBuilder(objective_sense="maximize")
    cash_variables: dict[tuple[tuple[str, str, str], date], int] = {}
    for account_key, points in sorted(accounts.items()):
        for day in periods:
            cash_variables[(account_key, day)] = builder.add_variable(
                _name("cash", *account_key, day),
                objective=0.0,
                lower=0.0,
            )

    positions: list[dict[str, Any]] = []
    for account_key in sorted(accounts):
        account_currency = account_key[2]
        for candidate in candidates:
            if candidate.currency != account_currency:
                continue
            rate = rate_by_id[candidate.rate_instrument_id]
            for day in periods:
                if day < candidate.settlement_date or day >= candidate.maturity_date:
                    continue
                accrual_end = min(candidate.maturity_date, horizon_end)
                holding_days = (accrual_end - day).days
                net_return = (
                    rate.mm_yield_pct / 100.0 * holding_days / 365.0
                    - candidate.explicit_cost_bps / 10_000.0
                )
                return_factor = 1.0 + net_return
                if return_factor <= 0:
                    raise ModelInputError(
                        f"candidate {candidate.candidate_id} has nonpositive modeled proceeds"
                    )
                # Any explicit minimum rating is a hard candidate eligibility filter.
                rating_allowed = True
                for limit in payload.policy.exposure_limits:
                    if limit.minimum_rating is None or limit.currency != currency:
                        continue
                    applies = (
                        limit.dimension == "rating"
                        and limit.key.lower() in ("portfolio", "all", "*")
                    ) or (
                        limit.dimension != "rating"
                        and _matches(limit, candidate)
                    )
                    if not applies:
                        continue
                    floor_score = _score(limit.minimum_rating)
                    item_score = _score(candidate.rating)
                    if floor_score is None:
                        raise ModelInputError(
                            f"unsupported minimum rating notation: {limit.minimum_rating}"
                        )
                    if item_score is None or item_score < floor_score:
                        rating_allowed = False
                variable = builder.add_variable(
                    _name("buy", *account_key, candidate.candidate_id, day),
                    objective=net_return,
                    lower=0.0,
                    upper=candidate.maximum_amount if rating_allowed else 0.0,
                )
                positions.append({
                    "variable": variable,
                    "account_key": account_key,
                    "candidate": candidate,
                    "purchase_date": day,
                    "settlement_date": candidate.settlement_date,
                    "maturity_date": candidate.maturity_date,
                    "return_factor": return_factor,
                    "net_return": net_return,
                })

    if len(cash_variables) + len(positions) > MAX_LP_VARIABLES:
        raise ModelInputError(f"LP exceeds the {MAX_LP_VARIABLES:,} variable limit.")

    # Account cash balances are exact continuity equations. The opening is seeded once;
    # p50 residual flows are explicit rather than inferred from an external source.
    by_account_positions: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for position in positions:
        by_account_positions[position["account_key"]].append(position)

    for account_key, points in sorted(accounts.items()):
        for period_index, day in enumerate(periods):
            coefficients: dict[int, float] = {cash_variables[(account_key, day)]: 1.0}
            point = points[day]
            rhs = point.known_net_flow + point.estimated_residual_p50
            if period_index == 0:
                rhs += point.opening_cash
            else:
                prior_day = periods[period_index - 1]
                coefficients[cash_variables[(account_key, prior_day)]] = -1.0
            for position in by_account_positions[account_key]:
                candidate = position["candidate"]
                purchase_day = position["purchase_date"]
                variable = position["variable"]
                if purchase_day == day:
                    coefficients[variable] = coefficients.get(variable, 0.0) + 1.0
                receipt_day = _period_receipt_date(candidate.maturity_date, periods)
                if receipt_day == day and purchase_day < day:
                    coefficients[variable] = coefficients.get(variable, 0.0) - position["return_factor"]
            builder.add_row(
                _name("cash_continuity", *account_key, day),
                coefficients,
                lower=rhs,
                upper=rhs,
            )

    # Entity/currency liquidity floors aggregate all accounts for the entity.
    for floor in payload.policy.daily_liquidity_floors + payload.policy.weekly_liquidity_floors:
        if floor.currency != currency:
            continue
        coefficients = {
            cash_variables[(key, floor.period_date)]: 1.0
            for key in accounts
            if key[0] == floor.legal_entity_id
        }
        builder.add_row(
            _name("liquidity_floor", floor.legal_entity_id, currency, floor.period_date),
            coefficients,
            lower=floor.minimum_cash,
        )

    for period_index, day in enumerate(periods):
        active_positions = [p for p in positions if _active(p, day)]
        # Candidate-level principal cap applies to outstanding holdings at each date.
        for candidate in candidates:
            if candidate.maximum_amount is None:
                continue
            matching = {
                p["variable"]: 1.0
                for p in active_positions
                if p["candidate"].candidate_id == candidate.candidate_id
            }
            if matching:
                builder.add_row(
                    _name("candidate_max", candidate.candidate_id, day),
                    matching,
                    upper=candidate.maximum_amount,
                )

        # WAM/WAL use maturity dates as an explicitly disclosed proxy in this contract.
        total_active = {p["variable"]: 1.0 for p in active_positions}
        if payload.policy.maximum_wam_days is not None and total_active:
            coefficients = {
                p["variable"]: float((p["maturity_date"] - day).days)
                - payload.policy.maximum_wam_days
                for p in active_positions
            }
            builder.add_row(_name("wam_proxy", currency, day), coefficients, upper=0.0)
        if payload.policy.maximum_wal_days is not None and total_active:
            coefficients = {
                p["variable"]: float((p["maturity_date"] - day).days)
                - payload.policy.maximum_wal_days
                for p in active_positions
            }
            builder.add_row(_name("wal_proxy", currency, day), coefficients, upper=0.0)

        for limit in payload.policy.exposure_limits:
            if limit.currency != currency:
                continue
            matching = [p for p in active_positions if _matches(limit, p["candidate"])]
            matching_variables = {p["variable"] for p in matching}
            if limit.maximum_amount is not None:
                builder.add_row(
                    _name("exposure_max", limit.dimension, limit.key, day),
                    {p["variable"]: 1.0 for p in matching},
                    upper=limit.maximum_amount,
                )
            if limit.maximum_portfolio_fraction is not None:
                fraction = limit.maximum_portfolio_fraction
                coefficients = {
                    p["variable"]: (1.0 if p["variable"] in matching_variables else 0.0) - fraction
                    for p in active_positions
                }
                builder.add_row(
                    _name("exposure_fraction", limit.dimension, limit.key, day),
                    coefficients,
                    upper=0.0,
                )

    problem = builder.build()
    solved = HighsBackend().solve(problem)
    verification = verify_solution(problem, solved, tolerance=TOLERANCE)
    if solved.status != "optimal":
        raise ModelSolveError(solved.status, f"LP status {solved.status}: {solved.message}")
    if not verification.passed:
        raise ModelSolveError("verification_failed", "shared verifier rejected the MMKT LP solution")

    primal = solved.primal
    assert primal is not None
    allocations = []
    for position in positions:
        amount = float(primal[position["variable"]])
        if amount <= TOLERANCE:
            continue
        candidate = position["candidate"]
        allocations.append({
            "candidate_id": candidate.candidate_id,
            "rate_instrument_id": candidate.rate_instrument_id,
            "legal_entity_id": position["account_key"][0],
            "account_id": position["account_key"][1],
            "currency": currency,
            "purchase_date": position["purchase_date"].isoformat(),
            "settlement_date": candidate.settlement_date.isoformat(),
            "maturity_date": candidate.maturity_date.isoformat(),
            "amount": amount,
            "mm_yield_pct": rate_by_id[candidate.rate_instrument_id].mm_yield_pct,
            "explicit_cost_bps": candidate.explicit_cost_bps,
            "modeled_net_return_pct": position["net_return"] * 100.0,
        })
    allocations.sort(key=lambda row: (row["purchase_date"], row["candidate_id"], row["account_id"]))
    cash_balances = [
        {
            "legal_entity_id": key[0],
            "account_id": key[1],
            "currency": currency,
            "period_date": day.isoformat(),
            "cash": float(primal[variable]),
        }
        for (key, day), variable in sorted(cash_variables.items(), key=lambda item: (item[0][0], item[0][1]))
    ]
    return {
        "currency": currency,
        "objective_value": float(solved.objective_value or 0.0),
        "backend": solved.backend,
        "backend_version": solved.backend_version,
        "iterations": solved.iterations,
        "allocations": allocations,
        "cash_balances": cash_balances,
        "verification": {
            "passed": verification.passed,
            "max_variable_bound_violation": verification.max_variable_bound_violation,
            "max_row_violation": verification.max_row_violation,
            "objective_delta": verification.objective_delta,
        },
    }


def solve_request(payload: OptimizeRequest) -> dict[str, Any]:
    all_currencies = sorted({point.currency for point in payload.cash_forecast})
    currencies = all_currencies
    if payload.policy.objective_currency is not None:
        if payload.policy.objective_currency not in currencies:
            raise ModelInputError("objective_currency has no cash forecast in the request")
        currencies = [payload.policy.objective_currency]
    results = [solve_currency(payload, currency) for currency in currencies]
    return {
        "excluded_currencies": [currency for currency in all_currencies if currency not in currencies],
        "currency_results": results,
        "model_family": "continuous_lp_relaxation",
        "execution_ready": False,
        "assumptions": [
            "Estimated residual cash uses the p50 forecast.",
            "Normalized mm_yield_pct is annualized and held constant through the modeled horizon; simple ACT/365 holding-period return is used.",
            "Explicit cost is charged once at each allocation purchase.",
            "Cash earns zero yield and is carried forward through the cash-continuity equations.",
            "WAM and WAL limits use days-to-maturity proxies because candidate reset/amortization data is not in v1.0.0.",
            "Rating floors use a simplified common long-term notch map; candidates with unrecognized notches are excluded when a floor applies.",
            "Minimum ticket, lot-size, ticket-count, and cutoff constraints are not enforced by the continuous LP; allocations require a later MIP/execution validation slice.",
            "Currencies are optimized independently; currency_results are not summed across currencies.",
            "Any currency outside an explicitly selected objective_currency is listed in excluded_currencies.",
            "Only normalized rates with status=ok are accepted.",
        ],
    }
