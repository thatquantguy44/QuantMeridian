"""Shared edge-case fixtures for IBAL test suites.

Reusable, named boundary conditions so individual test files don't hand-roll their own
one-off "small edge case" configs. Add new named cases here as new boundaries are found;
reference them from tests with ``@pytest.mark.parametrize("config", BOUNDARY_SYNTHETIC_CONFIGS)``.

Field bounds mirror ``inventory_optimizer_api.contracts.SyntheticConfig``; if those bounds
change, update ``EDGE_MIN_EVERYTHING`` / ``EDGE_MAX_EVERYTHING`` to match.
"""

from __future__ import annotations

from uuid import uuid4

from inventory_optimizer.domain.requests import OptimizationRequest

from inventory_optimizer_api.contracts import (
    RunConfig,
    RunRequest,
    SourceDisclosure,
    SyntheticConfig,
)
from inventory_optimizer_api.datasets import envelope_from_request
from inventory_optimizer_api.engine_service import solve
from inventory_optimizer_api.synthetic import generate_request

EDGE_MIN_EVERYTHING = SyntheticConfig(
    scale="custom",
    seed=0,
    security_count=1,
    inventory_pool_count=1,
    borrower_count=1,
    parent_group_count=1,
    routes_per_security=1,
    starting_utilization=0.0,
    utilization_cap=0.25,
    borrower_concentration=0.0,
    fee_rate_mean=0.0001,
    fee_rate_dispersion=0.0,
    elasticity_mean=0.0,
    reserve_fraction=0.0,
    ineligible_fraction=0.0,
    discrete_route_fraction=0.0,
)

EDGE_MAX_EVERYTHING = SyntheticConfig(
    scale="custom",
    seed=2**32 - 1,
    security_count=100,
    inventory_pool_count=20,
    borrower_count=100,
    parent_group_count=50,
    routes_per_security=20,
    starting_utilization=0.85,
    utilization_cap=1.0,
    borrower_concentration=1.0,
    fee_rate_mean=0.25,
    fee_rate_dispersion=0.10,
    elasticity_mean=5.0,
    reserve_fraction=0.30,
    ineligible_fraction=0.50,
    discrete_route_fraction=0.50,
)

# routes_per_security=1 with ineligible_fraction at its max forces the
# "at least one route must stay eligible" fallback in synthetic.py (eligible_flags[0] = True).
EDGE_SINGLE_ROUTE_FORCED_ELIGIBLE = SyntheticConfig(
    scale="custom",
    seed=17,
    security_count=5,
    inventory_pool_count=1,
    borrower_count=3,
    parent_group_count=1,
    routes_per_security=1,
    ineligible_fraction=0.50,
)

# parent_group_count == borrower_count is the exact boundary of the
# SyntheticConfig.check_dates_and_shape validator (every borrower is its own parent).
EDGE_PARENT_GROUP_EQUALS_BORROWER_COUNT = SyntheticConfig(
    scale="custom",
    seed=5,
    security_count=4,
    inventory_pool_count=1,
    borrower_count=6,
    parent_group_count=6,
    routes_per_security=2,
)

# utilization_cap at its floor (0.25) with nonzero starting_utilization exercises the
# "starting_utilization clamped below cap - 0.08" branch in generate_request().
EDGE_TIGHT_UTILIZATION_CAP = SyntheticConfig(
    scale="custom",
    seed=31,
    security_count=6,
    inventory_pool_count=2,
    borrower_count=4,
    parent_group_count=2,
    routes_per_security=3,
    starting_utilization=0.20,
    utilization_cap=0.25,
)

# discrete_route_fraction at its max, paired with the "specials" profile behavior, produces
# the highest density of lot-sized (MIP) routes synthetic generation can create.
EDGE_MAX_DISCRETE_ROUTES = SyntheticConfig(
    scale="custom",
    seed=44,
    security_count=10,
    inventory_pool_count=2,
    borrower_count=5,
    parent_group_count=2,
    routes_per_security=4,
    discrete_route_fraction=0.50,
)

BOUNDARY_SYNTHETIC_CONFIGS: tuple[SyntheticConfig, ...] = (
    EDGE_MIN_EVERYTHING,
    EDGE_MAX_EVERYTHING,
    EDGE_SINGLE_ROUTE_FORCED_ELIGIBLE,
    EDGE_PARENT_GROUP_EQUALS_BORROWER_COUNT,
    EDGE_TIGHT_UTILIZATION_CAP,
    EDGE_MAX_DISCRETE_ROUTES,
)


def conflicting_pool_dataset(seed: int = 7):
    """A dataset that is contract-valid but genuinely LP-infeasible.

    Two independently-valid ``utilization_policies`` on the same inventory pool -- one
    ``maximum_utilization=0.30`` alone, one ``minimum_utilization=0.95`` alone -- compile
    into mutually exclusive LP rows for every route on that pool. Mirrors the InventoryBallast
    golden test ``test_utilization_floor_exceeds_cap.py``. Used to prove infeasible results
    are reported as a result status, never as a transport error and never as ``optimal``.
    """
    request, _ = generate_request(SyntheticConfig(seed=seed, profile="balanced", scale="small"))
    payload = request.model_dump(mode="json")
    payload["utilization_policies"] = [
        *payload["utilization_policies"],
        {
            "policy_id": "CONFLICT-CAP",
            "inventory_pool_id": "SYN-POOL-01",
            "effective_from": payload["as_of"],
            "maximum_utilization": 0.30,
            "source": "test",
            "source_version": "v1",
        },
        {
            "policy_id": "CONFLICT-FLOOR",
            "inventory_pool_id": "SYN-POOL-01",
            "effective_from": payload["as_of"],
            "minimum_utilization": 0.95,
            "source": "test",
            "source_version": "v1",
        },
    ]
    conflicted = OptimizationRequest.model_validate(payload)
    return envelope_from_request(
        conflicted, source=SourceDisclosure(mode="synthetic", label="Synthetic", seed=seed)
    )


def solve_dataset(dataset, *, run_config: RunConfig | None = None):
    """Solve a prepared dataset with fresh correlation/idempotency identifiers."""
    return solve(
        RunRequest(dataset=dataset, run_config=run_config or RunConfig()),
        correlation_id=str(uuid4()),
        idempotency_key=str(uuid4()),
    )
