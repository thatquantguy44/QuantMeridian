"""MMKT allocation LP or ticketed execution MIP, assembled from the strict contract."""

from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from dataclasses import replace
from datetime import UTC, date, datetime, time
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
    """An input cannot be represented faithfully by the selected model."""


class ModelSolveError(RuntimeError):
    """The shared backend did not return a verified optimum."""

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


def _planned_at(day: date, decision_at: datetime) -> datetime:
    """Indicative 09:00 local planning time, or a later explicit decision time."""
    return max(datetime.combine(day, time(9), tzinfo=decision_at.tzinfo), decision_at)


def _input_hash(payload: OptimizeRequest) -> str:
    canonical = json.dumps(payload.model_dump(mode="json"), sort_keys=True,
                           separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def solve_currency(payload: OptimizeRequest, currency: str) -> dict[str, Any]:
    """Solve and independently verify one currency portfolio."""
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
    ticketed = payload.policy.execution_mode == "ticketed_plan"
    decision_at = payload.policy.decision_at
    builder = SparseProblemBuilder(objective_sense="maximize")
    row_labels: dict[str, str] = {}
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
        account_points = accounts[account_key]
        gross_resources = max(0.0, account_points[periods[0]].opening_cash) + sum(
            max(0.0, point.known_net_flow + point.estimated_residual_p50)
            for point in account_points.values()
        )
        for candidate in candidates:
            if candidate.currency != account_currency:
                continue
            rate = rate_by_id[candidate.rate_instrument_id]
            for day in periods:
                if day < candidate.settlement_date or day >= candidate.maturity_date:
                    continue
                if ticketed and candidate.cutoff_at is not None:
                    assert decision_at is not None
                    if _planned_at(day, decision_at) > candidate.cutoff_at:
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
                account_bound = gross_resources * (1.0 + max(net_return, 0.0)) ** len(periods)
                max_amount = min(account_bound, candidate.maximum_amount) if candidate.maximum_amount is not None else account_bound
                if ticketed:
                    max_units = math.floor(max_amount / candidate.lot_size_amount + 1e-9)
                    max_amount = max_units * candidate.lot_size_amount
                    if max_units == 0:
                        continue
                variable = builder.add_variable(
                    _name("buy", *account_key, candidate.candidate_id, day),
                    objective=net_return,
                    lower=0.0,
                    # A null maximum_amount means uncapped in the v1.0.0 contract.
                    upper=(max_amount if ticketed else (math.inf if candidate.maximum_amount is None else candidate.maximum_amount)) if rating_allowed else 0.0,
                )
                if ticketed:
                    units = builder.add_variable(
                        _name("lots", *account_key, candidate.candidate_id, day),
                        upper=max_units if rating_allowed else 0,
                        integer=True,
                    )
                    active = builder.add_variable(
                        _name("ticket", *account_key, candidate.candidate_id, day),
                        upper=1 if rating_allowed else 0,
                        integer=True,
                    )
                    prefix = ("ticket", *account_key, candidate.candidate_id, day)
                    builder.add_row(_name("lot_identity", *prefix),
                                    {variable: 1.0, units: -candidate.lot_size_amount}, lower=0, upper=0)
                    builder.add_row(_name("ticket_upper", *prefix),
                                    {variable: 1.0, active: -max_amount}, upper=0)
                    builder.add_row(_name("ticket_min", *prefix),
                                    {variable: 1.0, active: -candidate.minimum_ticket_amount}, lower=0)
                    builder.add_row(_name("ticket_active", *prefix), {units: 1.0, active: -1.0}, lower=0)
                positions.append({
                    "variable": variable,
                    "account_key": account_key,
                    "candidate": candidate,
                    "purchase_date": day,
                    "settlement_date": candidate.settlement_date,
                    "maturity_date": candidate.maturity_date,
                    "return_factor": return_factor,
                    "net_return": net_return,
                    "ticket_variable": active if ticketed else None,
                })

    if len(cash_variables) + len(positions) * (3 if ticketed else 1) > MAX_LP_VARIABLES:
        raise ModelInputError(f"Model exceeds the {MAX_LP_VARIABLES:,} variable limit.")

    if ticketed and payload.policy.maximum_ticket_count is not None:
        builder.add_row(_name("ticket_count", currency),
                        {p["ticket_variable"]: 1.0 for p in positions},
                        upper=payload.policy.maximum_ticket_count)

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
        row_name = _name("liquidity_floor", floor.legal_entity_id, currency, floor.period_date)
        row_labels[row_name] = f"Cash floor · {floor.legal_entity_id} · {floor.period_date}"
        builder.add_row(
            row_name,
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
                row_name = _name("candidate_max", candidate.candidate_id, day)
                row_labels[row_name] = f"Candidate cap · {candidate.candidate_id} · {day}"
                builder.add_row(
                    row_name,
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
            row_name = _name("wam_proxy", currency, day)
            row_labels[row_name] = f"WAM proxy · {currency} · {day}"
            builder.add_row(row_name, coefficients, upper=0.0)
        if payload.policy.maximum_wal_days is not None and total_active:
            coefficients = {
                p["variable"]: float((p["maturity_date"] - day).days)
                - payload.policy.maximum_wal_days
                for p in active_positions
            }
            row_name = _name("wal_proxy", currency, day)
            row_labels[row_name] = f"WAL proxy · {currency} · {day}"
            builder.add_row(row_name, coefficients, upper=0.0)

        for limit in payload.policy.exposure_limits:
            if limit.currency != currency:
                continue
            matching = [p for p in active_positions if _matches(limit, p["candidate"])]
            matching_variables = {p["variable"] for p in matching}
            if limit.maximum_amount is not None:
                row_name = _name("exposure_max", limit.dimension, limit.key, day)
                row_labels[row_name] = f"{limit.dimension} cap · {limit.key} · {day}"
                builder.add_row(
                    row_name,
                    {p["variable"]: 1.0 for p in matching},
                    upper=limit.maximum_amount,
                )
            if limit.maximum_portfolio_fraction is not None:
                fraction = limit.maximum_portfolio_fraction
                coefficients = {
                    p["variable"]: (1.0 if p["variable"] in matching_variables else 0.0) - fraction
                    for p in active_positions
                }
                row_name = _name("exposure_fraction", limit.dimension, limit.key, day)
                row_labels[row_name] = f"{limit.dimension} share · {limit.key} · {day}"
                builder.add_row(
                    row_name,
                    coefficients,
                    upper=0.0,
                )

    problem = builder.build()
    solved = HighsBackend().solve(problem)
    fixed_problem = None
    fixed_solution = None
    if ticketed and solved.status == "optimal" and solved.primal is not None:
        # HiGHS accepts integer values within its feasibility tolerance. Polish the
        # chosen integer plan by fixing those values and resolving the continuous
        # variables, then verify the polished primal against the original MIP.
        lower = problem.variable_lower.copy()
        upper = problem.variable_upper.copy()
        for index, flag in enumerate(problem.variable_integrality):
            if flag:
                lower[index] = upper[index] = round(float(solved.primal[index]))
        fixed_problem = replace(problem, variable_lower=lower, variable_upper=upper,
                                variable_integrality=tuple(0 for _ in problem.variable_integrality))
        fixed_solution = HighsBackend().solve(fixed_problem)
        if (fixed_solution.status != "optimal" or fixed_solution.primal is None
                or not verify_solution(fixed_problem, fixed_solution).passed
                or not math.isclose(float(solved.objective_value), float(fixed_solution.objective_value),
                                    rel_tol=1e-6, abs_tol=1e-6)):
            raise ModelSolveError("verification_failed", "integer plan polishing failed")
        solved = replace(solved, primal=fixed_solution.primal,
                         objective_value=fixed_solution.objective_value)
    verification = verify_solution(problem, solved, tolerance=TOLERANCE)
    if solved.status != "optimal":
        raise ModelSolveError(solved.status, f"Model status {solved.status}: {solved.message}")
    if not verification.passed:
        raise ModelSolveError("verification_failed", "shared verifier rejected the MMKT solution")

    price_solution = fixed_solution if ticketed else solved
    price_convention = "LP_LOCAL"
    if ticketed:
        # A MIP has no duals; the verified polishing LP supplies fixed-plan marginals.
        assert fixed_problem is not None and price_solution is not None
        price_convention = "FIXED_INTEGER_LP"

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
    blotter = []
    if ticketed:
        assert decision_at is not None
        by_id = {item.candidate_id: item for item in candidates}
        ordered = sorted(allocations, key=lambda row: (
            row["purchase_date"],
            by_id[row["candidate_id"]].cutoff_at or datetime.max.replace(tzinfo=UTC),
            row["candidate_id"], row["account_id"],
        ))
        for sequence, line in enumerate(ordered, 1):
            candidate = by_id[line["candidate_id"]]
            blotter.append({
                "sequence": sequence, "candidate_id": line["candidate_id"],
                "legal_entity_id": line["legal_entity_id"], "account_id": line["account_id"],
                "currency": currency, "purchase_date": line["purchase_date"],
                "planned_at": _planned_at(date.fromisoformat(line["purchase_date"]), decision_at),
                "cutoff_at": candidate.cutoff_at, "amount": line["amount"],
                "lot_size_amount": candidate.lot_size_amount,
                "minimum_ticket_amount": candidate.minimum_ticket_amount,
            })
    cutoff_timeline = []
    if ticketed:
        assert decision_at is not None
        selected = {line["candidate_id"] for line in blotter}
        for candidate in sorted(candidates, key=lambda item: (item.cutoff_at or datetime.max.replace(tzinfo=UTC), item.candidate_id)):
            if candidate.cutoff_at is None:
                continue
            possible = any(day >= candidate.settlement_date and day < candidate.maturity_date
                           and _planned_at(day, decision_at) <= candidate.cutoff_at for day in periods)
            planned = next((line["planned_at"] for line in blotter if line["candidate_id"] == candidate.candidate_id), None)
            cutoff_timeline.append({"candidate_id": candidate.candidate_id,
                                    "cutoff_at": candidate.cutoff_at,
                                    "status": "planned" if candidate.candidate_id in selected else "available" if possible else "missed",
                                    "planned_at": planned})
    shadow_prices = []
    row_activity = problem.matrix @ price_solution.primal
    for index, (row_name, marginal) in enumerate(zip(problem.row_names, price_solution.row_marginals, strict=True)):
        is_binding = (math.isfinite(problem.row_lower[index]) and abs(row_activity[index] - problem.row_lower[index]) <= 1e-6
                      or math.isfinite(problem.row_upper[index]) and abs(row_activity[index] - problem.row_upper[index]) <= 1e-6)
        if row_name in row_labels and marginal is not None and (is_binding or abs(marginal[1]) > 1e-9):
            shadow_prices.append({"row_name": row_name, "label": row_labels[row_name],
                                  "bound": marginal[0],
                                  "objective_delta_usd_per_extra_mm": marginal[1] * 1_000_000,
                                  "convention": price_convention})
    shadow_prices.sort(key=lambda row: (-abs(row["objective_delta_usd_per_extra_mm"]), row["label"]))
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
            "max_integrality_violation": verification.max_integrality_violation,
        },
        "blotter": blotter,
        "cutoff_timeline": cutoff_timeline,
        "shadow_prices": shadow_prices,
        "frontier": [],
    }


def solve_request(payload: OptimizeRequest) -> dict[str, Any]:
    all_currencies = sorted({point.currency for point in payload.cash_forecast})
    currencies = all_currencies
    if payload.policy.objective_currency is not None:
        if payload.policy.objective_currency not in currencies:
            raise ModelInputError("objective_currency has no cash forecast in the request")
        currencies = [payload.policy.objective_currency]
    results = [solve_currency(payload, currency) for currency in currencies]
    for result in results:
        currency = result["currency"]
        for multiplier in sorted(payload.policy.frontier_multipliers):
            policy = payload.policy.model_copy(update={
                "daily_liquidity_floors": [floor.model_copy(update={"minimum_cash": floor.minimum_cash * multiplier})
                                            for floor in payload.policy.daily_liquidity_floors],
                "weekly_liquidity_floors": [floor.model_copy(update={"minimum_cash": floor.minimum_cash * multiplier})
                                             for floor in payload.policy.weekly_liquidity_floors],
                "frontier_multipliers": [],
            })
            variant = payload.model_copy(update={"policy": policy})
            try:
                point = result if multiplier == 1 else solve_currency(variant, currency)
                cash = point["cash_balances"]
                headrooms = [
                    sum(line["cash"] for line in cash if line["legal_entity_id"] == floor.legal_entity_id
                        and line["period_date"] == floor.period_date.isoformat()) - floor.minimum_cash
                    for floor in policy.daily_liquidity_floors + policy.weekly_liquidity_floors
                    if floor.currency == currency
                ]
                result["frontier"].append({"floor_multiplier": multiplier,
                                           "input_hash": _input_hash(variant),
                                           "status": "optimal_verified",
                                           "objective_value": point["objective_value"],
                                           "minimum_cash_headroom": min(headrooms) if headrooms else None})
            except ModelSolveError as exc:
                if exc.status != "infeasible":
                    raise
                result["frontier"].append({"floor_multiplier": multiplier,
                                           "input_hash": _input_hash(variant),
                                           "status": "infeasible", "objective_value": None,
                                           "minimum_cash_headroom": None})
    ticketed = payload.policy.execution_mode == "ticketed_plan"
    return {
        "excluded_currencies": [currency for currency in all_currencies if currency not in currencies],
        "currency_results": results,
        "model_family": "ticketed_mip" if ticketed else "continuous_lp_relaxation",
        "execution_ready": ticketed,
        "assumptions": [
            "Estimated residual cash uses the p50 forecast.",
            "Normalized mm_yield_pct is annualized and held constant through the modeled horizon; simple ACT/365 holding-period return is used.",
            "Explicit cost is charged once at each allocation purchase.",
            "Cash earns zero yield and is carried forward through the cash-continuity equations.",
            "WAM and WAL limits use days-to-maturity proxies because candidate reset/amortization data is not in v1.0.0.",
            "Rating floors use a simplified common long-term notch map; candidates with unrecognized notches are excluded when a floor applies.",
            ("Ticket minimums, integer lots, maximum ticket count and dated cutoffs are enforced by the verified MIP; planned times are indicative and do not route orders."
             if ticketed else "Ticket and cutoff constraints are not enforced in the continuous LP preview."),
            ("Shadow prices are local LP marginal objective changes per additional $1mm of a row RHS; MIP values come from an LP with all integer decisions fixed, not from the MIP itself."
             if ticketed else "Shadow prices are local continuous-LP marginal objective changes per additional $1mm of a row RHS."),
            "Currencies are optimized independently; currency_results are not summed across currencies.",
            "Any currency outside an explicitly selected objective_currency is listed in excluded_currencies.",
            "Only normalized rates with status=ok are accepted.",
        ],
    }
