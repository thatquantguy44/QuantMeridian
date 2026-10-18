"""Fail-closed installed model and reviewed artifact identity checks."""

from __future__ import annotations

import hashlib
import json
import os
from importlib import metadata, resources
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[2]


def manifest() -> dict:
    return json.loads((SERVICE_ROOT / "binding-manifest.json").read_text())


def check_binding() -> tuple[str, str]:
    """Return readiness and a safe reason; never infer identity from a branch name."""
    expected = manifest()
    attestation_path = os.getenv("COLLATERAL_BINDING_ATTESTATION", "").strip()
    if not attestation_path:
        return "UNCONFIGURED", "Reviewed artifact attestation is not configured."
    try:
        attested = json.loads(Path(attestation_path).read_text())
        for key in ("repository", "subdirectory", "commit", "distribution", "package_version",
                    "source_digest_sha256", "dependency_lock_sha256", "wheel_sha256"):
            if attested.get(key) != expected[key]:
                return "INCOMPATIBLE", f"Artifact attestation mismatch: {key}."
        lock_hash = hashlib.sha256((SERVICE_ROOT / "requirements.lock").read_bytes()).hexdigest()
        if lock_hash != expected["dependency_lock_sha256"]:
            return "INCOMPATIBLE", "Dependency lock digest mismatch."
        if metadata.version("collateral-optimizer") != expected["package_version"]:
            return "INCOMPATIBLE", "Installed package version mismatch."
        package = resources.files("collateral_optimizer")
        for path, value in expected["source_files_sha256"].items():
            if not path.startswith("src/collateral_optimizer/"):
                continue
            installed = package.joinpath(path.rsplit("/", 1)[1]).read_bytes()
            if hashlib.sha256(installed).hexdigest() != value:
                return "INCOMPATIBLE", f"Installed model file digest mismatch: {path}."
        from collateral_optimizer.domain import OptimizationResult, Snapshot
        if Snapshot.model_fields["schema_version"].default != expected["snapshot_schema_version"]:
            return "INCOMPATIBLE", "Snapshot schema mismatch."
        if OptimizationResult.model_fields["result_version"].default != expected["result_schema_version"]:
            return "INCOMPATIBLE", "Result schema mismatch."
    except (OSError, ValueError, KeyError, ImportError, metadata.PackageNotFoundError):
        return "INCOMPATIBLE", "Installed model or attestation cannot be verified."
    return "READY", "Reviewed model artifact matches the exact pin."
