"""Contract helpers and the shared fixtures (T-002). Mirrors src/lib/agent/contracts.test.ts."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from conftest import REPO_ROOT

from agent_worker import contracts
from agent_worker.contracts import (
    SCHEMA_FILES,
    SCHEMA_VERSIONS,
    check_schema_version,
    parse_schema_version,
    validate_contract,
)
from agent_worker.contracts_generated import job as job_models
from agent_worker.contracts_generated import quantsmith_pin as pin_models
from agent_worker.contracts_generated import result as result_models

CONTRACTS = REPO_ROOT / "contracts" / "agent"


def load(rel: str) -> dict:
    return json.loads((REPO_ROOT / rel).read_text(encoding="utf-8"))


def example_result() -> dict:
    return load("contracts/agent/fixtures/results/example-secfin-carry.json")


# --- schema files -----------------------------------------------------------------------------


@pytest.mark.parametrize(("kind", "file"), sorted(SCHEMA_FILES.items()))
def test_schema_declares_the_version_this_build_understands(kind: str, file: str) -> None:
    schema = json.loads((CONTRACTS / f"{file}.schema.json").read_text(encoding="utf-8"))
    assert schema["properties"]["schema_version"]["const"] == SCHEMA_VERSIONS[kind]
    assert "schema_version" in schema["required"]


def test_every_schema_file_is_registered() -> None:
    on_disk = {p.name.removesuffix(".schema.json") for p in CONTRACTS.glob("*.schema.json")}
    assert on_disk == set(SCHEMA_FILES.values())


def test_python_and_typescript_versions_agree() -> None:
    ts = (REPO_ROOT / "src" / "lib" / "agent" / "compat.ts").read_text(encoding="utf-8")
    for value in SCHEMA_VERSIONS.values():
        assert f'"{value}"' in ts


def test_repo_root_override(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("QM_REPO_ROOT", str(tmp_path))
    assert contracts.repo_root() == tmp_path.resolve()


# --- compatibility ----------------------------------------------------------------------------


def test_parse_schema_version() -> None:
    assert parse_schema_version("agent-result/1") == ("agent-result", 1)
    assert parse_schema_version("agent-result/1.2") is None
    assert parse_schema_version("agent-result") is None
    assert parse_schema_version(1) is None


def test_check_schema_version() -> None:
    assert check_schema_version({"schema_version": "agent-result/1"}, "result").ok
    assert check_schema_version({"schema_version": "agent-result/2"}, "result").reason == (
        "unknown_major"
    )
    assert check_schema_version({"schema_version": "agent-job/1"}, "result").reason == (
        "wrong_contract"
    )
    assert check_schema_version({"schema_version": "nonsense"}, "result").reason == "malformed"
    assert check_schema_version({}, "result").reason == "missing"
    assert check_schema_version(None, "result").reason == "missing"


def test_unknown_major_is_an_incompatibility_not_a_structural_error_pile() -> None:
    res = validate_contract("result", {"schema_version": "agent-result/2", "anything": True})
    assert not res.ok
    assert res.compatibility is not None and res.compatibility.reason == "unknown_major"
    assert len(res.issues) == 1


# --- shipped files and the shared example -----------------------------------------------------


def test_shipped_pin_validates_and_loads_into_its_model() -> None:
    doc = load("contracts/agent/quantsmith-pin.json")
    assert validate_contract("pin", doc).ok
    model = pin_models.QuantSmithPin.model_validate(doc)
    assert model.package.code_digest == doc["package"]["code_digest"]


def test_example_result_validates_and_loads_into_its_model() -> None:
    doc = example_result()
    assert validate_contract("result", doc).ok
    model = result_models.AgentResult.model_validate(doc)
    assert model.outcome.value == "answered"
    assert len(model.claims) == 7


def test_result_has_no_verdict_anywhere_a_worker_could_supply_one() -> None:
    for mutate in (
        lambda d: d.update(verdict="VERIFIED"),
        lambda d: d["claims"][2].update(verdict="VERIFIED"),
        lambda d: d["claims"][2].update(status="ok"),
    ):
        doc = example_result()
        mutate(doc)
        assert not validate_contract("result", doc).ok


def test_result_tolerates_unknown_additive_fields() -> None:
    doc = example_result()
    doc["future_field"] = {"anything": 1}
    doc["blocks"][0]["future_hint"] = "x"
    assert validate_contract("result", doc).ok


def test_result_rejects_unknown_kinds_blocks_and_bad_provenance() -> None:
    for mutate in (
        lambda d: d["claims"][2].update(kind="guess"),
        lambda d: d["claims"][2].update(provenance="SIM"),
        lambda d: d["blocks"].__setitem__(0, {"type": "script", "code": "alert(1)"}),
        lambda d: d["disclosure"].pop("registry_version"),
        lambda d: d["disclosure"]["quantsmith"].update(code_digest="deadbeef"),
    ):
        doc = example_result()
        mutate(doc)
        assert not validate_contract("result", doc).ok


# --- job --------------------------------------------------------------------------------------


@pytest.fixture
def job() -> dict:
    return {
        "schema_version": "agent-job/1",
        "module": "FUND",
        "thread_id": "5d0c7a2e-1111-4222-8333-444455556666",
        "workflow": "secfin.carry",
        "kind": None,
        "message": "",
        "inputs": {
            "side": "long",
            "notional": 100000000,
            "start": "2026-10-07",
            "end": "2026-11-06",
            "benchmark": "SOFR",
            "spread_bps": 25,
            "shocks_bps": [25],
        },
        "context": {"series": [{"source": "econ", "id": "SOFR"}], "range": "1Y"},
        "profile": None,
        "parent_job_id": None,
    }


def test_job_accepts_the_plan_request_and_loads_into_its_model(job: dict) -> None:
    assert validate_contract("job", job).ok
    assert job_models.AgentJobCreateRequest.model_validate(job).module == "FUND"


def test_job_end_xor_tenor(job: dict) -> None:
    both = copy.deepcopy(job)
    both["inputs"]["tenor"] = "1M"
    assert not validate_contract("job", both).ok
    neither = copy.deepcopy(job)
    del neither["inputs"]["end"]
    assert not validate_contract("job", neither).ok
    tenor = copy.deepcopy(neither)
    tenor["inputs"]["tenor"] = "1M"
    assert validate_contract("job", tenor).ok


def test_job_bounds_and_context_allowlist(job: dict) -> None:
    for mutate in (
        lambda d: d["inputs"].update(shocks_bps=[501]),
        lambda d: d["inputs"].update(notional=0),
        lambda d: d["context"].update(values=[1, 2, 3]),
        lambda d: d["context"].update(series=[{"source": "book", "id": "X"}]),
        lambda d: d.pop("workflow"),
        lambda d: d.update(workflow="chart.build", inputs=None, message="x" * 2001),
        lambda d: d.update(inputs=None, message=""),
    ):
        doc = copy.deepcopy(job)
        mutate(doc)
        assert not validate_contract("job", doc).ok


# --- profiles ---------------------------------------------------------------------------------

LIMITS = {
    "max_output_tokens": 1,
    "timeout_ms": 1000,
    "max_retries": 0,
    "per_job_token_cap": 1,
    "daily_token_budget": None,
}


def profiles(**profile: object) -> dict:
    base = {
        "enabled": True,
        "label": "P",
        "api_style": "anthropic_messages",
        "auth": {"scheme": "provider_default", "credential_env": "K"},
        "limits": LIMITS,
        "data_classes": ["public_market_data"],
        "uses": ["interpreter"],
    }
    return {
        "schema_version": "llm-profiles/1",
        "default_profile": "p",
        "profiles": {"p": {**base, **profile}},
    }


def test_enabled_api_profile_needs_a_model() -> None:
    assert not validate_contract("profiles", profiles()).ok
    assert validate_contract("profiles", profiles(model="m")).ok
    assert validate_contract("profiles", profiles(enabled=False)).ok


def test_style_none_forbids_api_fields() -> None:
    doc = profiles(api_style="none", model="m")
    assert not validate_contract("profiles", doc).ok


def test_no_field_can_hold_a_credential_or_url() -> None:
    doc = profiles(model="m", api_key="sk-live-abc", base_url="https://x.example")
    assert not validate_contract("profiles", doc).ok


@pytest.mark.parametrize(
    ("auth", "ok"),
    [
        ({"scheme": "bearer"}, False),
        ({"scheme": "header", "credential_env": "K"}, False),
        ({"scheme": "header", "credential_env": "K", "header_name": "api-key"}, True),
        ({"scheme": "none"}, True),
    ],
)
def test_auth_scheme_requirements(auth: dict, ok: bool) -> None:
    assert validate_contract("profiles", profiles(enabled=False, auth=auth)).ok is ok
