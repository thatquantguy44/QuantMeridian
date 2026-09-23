"""Health-endpoint and engine-identity mismatch matrix (AC-019).

engine_identity() (capabilities.py) compares the installed InventoryBallast package
version/commit and solver backends against capability-manifest.json. It is the sole source of
the `/health` endpoint's ready/unready state, `/v1/capabilities`' `engine_compatible` flag, and
`require_compatible_engine()`'s 503. Before this file, only the happy path (everything matches,
in this dev environment) had any coverage -- every mismatch branch was untested.

Faking strategy: `capabilities.metadata` is the stdlib `importlib.metadata` module, called as
`metadata.version(name)` / `metadata.distribution(name)`. A small `FakeMetadata` stand-in
(exposing the same two methods plus the real `PackageNotFoundError` class, so `except
metadata.PackageNotFoundError` still catches correctly) is swapped in via monkeypatch to simulate
"wrong version installed" or "package not found", independent of what's actually installed in this
venv. The commit-mismatch case doesn't need faking at all -- `_installed_commit()` already has a
real `INVENTORY_OPTIMIZER_ENGINE_COMMIT` override seam, so setting it to a wrong value is a more
realistic simulation than faking distribution metadata parsing.
"""

from __future__ import annotations

import importlib.metadata as real_metadata
from uuid import uuid4

import pytest
from conftest import auth_headers
from fastapi.testclient import TestClient
from inventory_optimizer.domain.requests import OptimizationRequest

from inventory_optimizer_api import capabilities
from inventory_optimizer_api.capabilities import (
    engine_identity,
    manifest,
    require_compatible_engine,
)
from inventory_optimizer_api.contracts import (
    RunConfig,
    RunRequest,
    SourceDisclosure,
    SyntheticConfig,
)
from inventory_optimizer_api.datasets import envelope_from_request
from inventory_optimizer_api.engine_service import solve
from inventory_optimizer_api.synthetic import generate_dataset


class FakeMetadata:
    """Stands in for capabilities.metadata (== importlib.metadata) in engine_identity()."""

    PackageNotFoundError = real_metadata.PackageNotFoundError

    def __init__(
        self, *, overrides: dict[str, str] | None = None, missing: frozenset[str] = frozenset()
    ) -> None:
        self._overrides = overrides or {}
        self._missing = missing

    def version(self, name: str) -> str:
        if name in self._missing:
            raise real_metadata.PackageNotFoundError(name)
        return self._overrides.get(name, real_metadata.version(name))

    def distribution(self, name: str):  # noqa: ANN201 -- passthrough to the real stdlib type
        return real_metadata.distribution(name)


@pytest.fixture
def fake_metadata(monkeypatch: pytest.MonkeyPatch):
    def apply(**kwargs: object) -> FakeMetadata:
        fake = FakeMetadata(**kwargs)  # type: ignore[arg-type]
        monkeypatch.setattr(capabilities, "metadata", fake)
        return fake

    return apply


@pytest.fixture
def valid_dataset_payload() -> dict:
    return generate_dataset(SyntheticConfig(seed=1, profile="balanced", scale="small")).model_dump(
        mode="json"
    )


# --- engine_identity() happy path -----------------------------------------------------------


def test_engine_identity_is_ready_in_this_dev_environment() -> None:
    """Sanity anchor: the pinned engine in this venv genuinely matches the manifest. Every
    mismatch test below is only meaningful relative to this being true."""
    identity = engine_identity()
    expected = manifest()

    assert identity["ready"] is True
    assert identity["package_version"] == expected["engine_package_version"]
    assert identity["installed_commit"] == expected["engine_commit"]
    assert identity["active_backend"] is not None
    assert identity["formulations"]


# --- engine_identity() mismatch matrix -------------------------------------------------------


def test_wrong_package_version_is_not_ready(fake_metadata) -> None:
    fake_metadata(overrides={"inventory-optimizer": "9.9.9"})

    identity = engine_identity()

    assert identity["ready"] is False
    assert identity["package_version"] == "9.9.9"


def test_package_not_found_is_not_ready(fake_metadata) -> None:
    fake_metadata(missing=frozenset({"inventory-optimizer"}))

    identity = engine_identity()

    assert identity["ready"] is False
    assert identity["package_version"] is None


def test_missing_highspy_uses_scipy_highs_fallback(fake_metadata) -> None:
    fake_metadata(missing=frozenset({"highspy"}))

    identity = engine_identity()

    assert identity["ready"] is True
    assert identity["active_backend"] == "scipy_highs"
    assert identity["backend_version"] is None
    assert identity["solver_backends"]["highs"]["ready"] is False
    assert identity["solver_backends"]["scipy_highs"]["ready"] is True
    assert identity["formulations"] == ["lp", "mip"]


def test_missing_all_solver_backends_is_not_ready(fake_metadata) -> None:
    fake_metadata(missing=frozenset({"highspy", "scipy"}))

    identity = engine_identity()

    assert identity["ready"] is False
    assert identity["active_backend"] is None
    assert identity["formulations"] == []


def test_wrong_commit_is_not_ready(monkeypatch: pytest.MonkeyPatch) -> None:
    wrong_commit = "0000000000000000000000000000000000000000"
    monkeypatch.setenv("INVENTORY_OPTIMIZER_ENGINE_COMMIT", wrong_commit)

    identity = engine_identity()

    assert identity["ready"] is False
    assert identity["installed_commit"] == wrong_commit


def test_commit_override_matching_manifest_is_ready(monkeypatch: pytest.MonkeyPatch) -> None:
    expected = manifest()
    monkeypatch.setenv("INVENTORY_OPTIMIZER_ENGINE_COMMIT", expected["engine_commit"])

    identity = engine_identity()

    assert identity["ready"] is True


# --- /health endpoint reflects engine_identity() exactly -------------------------------------


def test_health_endpoint_reports_ready_in_this_dev_environment(raw_client: TestClient) -> None:
    response = raw_client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["ready"] is True
    assert body["error_category"] is None
    assert body["backend"]["ready"] is True
    assert body["formulations"]


def test_health_endpoint_reports_unready_and_error_category_on_mismatch(
    raw_client: TestClient, fake_metadata
) -> None:
    fake_metadata(overrides={"inventory-optimizer": "9.9.9"})

    response = raw_client.get("/health")

    assert response.status_code == 200  # unready is a reported state, not a transport failure
    body = response.json()
    assert body["status"] == "unready"
    assert body["ready"] is False
    assert body["error_category"] == "incompatible_engine"
    # The mismatched value is still disclosed, not hidden behind the generic error category.
    assert body["engine_package_version"] == "9.9.9"


def test_health_endpoint_is_unauthenticated_with_scipy_fallback(
    raw_client: TestClient, fake_metadata
) -> None:
    fake_metadata(missing=frozenset({"highspy"}))

    response = raw_client.get("/health")

    assert response.status_code == 200


# --- /v1/capabilities' engine_compatible tracks the same identity ----------------------------


def test_capabilities_engine_compatible_matches_identity_on_mismatch(
    api_client: TestClient, fake_metadata
) -> None:
    fake_metadata(overrides={"inventory-optimizer": "9.9.9"})

    response = api_client.get("/v1/capabilities", headers=auth_headers())

    assert response.status_code == 200
    assert response.json()["engine_compatible"] is False


def test_capabilities_drop_qp_when_highspy_is_missing(
    api_client: TestClient, fake_metadata
) -> None:
    fake_metadata(missing=frozenset({"highspy"}))

    response = api_client.get("/v1/capabilities", headers=auth_headers())

    assert response.status_code == 200
    body = response.json()
    assert body["engine_compatible"] is True
    assert body["backend"]["name"] == "scipy_highs"
    assert body["formulations"] == ["lp", "mip"]
    assert body["solver_backends"]["highs"]["formulations"] == []


# --- require_compatible_engine() / solve() actually refuse to run on mismatch ----------------


def test_require_compatible_engine_raises_on_mismatch(fake_metadata) -> None:
    fake_metadata(overrides={"inventory-optimizer": "9.9.9"})

    with pytest.raises(RuntimeError, match="does not match capability-manifest"):
        require_compatible_engine()


def test_require_compatible_engine_passes_when_ready() -> None:
    require_compatible_engine()  # must not raise


def test_require_compatible_engine_passes_with_scipy_fallback(fake_metadata) -> None:
    fake_metadata(missing=frozenset({"highspy"}))

    require_compatible_engine()


def test_require_compatible_engine_raises_without_any_solver_backend(fake_metadata) -> None:
    fake_metadata(missing=frozenset({"highspy", "scipy"}))

    with pytest.raises(RuntimeError, match="no supported optimizer solver backend"):
        require_compatible_engine()


def test_solve_refuses_to_run_on_real_mismatch_not_monkeypatched_solve(
    fake_metadata, valid_dataset_payload: dict
) -> None:
    """Unlike test_status_matrix.py's ENGINE_INCOMPATIBLE test (which monkeypatches solve() itself
    to raise RuntimeError), this drives the real mismatch through engine_identity() and calls the
    real solve() -- proving require_compatible_engine() is actually wired into the solve path,
    not just that app.py maps a RuntimeError to 503 if one happens to be raised."""
    fake_metadata(overrides={"inventory-optimizer": "9.9.9"})
    request = OptimizationRequest.model_validate(valid_dataset_payload["request"])
    source = SourceDisclosure(mode="synthetic", label="Synthetic", seed=1)
    dataset = envelope_from_request(request, source=source)

    with pytest.raises(RuntimeError, match="does not match capability-manifest"):
        solve(
            RunRequest(dataset=dataset, run_config=RunConfig(solver_time_limit_seconds=10)),
            correlation_id=str(uuid4()),
            idempotency_key=str(uuid4()),
        )


def test_solve_uses_scipy_highs_fallback_when_highspy_is_missing(
    fake_metadata, valid_dataset_payload: dict
) -> None:
    fake_metadata(missing=frozenset({"highspy"}))
    request = OptimizationRequest.model_validate(valid_dataset_payload["request"])
    source = SourceDisclosure(mode="synthetic", label="Synthetic", seed=1)
    dataset = envelope_from_request(request, source=source)

    response = solve(
        RunRequest(dataset=dataset, run_config=RunConfig(solver_time_limit_seconds=10)),
        correlation_id=str(uuid4()),
        idempotency_key=str(uuid4()),
    )

    assert response.result["status"] == "optimal"
    assert response.result["solver"]["backend_name"] == "scipy_highs"
    assert response.result["verification"]["passed"] is True


def test_end_to_end_run_returns_503_on_real_mismatch(
    api_client: TestClient, fake_metadata, valid_dataset_payload: dict
) -> None:
    fake_metadata(overrides={"inventory-optimizer": "9.9.9"})

    response = api_client.post(
        "/v1/runs",
        json={"dataset": valid_dataset_payload},
        headers=auth_headers(idempotency=True),
    )

    assert response.status_code == 503
    assert response.json()["code"] == "ENGINE_INCOMPATIBLE"
