from __future__ import annotations

import zipfile
from io import BytesIO
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from inventory_optimizer_api.app import app
from inventory_optimizer_api.canonical import canonical_hash
from inventory_optimizer_api.contracts import ExportRequest, RunConfig, RunRequest, SyntheticConfig
from inventory_optimizer_api.engine_service import export_bundle, solve, validation_report
from inventory_optimizer_api.synthetic import generate_dataset
from inventory_optimizer_api.templates import json_template, workbook_template
from inventory_optimizer_api.upload import UploadValidationError, parse_upload


def _headers(*, idempotency: bool = False) -> dict[str, str]:
    headers = {
        "Authorization": "Bearer test-token",
        "X-Correlation-ID": str(uuid4()),
    }
    if idempotency:
        headers["Idempotency-Key"] = str(uuid4())
    return headers


def test_synthetic_solve_and_export_bundle() -> None:
    dataset = generate_dataset(SyntheticConfig(seed=42, profile="balanced", scale="small"))

    assert validation_report(dataset).valid
    assert dataset.request_hash == canonical_hash(dataset.request)

    response = solve(
        RunRequest(dataset=dataset, run_config=RunConfig(solver_time_limit_seconds=30)),
        correlation_id=str(uuid4()),
        idempotency_key=str(uuid4()),
    )

    assert response.result["status"] == "optimal"
    assert response.result["input_hash"] == dataset.request_hash

    archive = export_bundle(ExportRequest(dataset=dataset, result=response.result))
    with zipfile.ZipFile(BytesIO(archive)) as bundle:
        names = set(bundle.namelist())

    assert "normalized-input.json" in names
    assert "raw-result.json" in names
    assert "validation-report.json" in names
    assert any(name.startswith("result-tables/") and name.endswith(".csv") for name in names)


def test_templates_round_trip_through_upload_parser() -> None:
    json_envelope = parse_upload(json_template(), "request.json")
    xlsx_envelope = parse_upload(workbook_template("starter-xlsx"), "request.xlsx")

    assert json_envelope.validation.valid
    assert xlsx_envelope.validation.valid
    assert json_envelope.request["request_id"] == xlsx_envelope.request["request_id"]
    assert json_envelope.request["problem_family"] == xlsx_envelope.request["problem_family"]
    assert json_envelope.summary.row_counts == xlsx_envelope.summary.row_counts


def test_upload_rejects_duplicate_json_keys() -> None:
    with pytest.raises(UploadValidationError) as exc_info:
        parse_upload(b'{"request_id":"one","request_id":"two"}', "bad.json")

    assert exc_info.value.issues[0].code == "DUPLICATE_JSON_KEY"


def test_upload_rejects_xlsx_formulas() -> None:
    workbook = load_workbook(BytesIO(workbook_template("starter-xlsx")), data_only=False)
    workbook["inventory"]["A2"] = "=CONCAT(\"SYN\", \"-INV\")"
    output = BytesIO()
    workbook.save(output)

    with pytest.raises(UploadValidationError) as exc_info:
        parse_upload(output.getvalue(), "formula.xlsx")

    assert any(issue.code == "FORMULA_NOT_ALLOWED" for issue in exc_info.value.issues)


def test_api_requires_auth_and_runs_solver(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INVENTORY_OPTIMIZER_API_TOKEN", "test-token")
    monkeypatch.setenv("IBAL_ENV", "local")

    with TestClient(app) as client:
        unauthorized = client.get("/v1/capabilities")
        assert unauthorized.status_code == 401

        capabilities = client.get("/v1/capabilities", headers=_headers())
        assert capabilities.status_code == 200
        assert capabilities.json()["engine_compatible"] is True

        dataset_response = client.post(
            "/v1/datasets/synthetic",
            json={"seed": 99, "profile": "balanced", "scale": "small"},
            headers=_headers(),
        )
        assert dataset_response.status_code == 200
        dataset = dataset_response.json()
        assert dataset["validation"]["valid"] is True

        run_response = client.post(
            "/v1/runs",
            json={"dataset": dataset, "run_config": {"solver_time_limit_seconds": 30}},
            headers=_headers(idempotency=True),
        )
        assert run_response.status_code == 200
        result = run_response.json()
        assert result["result"]["status"] == "optimal"

        export_response = client.post(
            "/v1/exports/result-tables",
            json={"dataset": dataset, "result": result["result"]},
            headers=_headers(),
        )
        assert export_response.status_code == 200
        assert export_response.headers["content-type"] == "application/zip"
