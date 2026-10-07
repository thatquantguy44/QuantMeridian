"""Validation of ``settings/agent_workflows.json`` and ``settings/llm_profiles.json``.

Mirrors ``src/lib/server/agent/config.ts`` and ``src/lib/server/llm/profileConfig.ts`` rule for
rule (spec009 REQ-005, REQ-019, REQ-029, NFR-005) and runs the same shared fixtures, so the
worker refuses exactly what the server refuses. Eligibility, context allowlists, known domains,
and forbidden header names come from ``contracts/agent/module-policy.json``, which both runtimes
read.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from functools import cache
from typing import Any

from .contracts import contracts_dir, repo_root, validate_contract

# --- secret-shaped values ---------------------------------------------------------------------

_SHAPES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("url", re.compile(r"[a-z][a-z0-9+.-]*://", re.I)),
    ("bearer_token", re.compile(r"\bbearer\s+[A-Za-z0-9._~+/=-]{8,}", re.I)),
    ("api_key_prefix", re.compile(r"\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}")),
    ("aws_access_key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("github_token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}")),
    ("slack_token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}")),
    ("google_api_key", re.compile(r"\bAIza[0-9A-Za-z_-]{30,}")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")),
    ("private_key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("hex_blob", re.compile(r"^[0-9a-f]{32,}$", re.I)),
    ("base64_blob", re.compile(r"^[A-Za-z0-9+/]{40,}={0,2}$")),
)


def secret_shape(value: str) -> str | None:
    for kind, pattern in _SHAPES:
        if pattern.search(value):
            return kind
    return None


def find_secret_shaped_values(doc: Any) -> list[tuple[str, str]]:
    """(path, kind) for every string value or object key that looks like a credential or URL."""
    found: list[tuple[str, str]] = []

    def walk(node: Any, path: str) -> None:
        if isinstance(node, str):
            if kind := secret_shape(node):
                found.append((path, kind))
        elif isinstance(node, list):
            for i, item in enumerate(node):
                walk(item, f"{path}/{i}")
        elif isinstance(node, dict):
            for key, value in node.items():
                if kind := secret_shape(key):
                    found.append((f"{path}/{key} (key)", kind))
                walk(value, f"{path}/{key}")

    walk(doc, "")
    return found


# --- shared policy ----------------------------------------------------------------------------


@dataclass(frozen=True)
class ModulePolicy:
    eligible_gold: frozenset[str]
    eligible_desk: frozenset[str]
    never_eligible: frozenset[str]
    context_fields: dict[str, frozenset[str]]
    known_domains: frozenset[str]
    forbidden_header_envs: frozenset[str]

    @property
    def eligible(self) -> frozenset[str]:
        return self.eligible_gold | self.eligible_desk


@cache
def module_policy() -> ModulePolicy:
    doc = json.loads((contracts_dir() / "module-policy.json").read_text(encoding="utf-8"))
    return ModulePolicy(
        eligible_gold=frozenset(doc["eligible_modules"]["gold"]),
        eligible_desk=frozenset(doc["eligible_modules"]["desk"]),
        never_eligible=frozenset(doc["never_eligible"]),
        context_fields={k: frozenset(v) for k, v in doc["context_field_allowlist"].items()},
        known_domains=frozenset(doc["known_domains"]),
        forbidden_header_envs=frozenset(doc["forbidden_header_envs"]),
    )


@dataclass(frozen=True)
class Problem:
    code: str
    path: str
    message: str


@dataclass(frozen=True)
class Validation:
    problems: tuple[Problem, ...] = field(default_factory=tuple)

    @property
    def ok(self) -> bool:
        return not self.problems

    @property
    def codes(self) -> list[str]:
        return [p.code for p in self.problems]


def _secret_problems(doc: Any, hint: str) -> list[Problem]:
    return [
        Problem("SECRET_SHAPED_VALUE", path, f"looks like a {kind.replace('_', ' ')}; {hint}")
        for path, kind in find_secret_shaped_values(doc)
    ]


# --- workflows --------------------------------------------------------------------------------


@dataclass(frozen=True)
class WorkflowConfigContext:
    module_codes: frozenset[str]
    desk_datasets: frozenset[str]
    profile_ids: frozenset[str] | None = None


def validate_workflows_config(doc: Any, ctx: WorkflowConfigContext) -> Validation:
    policy = module_policy()
    problems = _secret_problems(doc, "settings files hold no credentials or URLs")

    schema = validate_contract("workflows", doc)
    if not schema.ok:
        problems += [Problem("SCHEMA", i.path, i.message) for i in schema.issues]
        return Validation(tuple(problems))

    limits = doc["limits"]
    if limits["lease_seconds"] < limits["heartbeat_seconds"] * 2:
        problems.append(
            Problem(
                "LEASE_TOO_SHORT",
                "/limits/lease_seconds",
                "lease_seconds must be at least twice heartbeat_seconds",
            )
        )

    for wid, wf in doc["workflows"].items():
        at = f"/workflows/{wid}"
        if "copilot" in wf["uses"]:
            problems.append(
                Problem(
                    "WORKFLOW_USES_INVALID",
                    f"{at}/uses",
                    "copilot is a profile use, not a workflow use",
                )
            )
        if wf["llm"] == "none" and wf["uses"]:
            problems.append(
                Problem("WORKFLOW_LLM_MISMATCH", f"{at}/uses", 'llm "none" cannot list uses')
            )
        if wf["llm"] == "required" and not wf["uses"]:
            problems.append(
                Problem(
                    "WORKFLOW_LLM_MISMATCH", f"{at}/uses", 'llm "required" needs at least one use'
                )
            )

    for code, mod in doc["modules"].items():
        at = f"/modules/{code}"
        if code in policy.never_eligible or code not in policy.eligible:
            problems.append(
                Problem("MODULE_NOT_ELIGIBLE", at, f"{code} is not eligible for agent workflows")
            )
        if code not in ctx.module_codes:
            problems.append(
                Problem(
                    "MODULE_UNKNOWN", at, f"{code} is not a module in settings/modules.config.json"
                )
            )

        allowed = policy.context_fields.get(code, frozenset())
        for fld in mod["context_fields"]:
            if fld not in allowed:
                problems.append(
                    Problem(
                        "CONTEXT_FIELD_NOT_ALLOWED",
                        f"{at}/context_fields",
                        f'{code} may not snapshot "{fld}"',
                    )
                )
        for domain in mod["domains"]:
            if domain not in policy.known_domains:
                problems.append(
                    Problem("DOMAIN_UNKNOWN", f"{at}/domains", f'unknown domain pack "{domain}"')
                )

        datasets = mod.get("desk_datasets", [])
        for ds in datasets:
            if ds not in ctx.desk_datasets:
                problems.append(
                    Problem(
                        "DESK_DATASET_UNKNOWN",
                        f"{at}/desk_datasets",
                        f'"{ds}" is not a registered desk dataset',
                    )
                )
        if datasets and not any(
            "desk_simulated" in doc["workflows"][w]["data_classes"] for w in mod["workflows"]
        ):
            problems.append(
                Problem(
                    "DESK_DATA_CLASS_MISSING",
                    f"{at}/workflows",
                    "a module with desk datasets needs a workflow that allows desk_simulated",
                )
            )

        profile = mod.get("default_profile")
        if ctx.profile_ids is not None and profile is not None and profile not in ctx.profile_ids:
            problems.append(
                Problem("PROFILE_UNKNOWN", f"{at}/default_profile", f'no profile named "{profile}"')
            )

    return Validation(tuple(problems))


# --- profiles ---------------------------------------------------------------------------------

_MODEL_FREE_USES = frozenset({"interpreter", "narrator"})


def validate_profiles_config(doc: Any) -> Validation:
    policy = module_policy()
    problems = _secret_problems(doc, "reference secrets and endpoints through *_env fields only")

    schema = validate_contract("profiles", doc)
    if not schema.ok:
        problems += [Problem("SCHEMA", i.path, i.message) for i in schema.issues]
        return Validation(tuple(problems))

    profiles: dict[str, Any] = doc["profiles"]
    default = profiles.get(doc["default_profile"])
    if default is None:
        problems.append(
            Problem(
                "DEFAULT_PROFILE_UNKNOWN",
                "/default_profile",
                f'no profile named "{doc["default_profile"]}"',
            )
        )
    elif not default["enabled"]:
        problems.append(
            Problem(
                "DEFAULT_PROFILE_DISABLED",
                "/default_profile",
                f'default profile "{doc["default_profile"]}" is disabled',
            )
        )

    for pid, profile in profiles.items():
        at = f"/profiles/{pid}"
        if profile["api_style"] == "none":
            bad = [u for u in profile["uses"] if u not in _MODEL_FREE_USES]
            if bad:
                problems.append(
                    Problem(
                        "USES_NOT_SUPPORTED",
                        f"{at}/uses",
                        f"a profile with no LLM cannot serve: {', '.join(bad)}",
                    )
                )

        for header in profile.get("header_envs") or {}:
            if header.lower() in policy.forbidden_header_envs:
                problems.append(
                    Problem(
                        "FORBIDDEN_HEADER",
                        f"{at}/header_envs/{header}",
                        "credentials and framing headers are set through auth, not header_envs",
                    )
                )

        seen = {pid}
        nxt = profile.get("fallback_profile")
        while nxt:
            if nxt not in profiles:
                problems.append(
                    Problem(
                        "FALLBACK_UNKNOWN", f"{at}/fallback_profile", f'no profile named "{nxt}"'
                    )
                )
                break
            if nxt in seen:
                problems.append(
                    Problem(
                        "FALLBACK_CYCLE",
                        f"{at}/fallback_profile",
                        f'fallback chain loops through "{nxt}"',
                    )
                )
                break
            seen.add(nxt)
            nxt = profiles[nxt].get("fallback_profile")

    return Validation(tuple(problems))


# --- loading the shipped files ----------------------------------------------------------------


def load_json(relative: str) -> Any:
    return json.loads((repo_root() / relative).read_text(encoding="utf-8"))


def default_context(desk_datasets: Iterable[str]) -> WorkflowConfigContext:
    return WorkflowConfigContext(
        module_codes=frozenset(load_json("settings/modules.config.json")["modules"]),
        desk_datasets=frozenset(desk_datasets),
        profile_ids=frozenset(load_json("settings/llm_profiles.json")["profiles"]),
    )
