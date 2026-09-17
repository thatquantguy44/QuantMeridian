from __future__ import annotations

import logging

import pytest
from conftest import auth_headers
from fastapi.testclient import TestClient
from inventory_optimizer.domain.requests import OptimizationRequest

from inventory_optimizer_api.contracts import SourceDisclosure, SyntheticConfig
from inventory_optimizer_api.datasets import envelope_from_request
from inventory_optimizer_api.synthetic import generate_request
from inventory_optimizer_api.telemetry import LOGGER

CONFIDENTIAL_SENTINEL = "CONFIDENTIAL-BOOK-ACME-0xSECRET-42"


def test_confidential_sentinels_absent_from_upload_rejection_logs(
    api_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    payload = (
        '{"request_id":"' + CONFIDENTIAL_SENTINEL + '","request_id":"duplicate"}'
    ).encode("utf-8")

    with caplog.at_level(logging.INFO, logger=LOGGER.name):
        response = api_client.post(
            "/v1/datasets/upload",
            files={"file": ("confidential.json", payload, "application/json")},
            headers=auth_headers(),
        )

    assert response.status_code == 422
    for record in caplog.records:
        assert CONFIDENTIAL_SENTINEL not in record.getMessage()


def test_confidential_sentinels_absent_from_solve_rejection_logs(
    api_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    request, _ = generate_request(SyntheticConfig(seed=3, profile="balanced", scale="small"))
    tampered = OptimizationRequest.model_validate(
        {**request.model_dump(mode="json"), "request_id": CONFIDENTIAL_SENTINEL}
    )
    dataset = envelope_from_request(
        tampered, source=SourceDisclosure(mode="synthetic", label="Synthetic", seed=3)
    )
    # Corrupt the recorded hash so the service rejects it as stale/tampered.
    stale_dataset = dataset.model_copy(update={"request_hash": "0" * 64})

    with caplog.at_level(logging.INFO, logger=LOGGER.name):
        response = api_client.post(
            "/v1/runs",
            json={"dataset": stale_dataset.model_dump(mode="json")},
            headers=auth_headers(idempotency=True),
        )

    assert response.status_code == 422
    assert response.json()["code"] == "RUN_REJECTED"
    for record in caplog.records:
        assert CONFIDENTIAL_SENTINEL not in record.getMessage()
