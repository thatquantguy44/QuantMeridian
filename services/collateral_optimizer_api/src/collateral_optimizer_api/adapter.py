"""Second source-domain assessment at the service trust boundary."""

from __future__ import annotations

from math import isclose, isfinite

from collateral_optimizer.domain import OptimizationResult, Snapshot
from collateral_optimizer.verify import Assessment, assess

ABS_TOL = 0.01  # USD; upstream rounds monetary result fields to six decimals.
REL_TOL = 1e-6


def _close(actual: float, expected: float, label: str, errors: list[str]) -> None:
    if not isfinite(actual) or not isclose(actual, expected, abs_tol=ABS_TOL, rel_tol=REL_TOL):
        errors.append(f"{label} does not reconcile")


def check_result(snapshot: Snapshot, result: OptimizationResult) -> tuple[Assessment | None, tuple[str, ...]]:
    """Reconstruct every recommendation field from native inputs, not solver rows."""
    errors: list[str] = []
    if result.result_version != "1.0" or snapshot.schema_version != "1.0":
        errors.append("schema version mismatch")
    if result.input_hash != snapshot.canonical_hash() or result.book_id != snapshot.book_id:
        errors.append("snapshot identity mismatch")
    if (result.source, result.parent_hash, result.scenario_id) != (
        snapshot.source, snapshot.parent_hash, snapshot.scenario_id
    ):
        errors.append("snapshot lineage mismatch")
    if result.status != "optimal" or not result.verified:
        if result.allocations or result.movements or result.coverage or result.cost is not None:
            errors.append("non-optimal result exposes a candidate")
        if result.verified:
            errors.append("non-optimal result claims verification")
        if result.formulation == "MIP" and result.diagnostics.lp_duals_usd_per_unit:
            errors.append("MIP cannot report LP duals")
        return None, tuple(errors)
    if result.cost is None or result.residual_liquidity_usd is None:
        return None, ("optimal result has no cost or residual liquidity",)
    if result.formulation == "MIP" and result.diagnostics.lp_duals_usd_per_unit:
        errors.append("MIP cannot report LP duals")

    assets = {a.asset_id: a for a in snapshot.assets}
    calls = {c.call_id: c for c in snapshot.calls}
    agreements = {a.agreement_id: a for a in snapshot.agreements}
    fx = {q.currency: q.usd_per_unit for q in snapshot.fx}
    current = {(p.asset_id, p.call_id): p.market_value for p in snapshot.current_pledges}
    target: dict[tuple[str, str], float] = {}
    for row in result.allocations:
        key = (row.asset_id, row.call_id)
        if key in target or row.asset_id not in assets or row.call_id not in calls or row.market_value <= 0:
            errors.append(f"invalid allocation route:{row.asset_id}:{row.call_id}")
            continue
        target[key] = row.market_value
        asset, call = assets[row.asset_id], calls[row.call_id]
        rule = next((r for r in agreements[call.agreement_id].classes
                     if r.asset_class == asset.asset_class), None)
        if rule is None:
            errors.append(f"unmapped allocation rule:{row.asset_id}:{row.call_id}")
            continue
        if (row.asset_class, row.currency, row.issuer) != (
            asset.asset_class, asset.currency, asset.issuer
        ):
            errors.append(f"allocation source fields differ:{row.asset_id}:{row.call_id}")
        _close(row.haircut, rule.haircut, "haircut", errors)
        _close(row.covered_usd, row.market_value * fx[asset.currency] * (1-rule.haircut), "coverage row", errors)
        _close(row.carry_usd, row.market_value * fx[asset.currency] * asset.annual_carry_bps
               / 10000 * snapshot.horizon_days / 365, "carry row", errors)
        _close(row.variable_move_usd, abs(row.market_value-current.get(key, 0))
               * fx[asset.currency] * asset.variable_move_bps / 10000, "move row", errors)
        _close(row.activation_fee_usd,
               asset.fixed_activation_fee_usd if current.get(key, 0) == 0 else 0,
               "activation fee row", errors)

    checked = assess(snapshot, target)
    errors.extend(checked.errors)
    _close(result.residual_liquidity_usd, checked.residual_liquidity_usd, "residual liquidity", errors)
    covered = {c.call_id: c for c in result.coverage}
    if len(covered) != len(result.coverage) or set(covered) != set(calls):
        errors.append("coverage rows do not match calls")
    else:
        for call_id, row in covered.items():
            _close(row.required_usd, calls[call_id].required_value * fx[calls[call_id].currency],
                   f"required:{call_id}", errors)
            _close(row.covered_usd, checked.covered_usd[call_id], f"covered:{call_id}", errors)

    expected_movements = {(asset_id, call_id): (current.get((asset_id, call_id), 0), value)
                          for asset_id, call_id in set(target) | set(current)
                          for value in [target.get((asset_id, call_id), 0)]
                          if abs(value-current.get((asset_id, call_id), 0)) > 1e-5}
    movements = {(m.asset_id, m.call_id): m for m in result.movements}
    if len(movements) != len(result.movements) or set(movements) != set(expected_movements):
        errors.append("movement rows do not match target")
    else:
        for key, (before, after) in expected_movements.items():
            row = movements[key]
            asset = assets[key[0]]
            for label, actual, expected in (
                ("previous", row.previous_value, before), ("target", row.target_value, after),
                ("delta", row.delta_value, after-before),
                ("movement fee", row.variable_move_usd,
                 abs(after-before)*fx[asset.currency]*asset.variable_move_bps/10000),
            ):
                _close(actual, expected, f"{label}:{key}", errors)

    incumbent = assess(snapshot, current)
    expected_current = None if incumbent.errors else incumbent.total_cost_usd
    cost = result.cost
    for label, actual, expected in (
        ("carry", cost.carry_usd, checked.carry_usd),
        ("variable move", cost.variable_move_usd, checked.variable_move_usd),
        ("fixed activation", cost.fixed_activation_usd, checked.fixed_activation_usd),
        ("total objective", cost.total_usd, checked.total_cost_usd),
    ):
        _close(actual, expected, label, errors)
    if expected_current is None:
        if cost.current_cost_usd is not None or cost.savings_usd is not None:
            errors.append("invalid incumbent must suppress savings")
    elif cost.current_cost_usd is None or cost.savings_usd is None:
        errors.append("valid incumbent cost or savings missing")
    else:
        _close(cost.current_cost_usd, expected_current, "incumbent cost", errors)
        _close(cost.savings_usd, expected_current-checked.total_cost_usd, "savings", errors)
    if tuple(result.diagnostics.binding_constraints) != checked.binding_constraints:
        errors.append("binding constraints differ")
    if tuple(result.diagnostics.incumbent_violations) != incumbent.errors:
        errors.append("incumbent violations differ")
    return checked, tuple(errors)
