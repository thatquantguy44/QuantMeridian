from __future__ import annotations

import pytest
from conftest import auth_headers
from edge_cases import conflicting_pool_dataset, solve_dataset
from fastapi.testclient import TestClient

from inventory_optimizer_api import app as app_module
from inventory_optimizer_api.config_adapter import RunConfigurationError
from inventory_optimizer_api.contracts import (
    LocatedIssue,
    RunConfig,
    RunRequest,
    RunResponse,
    SyntheticConfig,
)
from inventory_optimizer_api.engine_service import DatasetValidationError
from inventory_optimizer_api.synthetic import generate_dataset


def _dataset_payload(seed: int = 5) -> dict:
    config = SyntheticConfig(seed=seed, profile="balanced", scale="small")
    return generate_dataset(config).model_dump(mode="json")


def test_conflicting_hard_utilization_policies_solve_as_infeasible_not_an_error() -> None:
    dataset = conflicting_pool_dataset()
    assert dataset.validation.valid, dataset.validation.issues

    response = solve_dataset(dataset, run_config=RunConfig(solver_time_limit_seconds=15))

    assert response.result["status"] == "infeasible"
    assert response.result["allocations"] == []


def test_infeasible_run_returns_http_200_result_not_a_transport_error(
    api_client: TestClient,
) -> None:
    dataset = conflicting_pool_dataset()

    run_response = api_client.post(
        "/v1/runs",
        json={
            "dataset": dataset.model_dump(mode="json"),
            "run_config": {"solver_time_limit_seconds": 15},
        },
        headers=auth_headers(idempotency=True),
    )

    assert run_response.status_code == 200
    assert run_response.json()["result"]["status"] == "infeasible"


@pytest.mark.parametrize(
    "status",
    [
        "optimal",
        "feasible_limit",
        "infeasible",
        "unbounded",
        "infeasible_or_unbounded",
        "invalid_model",
        "numerical_error",
        "interrupted",
        "solver_error",
    ],
)
def test_every_solver_status_passes_through_unmodified(
    api_client: TestClient, monkeypatch: pytest.MonkeyPatch, status: str
) -> None:
    def fake_solve(run: RunRequest, *, correlation_id: str, idempotency_key: str) -> RunResponse:
        return RunResponse(
            source=run.dataset.source,
            request_hash=run.dataset.request_hash,
            result={"status": status, "input_hash": run.dataset.request_hash},
        )

    monkeypatch.setattr(app_module, "solve", fake_solve)

    response = api_client.post(
        "/v1/runs",
        json={"dataset": _dataset_payload()},
        headers=auth_headers(idempotency=True),
    )

    assert response.status_code == 200
    assert response.json()["result"]["status"] == status


def test_engine_incompatible_returns_503(
    api_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def raise_runtime_error(*_args: object, **_kwargs: object):
        raise RuntimeError("pinned optimizer engine is not ready")

    monkeypatch.setattr(app_module, "solve", raise_runtime_error)

    response = api_client.post(
        "/v1/runs",
        json={"dataset": _dataset_payload()},
        headers=auth_headers(idempotency=True),
    )

    assert response.status_code == 503
    assert response.json()["code"] == "ENGINE_INCOMPATIBLE"


def test_dataset_validation_error_returns_422(
    api_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def raise_validation_error(*_args: object, **_kwargs: object):
        issue = LocatedIssue(
            code="REQUEST_HASH_MISMATCH", message="stale", location="dataset.request_hash"
        )
        raise DatasetValidationError((issue,))

    monkeypatch.setattr(app_module, "solve", raise_validation_error)

    response = api_client.post(
        "/v1/runs",
        json={"dataset": _dataset_payload()},
        headers=auth_headers(idempotency=True),
    )

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "RUN_REJECTED"
    assert body["issues"][0]["code"] == "REQUEST_HASH_MISMATCH"


def test_run_configuration_conflict_returns_422(
    api_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def raise_config_error(*_args: object, **_kwargs: object):
        raise RunConfigurationError(
            (LocatedIssue(code="MIP_QP_CONFLICT", message="conflict", location="run_config"),)
        )

    monkeypatch.setattr(app_module, "solve", raise_config_error)

    response = api_client.post(
        "/v1/runs",
        json={"dataset": _dataset_payload()},
        headers=auth_headers(idempotency=True),
    )

    assert response.status_code == 422
    assert response.json()["code"] == "RUN_REJECTED"


def test_solve_timeout_returns_504(
    api_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def raise_timeout(*_args: object, **_kwargs: object):
        raise TimeoutError()

    monkeypatch.setattr(app_module, "solve", raise_timeout)

    response = api_client.post(
        "/v1/runs",
        json={"dataset": _dataset_payload()},
        headers=auth_headers(idempotency=True),
    )

    assert response.status_code == 504
    assert response.json()["code"] == "SOLVE_TIMEOUT"


def test_missing_idempotency_key_returns_400(api_client: TestClient) -> None:
    response = api_client.post(
        "/v1/runs",
        json={"dataset": _dataset_payload()},
        headers=auth_headers(idempotency=False),
    )

    assert response.status_code == 400
    assert response.json()["code"] == "IDEMPOTENCY_KEY_REQUIRED"
