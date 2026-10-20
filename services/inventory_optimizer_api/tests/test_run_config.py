"""RunConfig allowlist mapping, and discrete features with stability reaching the engine (AC-011).

config_adapter.engine_overrides() is the only place a client-supplied RunConfig reaches the
pinned engine's InventoryOptimizerConfig. Previously this was only exercised indirectly (via a
monkeypatched RunConfigurationError in test_status_matrix.py, or implicitly inside
test_contract_parity.py's happy path) -- never with a real MIP-requiring request, and never
checked for round-trip completeness. This file closes that gap. Since the 0020 pin the service
no longer refuses discrete features with a stability penalty (MIP_QP_CONFLICT); the engine
solves them as a stability-linearized MIP.
"""

from __future__ import annotations

from collections.abc import Callable

import pytest
from conftest import auth_headers
from fastapi.testclient import TestClient
from inventory_optimizer.config import InventoryOptimizerConfig
from inventory_optimizer.domain.requests import OptimizationRequest

from inventory_optimizer_api.config_adapter import engine_overrides
from inventory_optimizer_api.contracts import RunConfig, SourceDisclosure, SyntheticConfig
from inventory_optimizer_api.datasets import envelope_from_request
from inventory_optimizer_api.synthetic import generate_dataset, generate_request


def _mutated_request(mutate: Callable[[dict], None]) -> OptimizationRequest:
    request, _ = generate_request(SyntheticConfig(seed=1, profile="balanced", scale="small"))
    payload = request.model_dump(mode="json")
    mutate(payload)
    return OptimizationRequest.model_validate(payload)


# --- allowlist mapping completeness ---------------------------------------------------------


def test_engine_overrides_maps_every_run_config_field_one_to_one() -> None:
    request, _ = generate_request(SyntheticConfig(seed=2, profile="balanced", scale="small"))
    config = RunConfig(
        planning_horizon_days=30,
        day_count_basis="act_365",
        solver_time_limit_seconds=45.0,
        relative_gap=0.005,
        threads=4,
        solver_seed=999,
        max_staleness_hours=12.0,
        minimum_entity_confidence=0.95,
        allocation_stability_penalty=0.0,
    )

    overrides = engine_overrides(request, config)

    assert overrides == {
        "formulation": {"planning_horizon_days": 30, "day_count_basis": "act_365"},
        "validation": {"max_staleness_hours": 12.0, "minimum_entity_confidence": 0.95},
        "solver": {
            "backend": "highs",
            "time_limit_seconds": 45.0,
            "relative_gap": 0.005,
            "threads": 4,
            "seed": 999,
            "log_level": "warning",
        },
        "objective": {"allocation_stability_penalty": 0.0},
    }
    # And the resulting overrides must actually be a valid engine config, not just a shape match.
    InventoryOptimizerConfig.model_validate(overrides)


def test_unknown_run_config_field_is_rejected_by_the_api(api_client: TestClient) -> None:
    dataset = generate_dataset(SyntheticConfig(seed=3, profile="balanced", scale="small"))

    response = api_client.post(
        "/v1/runs",
        json={
            "dataset": dataset.model_dump(mode="json"),
            "run_config": {"solver_time_limit_seconds": 10, "made_up_field": 1},
        },
        headers=auth_headers(idempotency=True),
    )

    assert response.status_code == 422
    assert response.json()["code"] == "REQUEST_CONTRACT_INVALID"


# --- Discrete features with a stability penalty: no service guard (0018 T-020 / AC-011) -------


@pytest.mark.parametrize(
    "mutate",
    [
        lambda payload: payload["routes"][0].update(all_or_none=True),
        lambda payload: payload["routes"][0].update(minimum_active_quantity_shares=10.0),
        lambda payload: payload["routes"][0].update(lot_size_shares=100.0),
        lambda payload: payload["utilization_policies"][0].update(maximum_active_routes=3),
    ],
    ids=["all_or_none", "minimum_active_quantity", "lot_size", "maximum_active_routes"],
)
@pytest.mark.parametrize("penalty", [0.0, 0.1])
def test_each_mip_trigger_passes_through_with_any_stability_penalty(
    mutate: Callable[[dict], None], penalty: float
) -> None:
    request = _mutated_request(mutate)

    overrides = engine_overrides(request, RunConfig(allocation_stability_penalty=penalty))

    assert overrides["objective"]["allocation_stability_penalty"] == penalty


def test_mip_with_stability_solves_as_the_linearized_variant(api_client: TestClient) -> None:
    """AC-011: the request the old guard refused now reaches the engine, which solves and verifies
    it as a stability-linearized MIP."""
    request = _mutated_request(lambda payload: payload["routes"][0].update(lot_size_shares=100.0))
    source = SourceDisclosure(mode="synthetic", label="lot-size probe")
    dataset = envelope_from_request(request, source=source).model_dump(mode="json")
    response = api_client.post(
        "/v1/runs",
        json={"dataset": dataset, "run_config": {"allocation_stability_penalty": 0.1}},
        headers=auth_headers(idempotency=True),
    )
    assert response.status_code == 200, response.text
    result = response.json()["result"]
    assert result["formulation"]["variant"] == "mip_linearized_stability"
    assert result["formulation"]["integer_variable_count"] > 0
    assert result["verification"]["passed"] is True


def test_no_mip_features_with_positive_stability_penalty_is_allowed() -> None:
    request, _ = generate_request(SyntheticConfig(seed=1, profile="balanced", scale="small"))

    overrides = engine_overrides(request, RunConfig(allocation_stability_penalty=0.1))

    assert overrides["objective"]["allocation_stability_penalty"] == 0.1
