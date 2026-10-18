#!/usr/bin/env python3
"""Build a deterministic wheel only from the reviewed InventoryBallast source bytes.

The source path is a build input, never a runtime Git dependency. Production builds
use --require-git; the reviewed blob hashes also permit an exported test checkout.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import subprocess
import tomllib
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
SERVICE = ROOT / "services/collateral_optimizer_api"
MANIFEST = json.loads((SERVICE / "binding-manifest.json").read_text())


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def verify_source(source: Path, require_git: bool) -> None:
    expected = MANIFEST["source_files_sha256"]
    found = {str(p.relative_to(source)): digest(p.read_bytes()) for p in source.rglob("*")
             if p.is_file() and (p.suffix == ".py" or p.name in ("README.md", "pyproject.toml"))
             and "tests" not in p.parts}
    if found != expected:
        raise SystemExit("reviewed collateral package file digest mismatch")
    canonical = json.dumps(found, sort_keys=True, separators=(",", ":")).encode()
    if digest(canonical) != MANIFEST["source_digest_sha256"]:
        raise SystemExit("reviewed source digest mismatch")
    if require_git:
        repo = source.parents[1]
        sha = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
        dirty = subprocess.check_output(["git", "-C", str(repo), "status", "--porcelain", "--",
                                         MANIFEST["subdirectory"]], text=True).strip()
        if sha != MANIFEST["commit"] or dirty:
            raise SystemExit("source checkout is not the clean reviewed commit")


def build(source: Path, output: Path, require_git: bool) -> Path:
    verify_source(source, require_git)
    lock = SERVICE / "requirements.lock"
    if digest(lock.read_bytes()) != MANIFEST["dependency_lock_sha256"]:
        raise SystemExit("dependency lock drift")
    version = MANIFEST["package_version"]
    project = tomllib.loads((source / "pyproject.toml").read_text())["project"]
    if project["name"] != MANIFEST["distribution"] or project["version"] != version:
        raise SystemExit("upstream package name/version differs from reviewed manifest")
    if project.get("scripts", {}).get("collateral-optimizer") != "collateral_optimizer.cli:main":
        raise SystemExit("upstream entry point changed; builder review required")
    dist = f"collateral_optimizer-{version}.dist-info"
    wheel = output / f"collateral_optimizer-{version}-py3-none-any.whl"
    output.mkdir(parents=True, exist_ok=True)
    members = {str(p.relative_to(source / "src")): p.read_bytes()
               for p in (source / "src/collateral_optimizer").glob("*.py")}
    members[f"{dist}/WHEEL"] = b"Wheel-Version: 1.0\nGenerator: QuantMeridian reviewed-source builder 1\nRoot-Is-Purelib: true\nTag: py3-none-any\n"
    metadata_lines = ["Metadata-Version: 2.3", "Name: collateral-optimizer",
                      f"Version: {version}", f"Requires-Python: {project['requires-python']}"]
    metadata_lines.extend(f"Requires-Dist: {dep}" for dep in project["dependencies"])
    members[f"{dist}/METADATA"] = ("\n".join(metadata_lines) + "\n").encode()
    members[f"{dist}/entry_points.txt"] = b"[console_scripts]\ncollateral-optimizer = collateral_optimizer.cli:main\n"
    record = []
    for name, data in sorted(members.items()):
        hash64 = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
        record.append(f"{name},sha256={hash64},{len(data)}")
    record.append(f"{dist}/RECORD,,")
    members[f"{dist}/RECORD"] = ("\n".join(record) + "\n").encode()
    with ZipFile(wheel, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(members.items()):
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data, compress_type=ZIP_DEFLATED, compresslevel=9)
    wheel_hash = digest(wheel.read_bytes())
    if MANIFEST["wheel_sha256"] not in ("PENDING_BUILD", wheel_hash):
        raise SystemExit("built wheel digest differs from reviewed manifest")
    attestation = {key: MANIFEST[key] for key in (
        "repository", "subdirectory", "commit", "distribution", "package_version",
        "source_digest_sha256", "dependency_lock_sha256")}
    attestation["wheel_sha256"] = wheel_hash
    attestation["builder"] = "QuantMeridian reviewed-source builder 1"
    (output / "binding-attestation.json").write_text(json.dumps(attestation, indent=2) + "\n")
    print(json.dumps({"wheel": str(wheel), "wheel_sha256": wheel_hash,
                      "attestation": str(output / "binding-attestation.json")}))
    return wheel


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="projects/collateral_optimizer at the reviewed commit")
    parser.add_argument("--output", type=Path, default=Path("/tmp/collateral-wheel"))
    parser.add_argument("--require-git", action="store_true")
    args = parser.parse_args()
    build(args.source.resolve(), args.output.resolve(), args.require_git)
