"""The authenticated HTTP boundary (spec020 IND-T13)."""

import copy
import logging
import uuid

import pytest
from fastapi.testclient import TestClient

from indemnification_api import app as app_module
from indemnification_api.canonical import canonical_hash
from indemnification_api.contracts import seal

TOKEN = "test-token"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("INDEMNIFICATION_API_TOKEN", TOKEN)
    monkeypatch.delenv("INDEM_ENV", raising=False)
    app_module._history.clear()
    app_module._idempotency.clear()
    return TestClient(app_module.app)


def headers(token=TOKEN, correlation=None):
    return {
        "Authorization": f"Bearer {token}",
        "X-Correlation-ID": correlation or str(uuid.uuid4()),
    }


def body(snapshot, **options):
    return {
        "api_schema_version": "1.0",
        "snapshot": snapshot,
        "options": {
            "sensitivity_paths": None,
            "stresses": False,
            "stress_profile_overrides": None,
            **options,
        },
    }


def errors(validator, value):
    return [e.message for e in validator.iter_errors(value)]


def test_health_is_open_and_reports_whether_auth_is_configured(client, monkeypatch):
    r = client.get("/health")
    assert (
        r.status_code == 200 and r.json()["ready"] is True and r.json()["auth_configured"] is True
    )
    monkeypatch.delenv("INDEMNIFICATION_API_TOKEN")
    assert client.get("/health").json()["auth_configured"] is False


def test_routes_need_the_service_token(client, snapshot):
    assert client.get("/v1/capabilities").status_code == 401
    assert client.get("/v1/capabilities", headers=headers("wrong")).status_code == 401
    assert client.post("/v1/runs", json=body(snapshot)).status_code == 401


def test_an_unconfigured_service_or_a_disabled_production_refuses_everything(client, monkeypatch):
    monkeypatch.setenv("INDEM_ENV", "production")
    assert client.get("/v1/capabilities", headers=headers()).status_code == 503
    assert client.get("/health").json()["ready"] is False
    monkeypatch.setenv("INDEM_PRODUCTION_ENABLED", "true")
    assert client.get("/v1/capabilities", headers=headers()).status_code == 200
    monkeypatch.delenv("INDEMNIFICATION_API_TOKEN")
    assert client.get("/v1/capabilities", headers=headers()).status_code == 503


def test_the_correlation_id_must_be_a_uuid(client):
    r = client.get("/v1/capabilities", headers={**headers(), "X-Correlation-ID": "not-a-uuid"})
    assert r.status_code == 400


def test_capabilities_describe_the_service(client):
    manifest = client.get("/v1/capabilities", headers=headers()).json()
    assert manifest["port"] == 8018 and manifest["database_access"] is False
    assert manifest["market_data_access"] is False and manifest["model_version"]


def test_a_valid_run_returns_the_validated_result_and_a_run_record(client, snapshot, validator_for):
    correlation = str(uuid.uuid4())
    payload = body(snapshot)
    r = client.post("/v1/runs", json=payload, headers=headers(correlation=correlation))
    assert r.status_code == 200, r.text
    response = r.json()
    assert errors(validator_for("run-response-1.0.schema.json"), response) == []
    run = response["run"]
    assert response["correlation_id"] == correlation and run["status"] == "complete"
    assert run["snapshot_hash"] == snapshot["snapshot_hash"]
    assert (
        run["request_hash"] == canonical_hash(payload) and run["run_id"] == run["request_hash"][:32]
    )
    assert response["result"]["run_id"] == run["run_id"]
    assert response["result"]["program"]["gaussian"]["with_wrong_way"]["total"]["el"]["value"] >= 0


def test_options_choose_the_sweeps_and_stresses(client, snapshot):
    quick = client.post("/v1/runs", json=body(snapshot), headers=headers()).json()["result"]
    assert quick["sensitivities"] == [] and quick["stresses"] == []
    full = client.post(
        "/v1/runs", json=body(snapshot, sensitivity_paths=1000, stresses=True), headers=headers()
    ).json()["result"]
    assert len(full["sensitivities"]) == 4 and len(full["stresses"]) == 5
    assert full["program"] == quick["program"]  # the run itself is the same


def test_a_run_can_be_fetched_again_and_an_unknown_one_is_a_clean_404(
    client, snapshot, validator_for
):
    run_id = client.post("/v1/runs", json=body(snapshot), headers=headers()).json()["run"]["run_id"]
    again = client.get(f"/v1/runs/{run_id}", headers=headers())
    assert again.status_code == 200 and again.json()["run"]["run_id"] == run_id
    missing = client.get(f"/v1/runs/{'0' * 32}", headers=headers())
    assert missing.status_code == 404 and missing.json()["code"] == "RUN_NOT_FOUND"
    assert errors(validator_for("error-1.0.schema.json"), missing.json()) == []


def test_the_same_idempotency_key_returns_the_same_run_and_a_different_request_conflicts(
    client, snapshot
):
    key = {"Idempotency-Key": "abc-123"}
    first = client.post("/v1/runs", json=body(snapshot), headers={**headers(), **key})
    second = client.post("/v1/runs", json=body(snapshot), headers={**headers(), **key})
    assert first.status_code == second.status_code == 200 and first.json() == second.json()
    other = client.post(
        "/v1/runs", json=body(snapshot, stresses=True), headers={**headers(), **key}
    )
    assert other.status_code == 409 and other.json()["code"] == "IDEMPOTENCY_CONFLICT"


def test_a_request_that_breaks_the_schema_is_rejected_with_the_failing_paths(
    client, snapshot, validator_for
):
    bad = copy.deepcopy(snapshot)
    bad["run"]["paths"] = 5
    r = client.post("/v1/runs", json=body(bad), headers=headers())
    assert r.status_code == 422 and r.json()["code"] == "REQUEST_CONTRACT_INVALID"
    assert any("paths" in issue for issue in r.json()["issues"])
    assert errors(validator_for("error-1.0.schema.json"), r.json()) == []
    assert (
        client.post("/v1/runs", json={"snapshot": snapshot}, headers=headers()).status_code == 422
    )
    assert client.post("/v1/runs", content=b"{not json", headers=headers()).status_code == 422
    small = body(snapshot, sensitivity_paths=500)
    assert client.post("/v1/runs", json=small, headers=headers()).status_code == 422


def test_a_snapshot_that_is_inconsistent_or_tampered_with_is_rejected(client, snapshot):
    inconsistent = copy.deepcopy(snapshot)
    inconsistent["model"]["rho_w"] = 0.9
    r = client.post("/v1/runs", json=body(seal(inconsistent)), headers=headers())
    assert r.status_code == 422 and r.json()["code"] == "SNAPSHOT_INVALID"
    assert any("rho_w" in issue for issue in r.json()["issues"])
    tampered = copy.deepcopy(snapshot)
    tampered["loans"][0]["quantity"] += 1  # hash no longer matches
    r = client.post("/v1/runs", json=body(tampered), headers=headers())
    assert r.status_code == 422 and any("snapshot_hash" in i for i in r.json()["issues"])


def test_a_run_that_would_not_fit_in_memory_is_refused_clearly(client, snapshot):
    huge = copy.deepcopy(snapshot)
    huge["run"] = {
        **huge["run"],
        "mode": "annual",
        "paths": 500_000,
        "horizon_days": 1260,
        "step": "daily",
    }
    r = client.post("/v1/runs", json=body(seal(huge)), headers=headers())
    assert r.status_code == 422 and r.json()["code"] == "RUN_TOO_LARGE"
    assert r.json()["category"] == "capacity"


def test_a_second_run_while_one_is_in_progress_is_told_to_wait(client, snapshot, monkeypatch):
    class Busy:
        def locked(self):
            return True

    monkeypatch.setattr(app_module, "_run_lock", Busy())
    r = client.post("/v1/runs", json=body(snapshot), headers=headers())
    assert r.status_code == 429 and r.json()["code"] == "SERVICE_BUSY"


def test_an_oversized_body_is_refused_before_it_is_read(client, snapshot):
    r = client.post("/v1/runs", content=b"x" * (app_module.MAX_BODY_BYTES + 1), headers=headers())
    assert r.status_code == 413 and r.json()["code"] == "BODY_TOO_LARGE"


def test_a_model_failure_is_reported_without_leaking_its_details(client, snapshot, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("secret internal detail: Alderwood")

    monkeypatch.setattr(app_module, "run_analysis", boom)
    r = client.post("/v1/runs", json=body(snapshot), headers=headers())
    assert r.status_code == 500 and r.json()["code"] == "MODEL_ERROR"
    assert "secret" not in r.text and "Alderwood" not in r.text


def test_only_the_most_recent_runs_are_kept(client, snapshot, monkeypatch):
    monkeypatch.setattr(app_module, "HISTORY_SIZE", 2)
    ids = []
    for seed in (1, 2, 3):
        varied = copy.deepcopy(snapshot)
        varied["run"]["seed"] = seed
        ids.append(
            client.post("/v1/runs", json=body(seal(varied)), headers=headers()).json()["run"][
                "run_id"
            ]
        )
    assert client.get(f"/v1/runs/{ids[0]}", headers=headers()).status_code == 404
    assert client.get(f"/v1/runs/{ids[2]}", headers=headers()).status_code == 200


def test_logs_carry_ids_and_hashes_but_never_book_data(client, snapshot, caplog):
    correlation = str(uuid.uuid4())
    with caplog.at_level(logging.INFO, logger="indemnification_api"):
        client.post("/v1/runs", json=body(snapshot), headers=headers(correlation=correlation))
    records = [r for r in caplog.records if r.name == "indemnification_api"]
    complete = next(r for r in records if r.getMessage().startswith("run_complete"))
    assert f"correlation_id={correlation}" in complete.getMessage()
    assert (
        complete.correlation_id == correlation
        and complete.snapshot_hash == snapshot["snapshot_hash"]
    )
    text = " ".join(str(r.__dict__) for r in records)
    for secret in ("Alderwood", "Harrowgate", "Summitline", "L1", "B1"):
        assert secret not in text, secret
