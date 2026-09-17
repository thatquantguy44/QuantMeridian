"""Generic request-body validation handler (app.py: request_validation_handler), across endpoints.

Regression coverage for a real bug: fastapi.exceptions.RequestValidationError is FastAPI's own
class (it only subclasses pydantic's ValidationException in name), and in the pinned FastAPI
0.116.1 its errors() takes no keyword arguments at all. The handler previously called
exc.errors(include_url=False, include_context=False, include_input=False), which raised
TypeError on every single malformed request body -- silently converted by the catch-all Exception
handler into a 500 INTERNAL_ERROR instead of the intended 422 REQUEST_CONTRACT_INVALID. No prior
test ever sent a body that failed FastAPI's own Pydantic-model parsing (as opposed to
upload.py's separate, unaffected parsing path), so this was invisible until now. Covering several
different malformed-body shapes, across different endpoints, so a future dependency bump or
signature drift is caught immediately rather than silently regressing back to 500s.
"""

from __future__ import annotations

from conftest import auth_headers
from fastapi.testclient import TestClient

from inventory_optimizer_api.contracts import SyntheticConfig
from inventory_optimizer_api.synthetic import generate_dataset


def _assert_is_request_contract_invalid(response) -> None:
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "REQUEST_CONTRACT_INVALID"
    assert body["issues"], "expected at least one located issue"
    for issue in body["issues"]:
        assert issue["code"].startswith("REQUEST_")
        assert issue["location"].startswith("$.")


def test_wrong_type_field_returns_422_not_500(api_client: TestClient) -> None:
    dataset = generate_dataset(SyntheticConfig(seed=1, profile="balanced", scale="small"))

    response = api_client.post(
        "/v1/runs",
        json={
            "dataset": dataset.model_dump(mode="json"),
            "run_config": {"solver_time_limit_seconds": "not-a-number"},
        },
        headers=auth_headers(idempotency=True),
    )

    _assert_is_request_contract_invalid(response)


def test_unknown_nested_field_returns_422_not_500(api_client: TestClient) -> None:
    response = api_client.post(
        "/v1/datasets/synthetic",
        json={"seed": 1, "profile": "balanced", "scale": "small", "made_up_field": True},
        headers=auth_headers(),
    )

    _assert_is_request_contract_invalid(response)


def test_missing_required_field_returns_422_not_500(api_client: TestClient) -> None:
    dataset = generate_dataset(SyntheticConfig(seed=2, profile="balanced", scale="small"))
    payload = dataset.model_dump(mode="json")
    del payload["request_hash"]

    response = api_client.post(
        "/v1/validate",
        json=payload,
        headers=auth_headers(),
    )

    _assert_is_request_contract_invalid(response)


def test_extra_top_level_field_on_export_returns_422_not_500(api_client: TestClient) -> None:
    dataset = generate_dataset(SyntheticConfig(seed=3, profile="balanced", scale="small"))

    response = api_client.post(
        "/v1/exports/result-tables",
        json={
            "dataset": dataset.model_dump(mode="json"),
            "result": {"status": "optimal"},
            "unexpected_extra_field": "should be rejected",
        },
        headers=auth_headers(),
    )

    _assert_is_request_contract_invalid(response)


def test_malformed_json_body_returns_422_not_500(api_client: TestClient) -> None:
    response = api_client.post(
        "/v1/runs",
        content=b"{not valid json",
        headers={**auth_headers(idempotency=True), "content-type": "application/json"},
    )

    assert response.status_code == 422, response.text
