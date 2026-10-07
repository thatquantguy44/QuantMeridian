"""Locate the InventoryBallast engine and fingerprint the code that is actually imported.

The engine does not have to come from GitHub. Any of these works:

- a local checkout named by ``INVENTORY_OPTIMIZER_ENGINE_PATH`` (no install needed; the
  checkout's ``src/`` is put first on ``sys.path`` when this package is imported);
- a pip install from any source: a package index, a wheel file, a local directory
  (``pip install /path`` or ``pip install -e /path``), or the pinned git URL.

Readiness does not trust where the engine came from. ``source_fingerprint`` hashes the engine's
Python sources, and ``capabilities.engine_identity`` compares that hash with
``capability-manifest.json``, so every source that delivers the pinned code is accepted and
anything else is refused.
"""

from __future__ import annotations

import hashlib
import importlib.util
import os
import sys
import tomllib
from pathlib import Path

ENGINE_MODULE = "inventory_optimizer"
ENGINE_PATH_ENV = "INVENTORY_OPTIMIZER_ENGINE_PATH"


def configured_engine_root() -> Path | None:
    """The local checkout named by INVENTORY_OPTIMIZER_ENGINE_PATH, if set."""
    value = os.getenv(ENGINE_PATH_ENV, "").strip()
    return Path(value).expanduser().resolve() if value else None


def engine_import_dir(root: Path) -> Path | None:
    """The directory to put on sys.path for a checkout root (``src/`` layout) or a directory
    that holds the ``inventory_optimizer`` package directly."""
    for candidate in (root / "src", root):
        if (candidate / ENGINE_MODULE / "__init__.py").is_file():
            return candidate
    return None


def activate_engine_path() -> None:
    """Put a configured local checkout ahead of any pip-installed copy. An invalid path is
    left for engine_identity() to report as unready rather than failing the import."""
    root = configured_engine_root()
    import_dir = engine_import_dir(root) if root is not None else None
    if import_dir is None:
        return
    entry = str(import_dir)
    if entry in sys.path:
        sys.path.remove(entry)
    sys.path.insert(0, entry)


def require_importable_engine() -> None:
    """Fail service startup with setup instructions when no engine can be imported."""
    if engine_package_dir() is not None:
        return
    root = configured_engine_root()
    where = (
        f"{ENGINE_PATH_ENV}={root} does not contain src/{ENGINE_MODULE}/ or {ENGINE_MODULE}/"
        if root is not None
        else f"{ENGINE_PATH_ENV} is not set and no {ENGINE_MODULE} package is installed"
    )
    raise ModuleNotFoundError(
        f"InventoryBallast engine not found: {where}. Point {ENGINE_PATH_ENV} at a local "
        "InventoryBallast checkout, or pip install the engine from a local path, a wheel, "
        "your package index (inventory-optimizer==0.1.0), or the engine-github extra.",
        name=ENGINE_MODULE,
    )


def engine_package_dir() -> Path | None:
    """The directory of the ``inventory_optimizer`` package Python will import, found without
    importing it."""
    try:
        spec = importlib.util.find_spec(ENGINE_MODULE)
    except (ImportError, ValueError):
        return None
    if spec is None or not spec.origin:
        return None
    return Path(spec.origin).resolve().parent


def source_fingerprint(package_dir: Path) -> str:
    """sha256 over the package's ``.py`` files: sorted relative paths plus contents, with
    CRLF normalized so a Windows checkout of the same commit hashes identically."""
    digest = hashlib.sha256()
    files = {
        file.relative_to(package_dir).as_posix(): file
        for file in package_dir.rglob("*.py")
        if "__pycache__" not in file.parts
    }
    for relative, file in sorted(files.items()):
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(file.read_bytes().replace(b"\r\n", b"\n"))
        digest.update(b"\0")
    return digest.hexdigest()


def checkout_version(root: Path) -> str | None:
    """``[project].version`` from a checkout's pyproject.toml."""
    try:
        with (root / "pyproject.toml").open("rb") as handle:
            version = tomllib.load(handle).get("project", {}).get("version")
    except (OSError, tomllib.TOMLDecodeError):
        return None
    return version if isinstance(version, str) else None


def git_head_commit(root: Path) -> str | None:
    """The commit a git checkout has checked out, read from ``.git`` without running git."""
    git_dir = root / ".git"
    try:
        if git_dir.is_file():  # worktree or submodule: ".git" is a "gitdir: <path>" pointer
            pointer = git_dir.read_text(encoding="utf-8").strip()
            if not pointer.startswith("gitdir:"):
                return None
            git_dir = (root / pointer.removeprefix("gitdir:").strip()).resolve()
        head = (git_dir / "HEAD").read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not head.startswith("ref:"):
        return head or None
    ref = head.removeprefix("ref:").strip()
    common_dir = git_dir
    commondir_file = git_dir / "commondir"
    if commondir_file.is_file():
        common_dir = (git_dir / commondir_file.read_text(encoding="utf-8").strip()).resolve()
    for base in (git_dir, common_dir):
        ref_file = base / ref
        if ref_file.is_file():
            return ref_file.read_text(encoding="utf-8").strip() or None
    packed = common_dir / "packed-refs"
    if packed.is_file():
        for line in packed.read_text(encoding="utf-8").splitlines():
            parts = line.split()
            if len(parts) == 2 and parts[1] == ref:
                return parts[0]
    return None
