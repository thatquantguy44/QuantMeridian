"""Snapshot validation before any simulation (spec020 IND-001, AC-013).

A snapshot is rejected, with every problem named, when it breaks the JSON Schema, the cross-field
rules in ``validation.snapshot_issues``, or its own ``snapshot_hash``. Nothing is repaired or
defaulted.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from .contracts import snapshot_hash
from .validation import snapshot_issues

_SCHEMA_FILES = (
    "closeout-profile-1.0.schema.json",
    "rating-pd-table-1.0.schema.json",
    "model-card-1.0.schema.json",
    "snapshot-1.0.schema.json",
    "result-1.0.schema.json",
)


class SnapshotRejected(ValueError):
    def __init__(self, issues: list[str]):
        super().__init__("; ".join(issues))
        self.issues = issues


def contracts_dir() -> Path:
    """``INDEM_CONTRACTS_DIR`` if set, else the repository's contracts/indemnification directory."""
    configured = os.environ.get("INDEM_CONTRACTS_DIR")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[4] / "contracts" / "indemnification"


@lru_cache(maxsize=1)
def _validators() -> dict[str, Draft202012Validator]:
    root = contracts_dir()
    schemas = {name: json.loads((root / name).read_text("utf-8")) for name in _SCHEMA_FILES}
    registry = Registry().with_resources(
        (schema["$id"], Resource.from_contents(schema)) for schema in schemas.values()
    )
    return {
        name: Draft202012Validator(schema, registry=registry) for name, schema in schemas.items()
    }


def validator(schema_file: str) -> Draft202012Validator:
    return _validators()[schema_file]


def validate_snapshot(snapshot: dict[str, Any]) -> list[str]:
    issues = [
        f"{'/'.join(str(p) for p in error.absolute_path) or '<root>'}: {error.message}"
        for error in validator("snapshot-1.0.schema.json").iter_errors(snapshot)
    ]
    if issues:
        return issues  # cross-field rules assume a well-formed snapshot
    issues.extend(snapshot_issues(snapshot))
    if snapshot_hash(snapshot) != snapshot["snapshot_hash"]:
        issues.append("snapshot_hash does not match the snapshot contents")
    return issues


def require_valid_snapshot(snapshot: dict[str, Any]) -> None:
    issues = validate_snapshot(snapshot)
    if issues:
        raise SnapshotRejected(issues)
