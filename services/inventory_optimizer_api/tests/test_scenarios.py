from __future__ import annotations

import json
from uuid import uuid4

from inventory_optimizer_api.contracts import RunConfig, RunRequest, SyntheticConfig
from inventory_optimizer_api.engine_service import solve
from inventory_optimizer_api.synthetic import generate_dataset


def _headers(*, idempotency: bool = False) -> dict[str, str]:
    headers = {"Authorization": "Bearer test-token", "X-Correlation-ID": str(uuid4())}
    if idempotency:
        headers["Idempotency-Key"] = str(uuid4())
    return headers


def test_scenario_catalog_returns_pinned_engine_registry(api_client) -> None:
    response = api_client.get("/v1/scenarios/catalog", headers=_headers())

    assert response.status_code == 200
    body = response.json()
    assert body["api_schema_version"] == "1.0.0"
    scenario_types = {item["scenario_type"] for item in body["scenarios"]}
    assert {"borrower_default", "supply_shock", "rate_shock_ladder"} <= scenario_types


def test_scenario_stress_runs_registry_scenario_against_verified_baseline(api_client) -> None:
    dataset = generate_dataset(SyntheticConfig(seed=42, profile="balanced", scale="small"))
    run_config = RunConfig(solver_time_limit_seconds=10)
    baseline = solve(
        RunRequest(dataset=dataset, run_config=run_config),
        correlation_id=str(uuid4()),
        idempotency_key=str(uuid4()),
    )
    baseline_result = json.loads(baseline.model_dump_json())["result"]
    inventory = dataset.request["inventory"][0]
    payload = {
        "dataset": dataset.model_dump(mode="json"),
        "run_config": run_config.model_dump(mode="json"),
        "baseline_result": baseline_result,
        "scenario_type": "supply_shock",
        "parameters": {
            "scenario_id": "SYN-SCENARIO-001",
            "name": "Synthetic supply reduction",
            "source": "synthetic-test",
            "source_version": "test-v1",
            "inventory_id": inventory["inventory_id"],
            "quantity_shares": min(100.0, inventory["available_to_lend_shares"]),
            "trade_date": dataset.request["effective_date"],
            "effective_date": dataset.request["effective_date"],
            "settlement_date": dataset.request["effective_date"],
        },
    }

    response = api_client.post(
        "/v1/scenarios/stress-test",
        json=payload,
        headers=_headers(idempotency=True),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["request_hash"] == dataset.request_hash
    assert len(body["generated_scenarios"]) == 1
    assert body["stress_report"]["scenario_count"] == 1


def test_scenario_stress_rejects_unknown_targets(api_client) -> None:
    dataset = generate_dataset(SyntheticConfig(seed=42, profile="balanced", scale="small"))
    run_config = RunConfig(solver_time_limit_seconds=10)
    baseline = solve(
        RunRequest(dataset=dataset, run_config=run_config),
        correlation_id=str(uuid4()),
        idempotency_key=str(uuid4()),
    )
    baseline_result = json.loads(baseline.model_dump_json())["result"]
    parameters = {
        "scenario_id": "SYN-SCENARIO-002",
        "name": "Unknown supply target",
        "source": "synthetic-test",
        "source_version": "test-v1",
        "inventory_id": "UNKNOWN-INVENTORY",
        "quantity_shares": 100.0,
        "trade_date": dataset.request["effective_date"],
        "effective_date": dataset.request["effective_date"],
        "settlement_date": dataset.request["effective_date"],
    }

    response = api_client.post(
        "/v1/scenarios/stress-test",
        json={
            "dataset": dataset.model_dump(mode="json"),
            "run_config": run_config.model_dump(mode="json"),
            "baseline_result": baseline_result,
            "scenario_type": "supply_shock",
            "parameters": parameters,
        },
        headers=_headers(idempotency=True),
    )

    assert response.status_code == 422
    assert response.json()["code"] == "SCENARIO_RUN_REJECTED"
