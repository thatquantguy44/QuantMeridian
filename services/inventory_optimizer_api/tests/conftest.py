from __future__ import annotations

from collections.abc import Iterator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from inventory_optimizer_api.app import app


def auth_headers(*, idempotency: bool = False) -> dict[str, str]:
    headers = {
        "Authorization": "Bearer test-token",
        "X-Correlation-ID": str(uuid4()),
    }
    if idempotency:
        headers["Idempotency-Key"] = str(uuid4())
    return headers


@pytest.fixture
def api_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("INVENTORY_OPTIMIZER_API_TOKEN", "test-token")
    monkeypatch.setenv("IBAL_ENV", "local")
    with TestClient(app) as client:
        yield client


@pytest.fixture
def raw_client() -> Iterator[TestClient]:
    """A TestClient with no auth/environment pre-configured, for tests that need to control
    IBAL_ENV / IBAL_PRODUCTION_ENABLED / INVENTORY_OPTIMIZER_API_TOKEN themselves."""
    with TestClient(app) as client:
        yield client
