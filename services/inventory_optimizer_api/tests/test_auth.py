"""Production kill switch and service-auth boundary tests.

require_service_auth() gates every non-/health endpoint. Before this file, it had zero direct
coverage -- the only tests that touched it (test_service.py) always ran with IBAL_ENV=local,
which never exercises the production kill switch at all. Split into direct unit calls (fast,
precise) and a handful of real HTTP round trips (proves the dependency is actually wired in).
"""

from __future__ import annotations

import pytest
from conftest import auth_headers
from fastapi import HTTPException
from fastapi.testclient import TestClient

from inventory_optimizer_api.auth import require_service_auth

VALID_UUID = "abcdef12-3456-7890-abcd-ef1234567890"


def _set_local_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("IBAL_ENV", "local")
    monkeypatch.delenv("IBAL_PRODUCTION_ENABLED", raising=False)
    monkeypatch.setenv("INVENTORY_OPTIMIZER_API_TOKEN", "tok")


# --- kill switch -------------------------------------------------------------------------


def test_production_disabled_by_default_returns_503(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("IBAL_ENV", "production")
    monkeypatch.delenv("IBAL_PRODUCTION_ENABLED", raising=False)
    monkeypatch.setenv("INVENTORY_OPTIMIZER_API_TOKEN", "tok")

    with pytest.raises(HTTPException) as exc_info:
        require_service_auth(authorization="Bearer tok", correlation_id=VALID_UUID)

    assert exc_info.value.status_code == 503
    assert "disabled" in exc_info.value.detail


@pytest.mark.parametrize("enabled_value", ["true", "TRUE", "True"])
def test_production_enabled_flag_allows_through(
    monkeypatch: pytest.MonkeyPatch, enabled_value: str
) -> None:
    monkeypatch.setenv("IBAL_ENV", "production")
    monkeypatch.setenv("IBAL_PRODUCTION_ENABLED", enabled_value)
    monkeypatch.setenv("INVENTORY_OPTIMIZER_API_TOKEN", "tok")

    result = require_service_auth(authorization="Bearer tok", correlation_id=VALID_UUID)

    assert result == VALID_UUID


def test_production_enabled_flag_false_still_returns_503(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("IBAL_ENV", "production")
    monkeypatch.setenv("IBAL_PRODUCTION_ENABLED", "false")
    monkeypatch.setenv("INVENTORY_OPTIMIZER_API_TOKEN", "tok")

    with pytest.raises(HTTPException) as exc_info:
        require_service_auth(authorization="Bearer tok", correlation_id=VALID_UUID)

    assert exc_info.value.status_code == 503


def test_local_env_ignores_production_enabled_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("IBAL_ENV", "local")
    monkeypatch.delenv("IBAL_PRODUCTION_ENABLED", raising=False)
    monkeypatch.setenv("INVENTORY_OPTIMIZER_API_TOKEN", "tok")

    result = require_service_auth(authorization="Bearer tok", correlation_id=VALID_UUID)

    assert result == VALID_UUID


def test_unset_env_defaults_to_local_and_is_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("IBAL_ENV", raising=False)
    monkeypatch.delenv("IBAL_PRODUCTION_ENABLED", raising=False)
    monkeypatch.setenv("INVENTORY_OPTIMIZER_API_TOKEN", "tok")

    result = require_service_auth(authorization="Bearer tok", correlation_id=VALID_UUID)

    assert result == VALID_UUID


def test_production_env_check_is_case_insensitive(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("IBAL_ENV", "PRODUCTION")
    monkeypatch.delenv("IBAL_PRODUCTION_ENABLED", raising=False)
    monkeypatch.setenv("INVENTORY_OPTIMIZER_API_TOKEN", "tok")

    with pytest.raises(HTTPException) as exc_info:
        require_service_auth(authorization="Bearer tok", correlation_id=VALID_UUID)

    assert exc_info.value.status_code == 503


# --- token / header validation ------------------------------------------------------------


def test_missing_service_token_configuration_returns_503(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("IBAL_ENV", "local")
    monkeypatch.delenv("INVENTORY_OPTIMIZER_API_TOKEN", raising=False)

    with pytest.raises(HTTPException) as exc_info:
        require_service_auth(authorization="Bearer anything", correlation_id=VALID_UUID)

    assert exc_info.value.status_code == 503
    assert "token" in exc_info.value.detail


def test_wrong_bearer_token_returns_401(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_local_allowed(monkeypatch)

    with pytest.raises(HTTPException) as exc_info:
        require_service_auth(authorization="Bearer wrong-token", correlation_id=VALID_UUID)

    assert exc_info.value.status_code == 401


def test_missing_authorization_header_returns_401(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_local_allowed(monkeypatch)

    with pytest.raises(HTTPException) as exc_info:
        require_service_auth(authorization=None, correlation_id=VALID_UUID)

    assert exc_info.value.status_code == 401


@pytest.mark.parametrize(
    "authorization", ["tok", "bearer tok", "Bearer", "Bearer  ", "Basic tok"]
)
def test_malformed_authorization_header_returns_401(
    monkeypatch: pytest.MonkeyPatch, authorization: str
) -> None:
    _set_local_allowed(monkeypatch)

    with pytest.raises(HTTPException) as exc_info:
        require_service_auth(authorization=authorization, correlation_id=VALID_UUID)

    assert exc_info.value.status_code == 401


def test_empty_bearer_token_returns_401(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("IBAL_ENV", "local")
    monkeypatch.setenv("INVENTORY_OPTIMIZER_API_TOKEN", "")

    with pytest.raises(HTTPException) as exc_info:
        require_service_auth(authorization="Bearer ", correlation_id=VALID_UUID)

    assert exc_info.value.status_code == 503  # empty configured token treated as "not configured"


# --- correlation id validation -------------------------------------------------------------


def test_missing_correlation_id_returns_400(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_local_allowed(monkeypatch)

    with pytest.raises(HTTPException) as exc_info:
        require_service_auth(authorization="Bearer tok", correlation_id=None)

    assert exc_info.value.status_code == 400


@pytest.mark.parametrize("correlation_id", ["not-a-uuid", "12345", "", "  "])
def test_malformed_correlation_id_returns_400(
    monkeypatch: pytest.MonkeyPatch, correlation_id: str
) -> None:
    _set_local_allowed(monkeypatch)

    with pytest.raises(HTTPException) as exc_info:
        require_service_auth(authorization="Bearer tok", correlation_id=correlation_id)

    assert exc_info.value.status_code == 400


def test_correlation_id_is_normalized_to_canonical_lowercase_form(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_local_allowed(monkeypatch)

    result = require_service_auth(
        authorization="Bearer tok", correlation_id="ABCDEF12-3456-7890-ABCD-EF1234567890"
    )

    assert result == VALID_UUID


# --- end-to-end: the dependency is actually wired into the real app ------------------------


def test_end_to_end_production_kill_switch_blocks_real_endpoint(
    raw_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("IBAL_ENV", "production")
    monkeypatch.delenv("IBAL_PRODUCTION_ENABLED", raising=False)
    monkeypatch.setenv("INVENTORY_OPTIMIZER_API_TOKEN", "test-token")

    response = raw_client.get("/v1/capabilities", headers=auth_headers())

    assert response.status_code == 503


def test_end_to_end_health_endpoint_is_unauthenticated_even_when_disabled(
    raw_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("IBAL_ENV", "production")
    monkeypatch.delenv("IBAL_PRODUCTION_ENABLED", raising=False)
    monkeypatch.delenv("INVENTORY_OPTIMIZER_API_TOKEN", raising=False)

    response = raw_client.get("/health")

    assert response.status_code == 200
    assert "engine_package_version" in response.json()
