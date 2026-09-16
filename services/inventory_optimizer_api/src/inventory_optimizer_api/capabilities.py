from __future__ import annotations

import json
import os
from importlib import metadata
from pathlib import Path
from typing import Any

MANIFEST_PATH = Path(__file__).resolve().parents[2] / "capability-manifest.json"


def manifest() -> dict[str, Any]:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def _installed_commit() -> str | None:
    override = os.getenv("INVENTORY_OPTIMIZER_ENGINE_COMMIT")
    if override:
        return override
    try:
        dist = metadata.distribution("inventory-optimizer")
        direct_url = dist.read_text("direct_url.json")
        if not direct_url:
            return None
        payload = json.loads(direct_url)
        return payload.get("vcs_info", {}).get("commit_id")
    except (metadata.PackageNotFoundError, json.JSONDecodeError):
        return None


def engine_identity() -> dict[str, Any]:
    expected = manifest()
    try:
        package_version = metadata.version("inventory-optimizer")
    except metadata.PackageNotFoundError:
        package_version = None
    installed_commit = _installed_commit()
    try:
        backend_version = metadata.version("highspy")
    except metadata.PackageNotFoundError:
        backend_version = None
    ready = (
        package_version == expected["engine_package_version"]
        and installed_commit == expected["engine_commit"]
        and backend_version is not None
    )
    return {
        "package_version": package_version,
        "installed_commit": installed_commit,
        "backend_version": backend_version,
        "ready": ready,
    }


def capability_payload() -> dict[str, Any]:
    expected = manifest()
    identity = engine_identity()
    return {
        "api_schema_version": expected["api_schema_version"],
        "template_schema_version": expected["template_schema_version"],
        "generator_version": expected["generator_version"],
        "engine_package_version": expected["engine_package_version"],
        "engine_commit": expected["engine_commit"],
        "engine_compatible": identity["ready"],
        "backend": {
            "name": "highs",
            "version": identity["backend_version"],
            "ready": identity["backend_version"] is not None,
        },
        "problem_families": expected["problem_families"],
        "formulations": expected["formulations"],
        "input_features": {
            "entity_scoped_limits": True,
            "all_or_none_routes": True,
            "minimum_active_quantity": True,
            "lot_sizes": True,
            "maximum_active_routes": True,
            "allocation_stability_penalty": True,
            "fee_tier_authoring": False,
            "expected_economics": False,
            "dynamic_buffers": False,
            "multi_period": False,
            "scenarios": False,
        },
        "output_sections": [
            "allocations",
            "balances",
            "economics",
            "demand",
            "pricing",
            "constraints",
            "solver",
            "verification",
            "warnings",
        ],
        "upload_formats": expected["upload_formats"],
        "limits": {
            "upload_bytes": 10 * 1024 * 1024,
            "inventory_rows": 500,
            "route_rows": 10_000,
            "demand_rows": 5_000,
            "optional_rows": 5_000,
            "solve_timeout_seconds": 60,
            "concurrent_solves": 2,
        },
    }


def require_compatible_engine() -> None:
    identity = engine_identity()
    if not identity["ready"]:
        raise RuntimeError(
            "installed InventoryBallast identity does not match capability-manifest.json: "
            f"version={identity['package_version']!r}, commit={identity['installed_commit']!r}, "
            f"backend={identity['backend_version']!r}"
        )
