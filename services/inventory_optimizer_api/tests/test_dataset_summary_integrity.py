"""Dataset envelope summary integrity (AC-010).

DatasetEnvelope.summary is a disclosure -- row counts, totals, borrower/security counts -- meant
to describe what dataset.request actually contains, so a user/auditor can trust it without
re-deriving it themselves. Before this file, nothing checked that the two actually agreed:
request_hash verification (validated_request()) only covers dataset.request, never
dataset.summary, and no other code path recomputed/compared it either. A caller could tamper with
just the summary (leave request and its hash untouched) and it would sail through solve() and
export_bundle() unnoticed -- the solve would run correctly on the real request, but the disclosed
summary a user/auditor sees could describe a different book entirely.

Fixed by validated_request() (engine_service.py) recomputing datasets.summarize(request) and
rejecting a mismatch with SUMMARY_MISMATCH, mirroring the existing REQUEST_HASH_MISMATCH pattern.
This file is the regression suite for that fix.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from conftest import auth_headers
from fastapi.testclient import TestClient
from inventory_optimizer.domain.requests import OptimizationRequest

from inventory_optimizer_api.contracts import ExportRequest, RunConfig, RunRequest, SyntheticConfig
from inventory_optimizer_api.datasets import summarize
from inventory_optimizer_api.engine_service import (
    DatasetValidationError,
    export_bundle,
    solve,
    validation_report,
)
from inventory_optimizer_api.synthetic import generate_dataset


def _dataset():
    return generate_dataset(SyntheticConfig(seed=1, profile="balanced", scale="small"))


def test_untampered_summary_always_equals_a_fresh_recomputation() -> None:
    """Sanity anchor: summarize(request) must be deterministic and bit-identical to the summary
    generate_dataset() already attached, or the fix below would reject every legitimate dataset."""
    dataset = _dataset()
    request = OptimizationRequest.model_validate(dataset.request)

    assert summarize(request) == dataset.summary


@pytest.mark.parametrize(
    "field_update",
    [
        {"total_lendable_shares": 999_999_999.0},
        {"total_available_shares": 0.0},
        {"total_current_on_loan_shares": -1.0},
        {"total_demand_shares": 0.0},
        {"borrower_count": 1},
        {"security_count": 1},
        {
            "row_counts": {
                "inventory": 1,
                "routes": 1,
                "demand": 1,
                "counterparty_limits": 1,
                "utilization_policies": 1,
                "entity_relationships": 1,
            }
        },
    ],
    ids=[
        "total_lendable_shares",
        "total_available_shares",
        "total_current_on_loan_shares",
        "total_demand_shares",
        "borrower_count",
        "security_count",
        "row_counts",
    ],
)
def test_solve_rejects_a_tampered_summary_field(field_update: dict) -> None:
    dataset = _dataset()
    tampered = dataset.model_copy(
        update={"summary": dataset.summary.model_copy(update=field_update)}
    )

    with pytest.raises(DatasetValidationError) as exc_info:
        solve(
            RunRequest(dataset=tampered, run_config=RunConfig(solver_time_limit_seconds=10)),
            correlation_id=str(uuid4()),
            idempotency_key=str(uuid4()),
        )

    assert exc_info.value.issues[0].code == "SUMMARY_MISMATCH"


def test_validation_report_rejects_a_tampered_summary() -> None:
    dataset = _dataset()
    tampered = dataset.model_copy(
        update={"summary": dataset.summary.model_copy(update={"security_count": 1})}
    )

    report = validation_report(tampered)

    assert report.valid is False
    assert report.issues[0].code == "SUMMARY_MISMATCH"


def test_export_bundle_rejects_a_tampered_summary() -> None:
    dataset = _dataset()
    response = solve(
        RunRequest(dataset=dataset, run_config=RunConfig(solver_time_limit_seconds=10)),
        correlation_id=str(uuid4()),
        idempotency_key=str(uuid4()),
    )
    tampered = dataset.model_copy(
        update={"summary": dataset.summary.model_copy(update={"borrower_count": 1})}
    )

    with pytest.raises(DatasetValidationError) as exc_info:
        export_bundle(ExportRequest(dataset=tampered, result=response.result))

    assert exc_info.value.issues[0].code == "SUMMARY_MISMATCH"


def test_end_to_end_run_rejects_a_tampered_summary(api_client: TestClient) -> None:
    dataset = _dataset()
    payload = dataset.model_dump(mode="json")
    payload["summary"]["total_lendable_shares"] = 1.0

    response = api_client.post(
        "/v1/runs",
        json={"dataset": payload},
        headers=auth_headers(idempotency=True),
    )

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "RUN_REJECTED"
    assert body["issues"][0]["code"] == "SUMMARY_MISMATCH"
