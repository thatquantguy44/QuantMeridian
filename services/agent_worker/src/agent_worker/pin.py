"""Content fingerprints for a locally supplied QuantSmith copy (spec009, T-001).

Standard library only, so it runs before anything is installed:

    python3 -I services/agent_worker/src/agent_worker/pin.py --root ../QuantSmith
    python3 -I services/agent_worker/src/agent_worker/pin.py --installed
    python3 -I services/agent_worker/src/agent_worker/pin.py --root ../QuantSmith --check

Two digests identify what the worker would actually run and read:

- code digest: SHA-256 over the sorted lines ``"<path>\\t<sha256 of the file's bytes>\\n"`` for
  every ``*.py`` file under the ``quantsmith`` package directory, relative to that directory,
  excluding ``__pycache__``. A checkout and a wheel built from it give the same value because
  both contain the same ``.py`` files.
- assets digest: the same construction over every file under the asset paths listed in
  ``contracts/agent/quantsmith-pin.json``, relative to the assets root; ``absent`` when there is
  no assets root.

Nothing here imports QuantSmith or touches the network. File bytes are hashed as they are on
disk (no newline normalization), so a copy checked out with different line endings fingerprints
differently and is reported as drift rather than assumed equivalent.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from importlib import metadata
from importlib.util import find_spec
from pathlib import Path
from typing import Any

PACKAGE = "quantsmith"
DIGEST_PREFIX = "sha256:"
ABSENT = "absent"
PIN_SCHEMA_VERSION = "quantsmith-pin/1"
ROOT_ENV = "QUANTSMITH_ROOT"
ASSETS_ROOT_ENV = "QUANTSMITH_ASSETS_ROOT"
_SKIPPED_PARTS = frozenset({"__pycache__", ".git"})
_SKIPPED_NAMES = frozenset({".DS_Store"})


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _combine(entries: dict[str, str]) -> str:
    lines = "".join(f"{relative}\t{digest}\n" for relative, digest in sorted(entries.items()))
    return DIGEST_PREFIX + hashlib.sha256(lines.encode("utf-8")).hexdigest()


def _is_skipped(path: Path) -> bool:
    return path.name in _SKIPPED_NAMES or bool(_SKIPPED_PARTS.intersection(path.parts))


def code_digest(package_dir: Path) -> str:
    """Digest of every ``*.py`` file in the ``quantsmith`` package tree."""
    package_dir = package_dir.resolve()
    entries = {
        path.relative_to(package_dir).as_posix(): _file_digest(path)
        for path in package_dir.rglob("*.py")
        if path.is_file() and not _is_skipped(path.relative_to(package_dir))
    }
    if not entries:
        raise ValueError(f"no Python files under {package_dir}")
    return _combine(entries)


def assets_digest(assets_root: Path | None, paths: list[str]) -> str:
    """Digest of every file under the listed asset paths; ``absent`` without an assets root.

    A listed path that does not exist is an error, not an absence: a partial tree must never
    fingerprint as though it were complete.
    """
    if assets_root is None:
        return ABSENT
    assets_root = assets_root.resolve()
    entries: dict[str, str] = {}
    for listed in paths:
        target = (assets_root / listed).resolve()
        if assets_root not in (target, *target.parents):
            raise ValueError(f"asset path escapes the assets root: {listed}")
        if target.is_file():
            files = [target]
        elif target.is_dir():
            files = [p for p in target.rglob("*") if p.is_file()]
        else:
            raise FileNotFoundError(f"asset path not found under {assets_root}: {listed}")
        for path in files:
            if not _is_skipped(path.relative_to(assets_root)):
                entries[path.relative_to(assets_root).as_posix()] = _file_digest(path)
    if not entries:
        raise ValueError("the listed asset paths contain no files")
    return _combine(entries)


def _pyproject_version(root: Path) -> str | None:
    try:
        text = (root / "pyproject.toml").read_text(encoding="utf-8")
    except OSError:
        return None
    in_project = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("["):
            in_project = stripped == "[project]"
        elif in_project:
            match = re.match(r'version\s*=\s*"([^"]+)"', stripped)
            if match:
                return match.group(1)
    return None


def find_copy(root: str | None, installed: bool) -> dict[str, Any]:
    """Locate the QuantSmith copy without importing it.

    ``root`` selects repository-path mode (package ``<root>/src/quantsmith``, assets ``<root>``).
    ``installed`` selects installed-package mode (the importable distribution; assets from
    ``QUANTSMITH_ASSETS_ROOT`` when set).
    """
    if root:
        repo = Path(root).expanduser().resolve()
        package_dir = repo / "src" / PACKAGE
        if not (package_dir / "__init__.py").is_file():
            raise FileNotFoundError(f"no {PACKAGE} package at {package_dir}")
        return {
            "mode": "path",
            "package_dir": package_dir,
            "assets_root": repo,
            "version": _pyproject_version(repo),
        }
    if installed:
        spec = find_spec(PACKAGE)
        if spec is None or not spec.origin:
            raise FileNotFoundError(f"{PACKAGE} is not installed")
        try:
            version: str | None = metadata.version(PACKAGE)
        except metadata.PackageNotFoundError:
            version = None
        assets = os.environ.get(ASSETS_ROOT_ENV, "").strip()
        return {
            "mode": "installed",
            "package_dir": Path(spec.origin).resolve().parent,
            "assets_root": Path(assets).expanduser().resolve() if assets else None,
            "version": version,
        }
    raise ValueError("choose --root PATH or --installed")


def read_pin(pin_path: Path) -> dict[str, Any]:
    pin = json.loads(pin_path.read_text(encoding="utf-8"))
    if pin.get("schema_version") != PIN_SCHEMA_VERSION:
        raise ValueError(f"unsupported pin schema_version: {pin.get('schema_version')!r}")
    return pin


def fingerprints(copy: dict[str, Any], asset_paths: list[str]) -> dict[str, Any]:
    return {
        "mode": copy["mode"],
        "version": copy["version"],
        "code_digest": code_digest(copy["package_dir"]),
        "assets_digest": assets_digest(copy["assets_root"], asset_paths),
    }


def compare(found: dict[str, Any], pin: dict[str, Any]) -> list[str]:
    """Mismatches between computed fingerprints and the pin. An absent assets digest is not a
    mismatch (it removes capabilities instead); a present one must equal the pin."""
    problems: list[str] = []
    if found["code_digest"] != pin["package"]["code_digest"]:
        problems.append("code")
    if found["assets_digest"] not in (ABSENT, pin["assets"]["digest"]):
        problems.append("assets")
    return problems


def _default_pin_path() -> Path:
    # <repo>/services/agent_worker/src/agent_worker/pin.py -> <repo>/contracts/agent/...
    return Path(__file__).resolve().parents[4] / "contracts" / "agent" / "quantsmith-pin.json"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fingerprint a local QuantSmith copy.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--root", help="QuantSmith repository checkout (repository-path mode)")
    source.add_argument("--installed", action="store_true", help="the installed package")
    parser.add_argument("--pin", type=Path, default=None, help="pin file (default: the repo's)")
    parser.add_argument(
        "--check", action="store_true", help="exit 1 when the fingerprints differ from the pin"
    )
    args = parser.parse_args(argv)

    pin_path = args.pin or _default_pin_path()
    try:
        pin = read_pin(pin_path)
        copy = find_copy(args.root, args.installed)
        found = fingerprints(copy, pin["assets"]["paths"])
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(f"pin: {error}", file=sys.stderr)
        return 2

    problems = compare(found, pin)
    print(json.dumps({**found, "pin": str(pin_path), "mismatches": problems}, indent=2))
    return 1 if (args.check and problems) else 0


if __name__ == "__main__":
    raise SystemExit(main())
