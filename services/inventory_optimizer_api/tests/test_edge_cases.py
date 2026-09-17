"""Boundary/edge-case sweep for synthetic generation.

Each config in edge_cases.BOUNDARY_SYNTHETIC_CONFIGS pushes independently-valid
SyntheticConfig fields toward their documented ge/le limits, in combinations the profile/scale
presets never reach. That is precisely where cross-field invariants (not enforced by any single
field's bounds) tend to break -- see
test_joint_reserve_and_utilization_bounds_stay_structurally_valid below for the concrete bug
this sweep caught.
"""

from __future__ import annotations

import pytest
from edge_cases import BOUNDARY_SYNTHETIC_CONFIGS, solve_dataset
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from inventory_optimizer_api.contracts import SyntheticConfig
from inventory_optimizer_api.synthetic import generate_dataset


@pytest.mark.parametrize(
    "config", BOUNDARY_SYNTHETIC_CONFIGS, ids=[str(c.seed) for c in BOUNDARY_SYNTHETIC_CONFIGS]
)
def test_boundary_configs_generate_valid_and_solvable_datasets(config: SyntheticConfig) -> None:
    dataset = generate_dataset(config)

    assert dataset.validation.valid, dataset.validation.issues

    response = solve_dataset(dataset)
    assert response.result["status"] in {"optimal", "feasible_limit"}


def test_boundary_configs_never_produce_negative_available_shares() -> None:
    dataset = generate_dataset(BOUNDARY_SYNTHETIC_CONFIGS[1])  # EDGE_MAX_EVERYTHING

    for row in dataset.request["inventory"]:
        assert row["available_to_lend_shares"] >= 0.0

    for row in dataset.request["routes"]:
        assert row["current_quantity_shares"] <= row["maximum_quantity_shares"]


def test_joint_reserve_and_utilization_bounds_stay_structurally_valid() -> None:
    """Regression: utilization_cap=1.0, starting_utilization=0.85, reserve_fraction=0.30 are
    each individually in-bounds, but on_loan + reserve used to exceed total, producing negative
    available_to_lend_shares and current_quantity_shares > maximum_quantity_shares on every
    affected route. Fixed by also capping starting_utilization against the room reserve_fraction
    leaves behind (synthetic.py generate_request).
    """
    config = SyntheticConfig(
        scale="custom",
        seed=123,
        security_count=20,
        inventory_pool_count=2,
        borrower_count=10,
        parent_group_count=4,
        routes_per_security=3,
        starting_utilization=0.85,
        utilization_cap=1.0,
        reserve_fraction=0.30,
    )

    dataset = generate_dataset(config)

    assert dataset.validation.valid, dataset.validation.issues
    for row in dataset.request["inventory"]:
        assert row["available_to_lend_shares"] >= 0.0


@settings(max_examples=100, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    seed=st.integers(min_value=0, max_value=2**32 - 1),
    starting_utilization=st.floats(min_value=0.0, max_value=0.85),
    utilization_cap=st.floats(min_value=0.25, max_value=1.0),
    reserve_fraction=st.floats(min_value=0.0, max_value=0.30),
)
def test_reserve_and_utilization_combinations_never_go_negative(
    seed: int, starting_utilization: float, utilization_cap: float, reserve_fraction: float
) -> None:
    config = SyntheticConfig(
        scale="custom",
        seed=seed,
        security_count=3,
        inventory_pool_count=1,
        borrower_count=2,
        parent_group_count=1,
        routes_per_security=2,
        starting_utilization=starting_utilization,
        utilization_cap=utilization_cap,
        reserve_fraction=reserve_fraction,
    )

    dataset = generate_dataset(config)

    assert dataset.validation.valid, dataset.validation.issues
