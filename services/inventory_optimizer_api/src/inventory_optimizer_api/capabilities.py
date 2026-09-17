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


def _installed_version(package_name: str) -> str | None:
    try:
        return metadata.version(package_name)
    except metadata.PackageNotFoundError:
        return None


def _backend_payload(
    *,
    name: str,
    version: str | None,
    formulations: tuple[str, ...],
    active: bool,
) -> dict[str, Any]:
    return {
        "name": name,
        "version": version,
        "installed": version is not None,
        "ready": version is not None,
        "active": active,
        "formulations": list(formulations) if version is not None else [],
    }


def engine_identity() -> dict[str, Any]:
    expected = manifest()
    package_version = _installed_version("inventory-optimizer")
    installed_commit = _installed_commit()
    highspy_version = _installed_version("highspy")
    scipy_version = _installed_version("scipy")
    package_compatible = (
        package_version == expected["engine_package_version"]
        and installed_commit == expected["engine_commit"]
    )
    active_backend = "highs" if highspy_version is not None else None
    if active_backend is None and scipy_version is not None:
        active_backend = "scipy_highs"
    formulations: tuple[str, ...]
    if highspy_version is not None:
        formulations = tuple(expected["formulations"])
    elif scipy_version is not None:
        formulations = tuple(item for item in expected["formulations"] if item in {"lp", "mip"})
    else:
        formulations = ()
    ready = package_compatible and active_backend is not None
    return {
        "package_version": package_version,
        "installed_commit": installed_commit,
        "package_compatible": package_compatible,
        "backend_version": highspy_version,
        "highspy_version": highspy_version,
        "scipy_version": scipy_version,
        "active_backend": active_backend,
        "formulations": list(formulations),
        "solver_backends": {
            "highs": _backend_payload(
                name="highs",
                version=highspy_version,
                formulations=tuple(expected["formulations"]),
                active=active_backend == "highs",
            ),
            "scipy_highs": _backend_payload(
                name="scipy_highs",
                version=scipy_version,
                formulations=tuple(
                    item for item in expected["formulations"] if item in {"lp", "mip"}
                ),
                active=active_backend == "scipy_highs",
            ),
        },
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
            "name": identity["active_backend"],
            "version": (
                identity["highspy_version"]
                if identity["active_backend"] == "highs"
                else identity["scipy_version"]
            ),
            "ready": identity["active_backend"] is not None,
        },
        "solver_backends": identity["solver_backends"],
        "problem_families": expected["problem_families"],
        "formulations": identity["formulations"],
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
    if not identity["package_compatible"]:
        raise RuntimeError(
            "installed InventoryBallast identity does not match capability-manifest.json: "
            f"version={identity['package_version']!r}, commit={identity['installed_commit']!r}, "
            f"expected_version={manifest()['engine_package_version']!r}, "
            f"expected_commit={manifest()['engine_commit']!r}"
        )
    if identity["active_backend"] is None:
        raise RuntimeError(
            "no supported optimizer solver backend is installed: install scipy for LP/MIP "
            "or the optional highspy extra for LP/MIP/QP"
        )
