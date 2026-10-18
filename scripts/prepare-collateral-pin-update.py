#!/usr/bin/env python3
"""Detect a changed merged-main package and prepare a reviewed pin PR, never a deploy."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICE = ROOT / "services/collateral_optimizer_api"
MANIFEST_PATH = SERVICE / "binding-manifest.json"
PACKAGE_PATH = "projects/collateral_optimizer"


def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def source_hashes(package: Path) -> dict[str, str]:
    return {str(p.relative_to(package)): sha(p.read_bytes())
            for p in sorted(package.rglob("*")) if p.is_file()
            and (p.suffix == ".py" or p.name in ("README.md", "pyproject.toml"))
            and "tests" not in p.parts}


def version_tuple(value: str) -> tuple[int, int, int] | None:
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", value)
    return tuple(map(int, match.groups())) if match else None


def schema_versions(domain_text: str) -> tuple[str | None, str | None]:
    snapshot = re.search(r'schema_version: Literal\["([^"]+)"\]', domain_text)
    result = re.search(r'result_version: Literal\["([^"]+)"\]', domain_text)
    return (snapshot.group(1) if snapshot else None, result.group(1) if result else None)


def replace_pin(path: Path, old: str, new: str) -> None:
    contents = path.read_text()
    if old not in contents:
        raise RuntimeError(f"expected prior pin missing from {path}")
    path.write_text(contents.replace(old, new))


def prepare(upstream: Path, summary_path: Path) -> dict:
    manifest = json.loads(MANIFEST_PATH.read_text())
    old = manifest["commit"]
    new = git(upstream, "rev-parse", "HEAD")
    main = git(upstream, "rev-parse", "origin/main")
    if new != main:
        raise RuntimeError("candidate checkout is not the merged origin/main head")
    subprocess.run(["git", "-C", str(upstream), "merge-base", "--is-ancestor", old, new], check=True)
    package = upstream / PACKAGE_PATH
    if not package.is_dir():
        raise RuntimeError("candidate standalone package is missing")
    changed = git(upstream, "diff", "--name-only", old, new, "--", PACKAGE_PATH)
    if not changed:
        outcome = {"changed": False, "old_sha": old, "new_sha": new}
        summary_path.write_text(json.dumps(outcome))
        return outcome

    old_pyproject = tomllib.loads(git(upstream, "show", f"{old}:{PACKAGE_PATH}/pyproject.toml"))
    new_pyproject = tomllib.loads((package / "pyproject.toml").read_text())
    old_version = old_pyproject["project"]["version"]
    new_version = new_pyproject["project"]["version"]
    old_domain = git(upstream, "show", f"{old}:{PACKAGE_PATH}/src/collateral_optimizer/domain.py")
    new_domain = (package / "src/collateral_optimizer/domain.py").read_text()
    old_schema = schema_versions(old_domain)
    new_schema = schema_versions(new_domain)
    blockers = []
    if not version_tuple(new_version) or not version_tuple(old_version) or version_tuple(new_version) <= version_tuple(old_version):
        blockers.append("Package changed without a monotonic three-part version bump.")
    if new_schema != old_schema or new_schema != (manifest["snapshot_schema_version"], manifest["result_schema_version"]):
        blockers.append("Native snapshot/result schema version changed; adapter and migration review required.")
    if new_pyproject["project"]["name"] != manifest["distribution"]:
        blockers.append("Distribution identity changed.")
    if new_pyproject["project"].get("scripts", {}).get("collateral-optimizer") != "collateral_optimizer.cli:main":
        blockers.append("Native entry point changed.")

    report_path = ROOT / "docs/specs/spec016/updates" / f"{new[:12]}.md"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    source_diff = git(upstream, "diff", old, new, "--",
                      f"{PACKAGE_PATH}/src/collateral_optimizer/domain.py",
                      f"{PACKAGE_PATH}/src/collateral_optimizer/verify.py",
                      f"{PACKAGE_PATH}/src/collateral_optimizer/demo.py")
    report = [
        "# InventoryBallast collateral pin update",
        "",
        f"- Upstream: https://github.com/{manifest['repository']}/compare/{old}...{new}",
        f"- Old/new full SHA: `{old}` → `{new}`",
        f"- Old/new distribution version: `{old_version}` → `{new_version}`",
        f"- Old/new native schema versions: `{old_schema}` → `{new_schema}`",
        f"- Old wheel digest: `{manifest['wheel_sha256']}`",
        f"- Old lock digest: `{manifest['dependency_lock_sha256']}`",
        f"- Promotion state: {'BLOCKED — human source/adapter review required' if blockers else 'DRAFT — tests and financial review required'}",
        "",
        "## Blockers", "",
        *(f"- {item}" for item in blockers),
        "",
        "## Changed package files", "", "~~~text", changed, "~~~", "",
        "## Native contract/verifier/demo diff", "", "~~~diff",
        source_diff[:50000] or "(no changes in these contract files)",
        "~~~", "",
        "## Test and staging evidence", "",
        "Pending candidate CI, financial fixture review, and five-scenario staging check.",
        "",
        "Rollback: revert this pin PR to the previous manifest/wheel/lock pair.",
        "Historical runs must retain their recorded model SHA and result payload when the spec015 registry exists.",
        "",
    ]
    if not blockers:
        hashes = source_hashes(package)
        manifest.update(commit=new, package_version=new_version,
                        source_files_sha256=hashes,
                        source_digest_sha256=sha(json.dumps(hashes, sort_keys=True,
                                                            separators=(",", ":")).encode()),
                        wheel_sha256="PENDING_BUILD")
        # Resolve only registry dependencies. The model itself is installed from
        # the reviewed wheel, never from an index or mutable Git reference.
        with tempfile.NamedTemporaryFile(mode="w", suffix=".in", delete=False) as input_file:
            input_file.write("\n".join(new_pyproject["project"]["dependencies"]) + "\n")
            input_file.write((SERVICE / "requirements.in").read_text())
            input_path = Path(input_file.name)
        try:
            subprocess.run(["uv", "pip", "compile", str(input_path), "--python-version", "3.12",
                            "--no-header", "--no-annotate", "--generate-hashes",
                            "--output-file", str(SERVICE / "requirements.lock")], check=True)
        finally:
            input_path.unlink(missing_ok=True)
        manifest["dependency_lock_sha256"] = sha((SERVICE / "requirements.lock").read_bytes())
        MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
        output_dir = Path(tempfile.gettempdir()) / f"collateral-update-{new[:12]}"
        output_dir.mkdir(exist_ok=True)
        builder = subprocess.check_output([
            sys.executable, str(ROOT / "scripts/build-collateral-wheel.py"),
            str(package), "--output", str(output_dir), "--require-git"], text=True)
        artifact = json.loads(builder)
        manifest["wheel_sha256"] = artifact["wheel_sha256"]
        MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
        replace_pin(SERVICE / "Dockerfile", old, new)
        replace_pin(SERVICE / "README.md", old, new)
        replace_pin(SERVICE / "pyproject.toml", f"collateral-optimizer=={old_version}",
                    f"collateral-optimizer=={new_version}")
        report.extend([
            f"- New source digest: `{manifest['source_digest_sha256']}`",
            f"- New wheel digest: `{manifest['wheel_sha256']}`",
            f"- New lock digest: `{manifest['dependency_lock_sha256']}`",
            "",
        ])
    report_path.write_text("\n".join(report))
    outcome = {"changed": True, "blocked": bool(blockers), "old_sha": old,
               "new_sha": new, "old_version": old_version, "new_version": new_version,
               "report": str(report_path.relative_to(ROOT)), "blockers": blockers}
    summary_path.write_text(json.dumps(outcome))
    return outcome


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("upstream", type=Path)
    parser.add_argument("--summary", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.upstream.resolve(), args.summary.resolve())))
