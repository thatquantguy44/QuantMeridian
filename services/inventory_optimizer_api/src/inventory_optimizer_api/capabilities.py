from __future__ import annotations

import json
import os
from importlib import metadata
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from . import engine_source
from .field_registry import MAX_UPLOAD_BYTES, ROW_LIMITS

# A built wheel carries the manifest inside the package (see pyproject.toml force-include); an
# editable install or source run reads it from the service root.
_PACKAGED_MANIFEST = Path(__file__).resolve().parent / "capability-manifest.json"
MANIFEST_PATH = (
    _PACKAGED_MANIFEST
    if _PACKAGED_MANIFEST.is_file()
    else Path(__file__).resolve().parents[2] / "capability-manifest.json"
)
ENGINE_DISTRIBUTION = "inventory-optimizer"


def manifest() -> dict[str, Any]:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def _direct_url() -> dict[str, Any] | None:
    """pip's PEP 610 record of where the engine distribution was installed from, if any."""
    try:
        raw = metadata.distribution(ENGINE_DISTRIBUTION).read_text("direct_url.json")
        return json.loads(raw) if raw else None
    except (metadata.PackageNotFoundError, json.JSONDecodeError):
        return None


def _file_url_path(url: str) -> Path | None:
    parsed = urlparse(url)
    return Path(unquote(parsed.path)) if parsed.scheme == "file" else None


def _engine_source() -> str:
    """How the imported engine was supplied: path (INVENTORY_OPTIMIZER_ENGINE_PATH), vcs (pip
    from a git URL), editable or local (pip from a local directory), archive (pip from a wheel
    or sdist file), index (pip from a package index), or missing."""
    if engine_source.configured_engine_root() is not None:
        return "path"
    if _installed_version(ENGINE_DISTRIBUTION) is None:
        return "missing"
    direct_url = _direct_url()
    if direct_url is None:
        return "index"
    if "vcs_info" in direct_url:
        return "vcs"
    if "dir_info" in direct_url:
        return "editable" if direct_url["dir_info"].get("editable") else "local"
    return "archive"


def _installed_commit() -> str | None:
    override = os.getenv("INVENTORY_OPTIMIZER_ENGINE_COMMIT")
    if override:
        return override
    root = engine_source.configured_engine_root()
    if root is not None:
        return engine_source.git_head_commit(root)
    direct_url = _direct_url()
    if direct_url is None:
        return None
    if "vcs_info" in direct_url:
        return direct_url["vcs_info"].get("commit_id")
    if direct_url.get("dir_info", {}).get("editable"):
        # An editable install runs the directory's live code, so its checkout HEAD applies. A
        # non-editable local install copied the files, so the directory may have moved on.
        path = _file_url_path(direct_url.get("url", ""))
        return engine_source.git_head_commit(path) if path is not None else None
    return None


def _engine_version() -> str | None:
    root = engine_source.configured_engine_root()
    if root is not None:
        return engine_source.checkout_version(root)
    return _installed_version(ENGINE_DISTRIBUTION)


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
    source = _engine_source()
    package_version = _engine_version()
    installed_commit = _installed_commit()
    root = engine_source.configured_engine_root()
    package_dir = engine_source.engine_package_dir()
    fingerprint = engine_source.source_fingerprint(package_dir) if package_dir else None
    highspy_version = _installed_version("highspy")
    scipy_version = _installed_version("scipy")

    # The fingerprint is the identity check, so any install source works. A commit, when one
    # is known (git install, local checkout, or the override), must still agree.
    mismatches: list[str] = []
    if package_dir is None:
        mismatches.append("engine_not_importable")
    elif root is not None and not package_dir.is_relative_to(root):
        mismatches.append("engine_path_not_used")
    if package_version != expected["engine_package_version"]:
        mismatches.append("version")
    if package_dir is not None and fingerprint != expected["engine_fingerprint"]:
        mismatches.append("fingerprint")
    if installed_commit is not None and installed_commit != expected["engine_commit"]:
        mismatches.append("commit")
    package_compatible = not mismatches
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
        "engine_source": source,
        "package_version": package_version,
        "installed_commit": installed_commit,
        "engine_fingerprint": fingerprint,
        "engine_mismatches": mismatches,
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
        "engine_fingerprint": expected["engine_fingerprint"],
        "engine_source": identity["engine_source"],
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
        "input_features": dict(expected["input_features"]),
        "output_sections": list(expected["output_sections"]),
        "upload_formats": expected["upload_formats"],
        "limits": {
            "upload_bytes": MAX_UPLOAD_BYTES,
            "inventory_rows": ROW_LIMITS["inventory"],
            "route_rows": ROW_LIMITS["routes"],
            "demand_rows": ROW_LIMITS["demand"],
            "optional_rows": min(
                ROW_LIMITS["counterparty_limits"],
                ROW_LIMITS["utilization_policies"],
                ROW_LIMITS["entity_relationships"],
            ),
            "solve_timeout_seconds": 60,
            "concurrent_solves": 2,
            "scenario_stress_batch": 10,
            "scenario_stress_timeout_seconds": 300,
        },
    }


def require_compatible_engine() -> None:
    identity = engine_identity()
    if not identity["package_compatible"]:
        raise RuntimeError(
            "installed InventoryBallast identity does not match capability-manifest.json: "
            f"mismatches={identity['engine_mismatches']!r}, "
            f"source={identity['engine_source']!r}, "
            f"version={identity['package_version']!r}, commit={identity['installed_commit']!r}, "
            f"fingerprint={identity['engine_fingerprint']!r}, "
            f"expected_version={manifest()['engine_package_version']!r}, "
            f"expected_commit={manifest()['engine_commit']!r}, "
            f"expected_fingerprint={manifest()['engine_fingerprint']!r}"
        )
    if identity["active_backend"] is None:
        raise RuntimeError(
            "no supported optimizer solver backend is installed: install scipy for LP/MIP "
            "or the optional highspy extra for LP/MIP/QP"
        )
