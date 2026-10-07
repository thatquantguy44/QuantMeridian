"""Agent contract helpers: version compatibility and schema validation (spec009 T-002).

The JSON Schemas in ``contracts/agent/`` are the single source of truth. Pydantic models
generated from them live in :mod:`agent_worker.contracts_generated`; this module holds the
hand-written parts. The worker runs from the repository checkout and reads the schemas from
there (override the location with ``QM_REPO_ROOT``).
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any, Literal

from jsonschema import Draft7Validator

SCHEMA_VERSIONS: dict[str, str] = {
    "workflows": "agent-workflows/1",
    "profiles": "llm-profiles/1",
    "job": "agent-job/1",
    "result": "agent-result/1",
    "verification": "agent-verification/1",
    "registry": "metric-registry/1",
    "pin": "quantsmith-pin/1",
    "vectors": "formula-vectors/1",
}

SCHEMA_FILES: dict[str, str] = {
    "workflows": "agent-workflows",
    "profiles": "llm-profiles",
    "job": "job",
    "result": "result",
    "verification": "verification",
    "registry": "metric-registry",
    "pin": "quantsmith-pin",
    "vectors": "formula-vectors",
}

_VERSION = re.compile(r"^([a-z][a-z0-9-]*)/([0-9]+)$")


def repo_root() -> Path:
    override = os.environ.get("QM_REPO_ROOT", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    # <repo>/services/agent_worker/src/agent_worker/contracts.py
    return Path(__file__).resolve().parents[4]


def contracts_dir() -> Path:
    return repo_root() / "contracts" / "agent"


Reason = Literal["missing", "malformed", "wrong_contract", "unknown_major"]


@dataclass(frozen=True)
class Compatibility:
    ok: bool
    reason: Reason | None = None
    found: str | None = None


def parse_schema_version(value: Any) -> tuple[str, int] | None:
    if not isinstance(value, str):
        return None
    match = _VERSION.match(value)
    return (match.group(1), int(match.group(2))) if match else None


def check_schema_version(doc: Any, kind: str) -> Compatibility:
    """Is ``doc`` a payload of contract ``kind`` at the major version this build understands?"""
    expected = parse_schema_version(SCHEMA_VERSIONS[kind])
    assert expected is not None
    raw = doc.get("schema_version") if isinstance(doc, dict) else None
    if raw is None:
        return Compatibility(False, "missing", None)
    found = parse_schema_version(raw)
    if found is None:
        return Compatibility(False, "malformed", raw if isinstance(raw, str) else None)
    if found[0] != expected[0]:
        return Compatibility(False, "wrong_contract", str(raw))
    if found[1] != expected[1]:
        return Compatibility(False, "unknown_major", str(raw))
    return Compatibility(True)


@dataclass(frozen=True)
class ValidationIssue:
    path: str
    message: str


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    compatibility: Compatibility | None = None
    issues: tuple[ValidationIssue, ...] = ()


@cache
def _validator(kind: str) -> Draft7Validator:
    schema = json.loads((contracts_dir() / f"{SCHEMA_FILES[kind]}.schema.json").read_text("utf-8"))
    Draft7Validator.check_schema(schema)
    return Draft7Validator(schema)


def validate_contract(kind: str, doc: Any) -> ValidationResult:
    """Validate ``doc`` against contract ``kind``. An unsupported ``schema_version`` is reported
    as an incompatibility instead of a pile of structural errors."""
    compat = check_schema_version(doc, kind)
    if not compat.ok:
        return ValidationResult(
            False,
            compat,
            (ValidationIssue("/schema_version", f"incompatible schema_version ({compat.reason})"),),
        )
    errors = sorted(_validator(kind).iter_errors(doc), key=lambda e: list(e.absolute_path))
    if not errors:
        return ValidationResult(True)
    issues = tuple(
        ValidationIssue("/" + "/".join(str(p) for p in e.absolute_path), e.message) for e in errors
    )
    return ValidationResult(False, None, issues)
