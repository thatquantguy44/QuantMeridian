"""Worker mirror of the settings validators (T-003). Mirrors config.test.ts / profileConfig.test.ts
and runs the same shared fixtures."""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path

import pytest
from conftest import REPO_ROOT

from agent_worker.registry import load_registry
from agent_worker.settings import (
    WorkflowConfigContext,
    default_context,
    find_secret_shaped_values,
    load_json,
    module_policy,
    secret_shape,
    validate_profiles_config,
    validate_workflows_config,
)

FIXTURES = json.loads(
    (REPO_ROOT / "contracts/agent/fixtures/settings/secret-shapes.json").read_text(encoding="utf-8")
)
FILL = {"x": "x", "a": "a", "A": "A", "n": "1"}


def expand(template: str) -> str:
    return re.sub(r"\{([xaAn])(\d+)\}", lambda m: FILL[m.group(1)] * int(m.group(2)), template)


@pytest.fixture(scope="module")
def ctx() -> WorkflowConfigContext:
    return default_context(load_registry().desk_datasets)


def shipped_workflows() -> dict:
    return load_json("settings/agent_workflows.json")


def shipped_profiles() -> dict:
    return load_json("settings/llm_profiles.json")


def wf_codes(doc: object, ctx: WorkflowConfigContext) -> list[str]:
    return validate_workflows_config(doc, ctx).codes


def pr_codes(doc: object) -> list[str]:
    return validate_profiles_config(doc).codes


# --- secret shapes (shared fixtures) ----------------------------------------------------------


@pytest.mark.parametrize("case", FIXTURES["reject"], ids=lambda c: c["kind"])
def test_rejects_secret_shaped_values(case: dict) -> None:
    assert secret_shape(expand(case["value"])) == case["kind"]


@pytest.mark.parametrize("value", FIXTURES["accept"])
def test_accepts_benign_values(value: str) -> None:
    assert secret_shape(expand(value)) is None


def test_reports_paths_for_values_and_keys() -> None:
    doc = {
        "profiles": {
            "p": {
                "label": "ok",
                "note": expand("sk-{x32}"),
                "nested": [{"url": "https://a.example"}],
            }
        },
        expand("ghp_{x24}"): 1,
    }
    paths = sorted(p for p, _ in find_secret_shaped_values(doc))
    assert paths == sorted(
        ["/profiles/p/nested/0/url", "/profiles/p/note", f"/{expand('ghp_{x24}')} (key)"]
    )


def test_shipped_settings_are_clean() -> None:
    assert find_secret_shaped_values(shipped_workflows()) == []
    assert find_secret_shaped_values(shipped_profiles()) == []


# --- policy is shared with the Node validator -------------------------------------------------


def test_policy_matches_the_node_module_policy_file() -> None:
    policy = module_policy()
    doc = load_json("contracts/agent/module-policy.json")
    assert policy.eligible == frozenset(
        doc["eligible_modules"]["gold"] + doc["eligible_modules"]["desk"]
    )
    assert not policy.eligible & policy.never_eligible
    assert policy.never_eligible == {"IBAL", "OPT", "DESK", "TASSIST", "AI"}


def test_eligible_modules_exist_and_were_audited() -> None:
    audit = (REPO_ROOT / "docs/gold-db/MODULE_DATA_AUDIT.md").read_text(encoding="utf-8")
    codes = set(load_json("settings/modules.config.json")["modules"])
    for code in module_policy().eligible:
        assert code in codes
        assert re.search(rf"^#### {code} — ", audit, re.M), f"{code} is not in the audit"
    assert module_policy().never_eligible <= codes


# --- workflows --------------------------------------------------------------------------------


def test_shipped_workflows_validate(ctx: WorkflowConfigContext) -> None:
    result = validate_workflows_config(shipped_workflows(), ctx)
    assert result.problems == ()


@pytest.mark.parametrize("code", ["IBAL", "OPT", "DESK", "TASSIST", "AI"])
def test_never_eligible_modules_are_rejected(code: str, ctx: WorkflowConfigContext) -> None:
    doc = shipped_workflows()
    doc["modules"][code] = {**copy.deepcopy(doc["modules"]["MGC"]), "enabled": True}
    assert "MODULE_NOT_ELIGIBLE" in wf_codes(doc, ctx)


def test_modules_outside_the_reviewed_set_or_unknown(ctx: WorkflowConfigContext) -> None:
    outside = shipped_workflows()
    outside["modules"]["HOME"] = {**copy.deepcopy(outside["modules"]["MGC"]), "context_fields": []}
    assert "MODULE_NOT_ELIGIBLE" in wf_codes(outside, ctx)
    unknown = shipped_workflows()
    unknown["modules"]["ZZZ"] = copy.deepcopy(unknown["modules"]["CURV"])
    assert {"MODULE_NOT_ELIGIBLE", "MODULE_UNKNOWN"} <= set(wf_codes(unknown, ctx))


def test_context_fields_are_allowlisted_per_module(ctx: WorkflowConfigContext) -> None:
    slab = shipped_workflows()
    slab["modules"]["SLAB"]["context_fields"] = ["series"]
    assert "CONTEXT_FIELD_NOT_ALLOWED" in wf_codes(slab, ctx)
    fund = shipped_workflows()
    fund["modules"]["FUND"]["context_fields"] = ["series", "range", "transform"]
    assert "CONTEXT_FIELD_NOT_ALLOWED" in wf_codes(fund, ctx)
    free = shipped_workflows()
    free["modules"]["MGC"]["context_fields"] = ["series", "rows"]
    assert "SCHEMA" in wf_codes(free, ctx)


def test_desk_datasets_and_domains(ctx: WorkflowConfigContext) -> None:
    unknown = shipped_workflows()
    unknown["modules"]["SLAB"]["desk_datasets"] = ["sl_inventory", "pb_clients"]
    assert "DESK_DATASET_UNKNOWN" in wf_codes(unknown, ctx)
    no_class = shipped_workflows()
    no_class["modules"]["SLAB"]["workflows"] = ["chart.build"]
    assert "DESK_DATA_CLASS_MISSING" in wf_codes(no_class, ctx)
    domain = shipped_workflows()
    domain["modules"]["MGC"]["domains"] = ["economics_macro", "made_up_pack"]
    assert "DOMAIN_UNKNOWN" in wf_codes(domain, ctx)


def test_default_profile_must_exist_only_when_profiles_are_supplied(
    ctx: WorkflowConfigContext,
) -> None:
    doc = shipped_workflows()
    doc["modules"]["MGC"]["default_profile"] = "nope"
    assert "PROFILE_UNKNOWN" in wf_codes(doc, ctx)
    without = WorkflowConfigContext(ctx.module_codes, ctx.desk_datasets, None)
    assert wf_codes(doc, without) == []


def test_workflow_rules(ctx: WorkflowConfigContext) -> None:
    none = shipped_workflows()
    none["workflows"]["story.build"]["uses"] = ["narrator"]
    assert "WORKFLOW_LLM_MISMATCH" in wf_codes(none, ctx)
    required = shipped_workflows()
    required["workflows"]["brief.draft"]["uses"] = []
    assert "WORKFLOW_LLM_MISMATCH" in wf_codes(required, ctx)
    copilot = shipped_workflows()
    copilot["workflows"]["chart.build"]["uses"] = ["copilot"]
    assert "WORKFLOW_USES_INVALID" in wf_codes(copilot, ctx)
    lease = shipped_workflows()
    lease["limits"]["lease_seconds"] = 20
    assert "LEASE_TOO_SHORT" in wf_codes(lease, ctx)
    caps = shipped_workflows()
    caps["limits"]["max_message_chars"] = 5000
    assert "SCHEMA" in wf_codes(caps, ctx)


def test_workflows_reject_secrets_and_incompatible_versions(ctx: WorkflowConfigContext) -> None:
    doc = shipped_workflows()
    doc["workflows"]["chart.build"]["note"] = expand("sk-{x32}")
    assert {"SECRET_SHAPED_VALUE", "SCHEMA"} <= set(wf_codes(doc, ctx))
    version = shipped_workflows()
    version["schema_version"] = "agent-workflows/2"
    assert wf_codes(version, ctx) == ["SCHEMA"]
    assert wf_codes(None, ctx) == ["SCHEMA"]


# --- profiles ---------------------------------------------------------------------------------


def test_shipped_profiles_validate_and_enable_only_the_documented_two() -> None:
    doc = shipped_profiles()
    assert validate_profiles_config(doc).problems == ()
    enabled = sorted(pid for pid, p in doc["profiles"].items() if p["enabled"])
    assert enabled == ["anthropic-direct", "deterministic"]


def test_profile_defaults_and_fallbacks() -> None:
    missing = shipped_profiles()
    missing["default_profile"] = "nope"
    assert "DEFAULT_PROFILE_UNKNOWN" in pr_codes(missing)
    disabled = shipped_profiles()
    disabled["default_profile"] = "openai-direct"
    assert "DEFAULT_PROFILE_DISABLED" in pr_codes(disabled)

    unknown = shipped_profiles()
    unknown["profiles"]["gateway-openai"]["fallback_profile"] = "nope"
    assert "FALLBACK_UNKNOWN" in pr_codes(unknown)
    loop = shipped_profiles()
    loop["profiles"]["gateway-openai"]["fallback_profile"] = "openai-direct"
    loop["profiles"]["openai-direct"]["fallback_profile"] = "gateway-openai"
    assert "FALLBACK_CYCLE" in pr_codes(loop)
    ok = shipped_profiles()
    ok["profiles"]["gateway-openai"]["fallback_profile"] = "deterministic"
    assert pr_codes(ok) == []


def test_profile_uses_headers_and_secrets() -> None:
    uses = shipped_profiles()
    uses["profiles"]["deterministic"]["uses"] = ["interpreter", "drafter"]
    assert "USES_NOT_SUPPORTED" in pr_codes(uses)

    headers = shipped_profiles()
    headers["profiles"]["gateway-openai"]["header_envs"] = {"Authorization": "MY_TOKEN_ENV"}
    assert "FORBIDDEN_HEADER" in pr_codes(headers)
    headers["profiles"]["gateway-openai"]["header_envs"] = {"X-Tenant": "GATEWAY_TENANT"}
    assert pr_codes(headers) == []

    url = shipped_profiles()
    url["profiles"]["gateway-openai"]["model"] = "https://gateway.example/v1"
    assert "SECRET_SHAPED_VALUE" in pr_codes(url)
    env = shipped_profiles()
    env["profiles"]["gateway-openai"]["base_url_env"] = "https://gateway.example/v1"
    assert "SECRET_SHAPED_VALUE" in pr_codes(env)

    version = shipped_profiles()
    version["schema_version"] = "llm-profiles/9"
    assert pr_codes(version) == ["SCHEMA"]


def test_anthropic_direct_matches_todays_copilot_request() -> None:
    copilot = (REPO_ROOT / "src/app/api/copilot/route.ts").read_text(encoding="utf-8")
    profile = shipped_profiles()["profiles"]["anthropic-direct"]
    assert f'model: "{profile["model"]}"' in copilot
    assert f"max_tokens: {profile['limits']['max_output_tokens']}" in copilot


def test_shipped_files_agree_on_cross_references(ctx: WorkflowConfigContext) -> None:
    profiles = set(shipped_profiles()["profiles"])
    for mod in shipped_workflows()["modules"].values():
        assert mod["default_profile"] is None or mod["default_profile"] in profiles
    assert isinstance(Path(REPO_ROOT), Path)
