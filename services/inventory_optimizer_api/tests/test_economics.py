"""Economics reconciliation (AC-014).

Proves the numbers in a solved result's `economics` block are not a decoupled, independently
computed summary that could silently drift from the actual allocations -- every total is
reconstructed here from the raw per-allocation/per-route/per-inventory data and checked against
what the engine reported, for a real solved result (never a canned fixture).

Formulas verified empirically against the pinned engine before writing these assertions (see
`docs/handoff.md` / `tests/VALIDATION.md` for how):

- `fee_revenue.unscaled_value_usd` == sum over allocations of
  `post_quantity_shares * inventory.price_usd * route.fee_rate * route.revenue_share
   * planning_horizon_days / day_count_basis_days` (360 for act_360, 365 for act_365).
- `fee_revenue.baseline_value_usd` is the same formula using `current_quantity_shares`.
- `transition_cost.unscaled_value_usd` == the *negative* of the sum over allocations of
  `increase_shares * route.increase_cost_usd_per_share + decrease_shares *
  route.decrease_cost_usd_per_share` (a cost subtracts from objective value); its
  `baseline_value_usd` is always 0 (the baseline/current state involves no transition).
- For every component: `delta_usd == unscaled_value_usd - baseline_value_usd`.
- `economics.total_value_usd == sum(component.unscaled_value_usd for component in components)`.
- `economics.total_delta_usd == sum(component.delta_usd for component in components)`.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from edge_cases import BOUNDARY_SYNTHETIC_CONFIGS, solve_dataset
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from inventory_optimizer.domain.requests import OptimizationRequest

from inventory_optimizer_api.contracts import (
    RunConfig,
    RunRequest,
    SourceDisclosure,
    SyntheticConfig,
)
from inventory_optimizer_api.datasets import envelope_from_request
from inventory_optimizer_api.engine_service import solve
from inventory_optimizer_api.synthetic import generate_dataset, generate_request

_DAY_COUNT_DAYS = {"act_360": 360, "act_365": 365}


def _component(result: dict, name: str) -> dict:
    return next(c for c in result["economics"]["components"] if c["component_name"] == name)


def _solve_with_horizon(seed: int, horizon: int, basis: str) -> tuple[dict, dict]:
    dataset = generate_dataset(SyntheticConfig(seed=seed, profile="balanced", scale="small"))
    response = solve(
        RunRequest(
            dataset=dataset,
            run_config=RunConfig(
                solver_time_limit_seconds=15, planning_horizon_days=horizon, day_count_basis=basis
            ),
        ),
        correlation_id=str(uuid4()),
        idempotency_key=str(uuid4()),
    )
    return response.result, dataset.request


# --- internal component bookkeeping ---------------------------------------------------------


@pytest.mark.parametrize("seed", [1, 42, 100])
def test_component_delta_equals_unscaled_minus_baseline(seed: int) -> None:
    result, _ = _solve_with_horizon(seed, horizon=1, basis="act_360")

    for component in result["economics"]["components"]:
        assert component["delta_usd"] == pytest.approx(
            component["unscaled_value_usd"] - component["baseline_value_usd"]
        )


@pytest.mark.parametrize("seed", [1, 42, 100])
def test_totals_equal_sum_of_components(seed: int) -> None:
    result, _ = _solve_with_horizon(seed, horizon=1, basis="act_360")
    components = result["economics"]["components"]

    assert result["economics"]["total_value_usd"] == pytest.approx(
        sum(c["unscaled_value_usd"] for c in components)
    )
    assert result["economics"]["total_delta_usd"] == pytest.approx(
        sum(c["delta_usd"] for c in components)
    )


@settings(max_examples=30, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(seed=st.integers(min_value=0, max_value=2**32 - 1))
def test_totals_equal_sum_of_components_property(seed: int) -> None:
    """Same invariant as above, swept broadly rather than trusting three fixed seeds."""
    result, _ = _solve_with_horizon(seed, horizon=1, basis="act_360")
    components = result["economics"]["components"]

    assert result["economics"]["total_value_usd"] == pytest.approx(
        sum(c["unscaled_value_usd"] for c in components)
    )
    assert result["economics"]["total_delta_usd"] == pytest.approx(
        sum(c["delta_usd"] for c in components)
    )
    for component in components:
        assert component["delta_usd"] == pytest.approx(
            component["unscaled_value_usd"] - component["baseline_value_usd"]
        )


@pytest.mark.parametrize(
    "config", BOUNDARY_SYNTHETIC_CONFIGS, ids=[str(c.seed) for c in BOUNDARY_SYNTHETIC_CONFIGS]
)
def test_economics_totals_reconcile_at_boundary_configs(config: SyntheticConfig) -> None:
    dataset = generate_dataset(config)
    response = solve_dataset(dataset)
    components = response.result["economics"]["components"]

    assert response.result["economics"]["total_value_usd"] == pytest.approx(
        sum(c["unscaled_value_usd"] for c in components)
    )


# --- reconciliation against raw allocation/route/inventory data ------------------------------


@pytest.mark.parametrize(
    ("horizon", "basis"), [(1, "act_360"), (5, "act_360"), (10, "act_365")]
)
def test_fee_revenue_reconciles_to_per_allocation_notional(horizon: int, basis: str) -> None:
    result, request = _solve_with_horizon(seed=42, horizon=horizon, basis=basis)
    routes_by_id = {r["route_id"]: r for r in request["routes"]}
    inventory_by_id = {r["inventory_id"]: r for r in request["inventory"]}
    basis_days = _DAY_COUNT_DAYS[basis]

    def notional_fee(quantity_field: str) -> float:
        total = 0.0
        for allocation in result["allocations"]:
            route = routes_by_id[allocation["route_id"]]
            price = inventory_by_id[route["inventory_id"]]["price_usd"]
            total += (
                allocation[quantity_field]
                * price
                * route["fee_rate"]
                * route["revenue_share"]
                * horizon
                / basis_days
            )
        return total

    fee_revenue = _component(result, "fee_revenue")
    assert fee_revenue["unscaled_value_usd"] == pytest.approx(
        notional_fee("post_quantity_shares")
    )
    assert fee_revenue["baseline_value_usd"] == pytest.approx(
        notional_fee("current_quantity_shares")
    )


def test_transition_cost_reconciles_to_per_allocation_transition_shares() -> None:
    request, _ = generate_request(SyntheticConfig(seed=42, profile="balanced", scale="small"))
    payload = request.model_dump(mode="json")
    for route in payload["routes"]:
        route["increase_cost_usd_per_share"] = 0.001
        route["decrease_cost_usd_per_share"] = 0.001
    tampered = OptimizationRequest.model_validate(payload)
    dataset = envelope_from_request(
        tampered, source=SourceDisclosure(mode="synthetic", label="Synthetic", seed=42)
    )

    response = solve(
        RunRequest(dataset=dataset, run_config=RunConfig(solver_time_limit_seconds=15)),
        correlation_id=str(uuid4()),
        idempotency_key=str(uuid4()),
    )
    result = response.result
    routes_by_id = {r["route_id"]: r for r in dataset.request["routes"]}

    def transition_cost_for(allocation: dict) -> float:
        route = routes_by_id[allocation["route_id"]]
        return (
            allocation["increase_shares"] * route["increase_cost_usd_per_share"]
            + allocation["decrease_shares"] * route["decrease_cost_usd_per_share"]
        )

    raw_transition_cost = sum(transition_cost_for(a) for a in result["allocations"])
    # Sanity: this dataset must actually produce transitions, or the assertion below is vacuous.
    assert raw_transition_cost > 0

    transition_cost = _component(result, "transition_cost")
    assert transition_cost["unscaled_value_usd"] == pytest.approx(-raw_transition_cost)
    assert transition_cost["baseline_value_usd"] == pytest.approx(0.0)
    assert transition_cost["delta_usd"] == pytest.approx(-raw_transition_cost)


def test_all_ineligible_routes_produce_zero_economics_not_an_error() -> None:
    """An all-ineligible-routes request should solve without error, every allocation quantity
    should be zero, and the economics block should reconcile trivially (every total is 0), not
    divide-by-zero or omit components."""
    request, _ = generate_request(
        SyntheticConfig(seed=1, profile="balanced", scale="small")
    )
    payload = request.model_dump(mode="json")
    for route in payload["routes"]:
        route["eligible"] = False
        route["current_quantity_shares"] = 0.0
        route["maximum_quantity_shares"] = 0.0
    for inventory in payload["inventory"]:
        # Keep the on_loan_shares/current_quantity_shares reconciliation check satisfied now
        # that every route's current quantity was zeroed above.
        inventory["available_to_lend_shares"] += inventory["on_loan_shares"]
        inventory["on_loan_shares"] = 0.0
    tampered = OptimizationRequest.model_validate(payload)
    dataset = envelope_from_request(
        tampered, source=SourceDisclosure(mode="synthetic", label="Synthetic", seed=1)
    )

    response = solve(
        RunRequest(dataset=dataset, run_config=RunConfig(solver_time_limit_seconds=15)),
        correlation_id=str(uuid4()),
        idempotency_key=str(uuid4()),
    )
    result = response.result

    # Every ineligible route still gets a (zero-quantity) allocation record -- the engine never
    # drops rows for inspectability -- so assert on quantities, not on an empty list.
    assert result["allocations"]
    assert all(a["post_quantity_shares"] == 0.0 for a in result["allocations"])
    assert result["economics"]["total_value_usd"] == pytest.approx(0.0)
    assert result["economics"]["total_delta_usd"] == pytest.approx(0.0)
    for component in result["economics"]["components"]:
        assert component["unscaled_value_usd"] == pytest.approx(0.0)
        assert component["baseline_value_usd"] == pytest.approx(0.0)
