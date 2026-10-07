"""Engine sourcing without GitHub: local checkout path, any pip source, fingerprint identity.

engine_identity() must accept the pinned engine whatever delivered it (git, index, wheel, local
directory, or a checkout named by INVENTORY_OPTIMIZER_ENGINE_PATH) and refuse anything whose
code differs from capability-manifest.json. Path-mode cases run in a subprocess because the
engine path is applied when inventory_optimizer_api is first imported, before the engine is.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from inventory_optimizer_api import capabilities, engine_source
from inventory_optimizer_api.capabilities import engine_identity, manifest

SRC_DIR = Path(__file__).resolve().parents[1] / "src"


def _installed_engine_dir() -> Path:
    package_dir = engine_source.engine_package_dir()
    assert package_dir is not None, "these tests need the pinned engine importable"
    return package_dir


def _make_checkout(root: Path, *, version: str = "0.1.0") -> Path:
    """A minimal InventoryBallast checkout (src layout) holding a copy of the pinned engine."""
    shutil.copytree(
        _installed_engine_dir(),
        root / "src" / "inventory_optimizer",
        ignore=shutil.ignore_patterns("__pycache__"),
    )
    (root / "pyproject.toml").write_text(
        f'[project]\nname = "inventory-optimizer"\nversion = "{version}"\n', encoding="utf-8"
    )
    return root


def _identity_in_subprocess(env_overrides: dict[str, str]) -> dict:
    env = {**os.environ, **env_overrides}
    env.pop("INVENTORY_OPTIMIZER_ENGINE_COMMIT", None)
    env["PYTHONPATH"] = os.pathsep.join(filter(None, [str(SRC_DIR), env.get("PYTHONPATH")]))
    script = (
        "import json; from inventory_optimizer_api.capabilities import engine_identity; "
        "from inventory_optimizer_api.engine_source import engine_package_dir; "
        "i = engine_identity(); i['imported_from'] = str(engine_package_dir()); "
        "print(json.dumps(i))"
    )
    out = subprocess.run(
        [sys.executable, "-c", script], env=env, capture_output=True, text=True, check=True
    )
    return json.loads(out.stdout)


# --- fingerprint --------------------------------------------------------------------------


def test_manifest_fingerprint_matches_the_engine_in_this_environment() -> None:
    assert (
        engine_source.source_fingerprint(_installed_engine_dir())
        == (manifest()["engine_fingerprint"])
    )


def test_fingerprint_ignores_caches_and_line_endings_but_not_content(tmp_path: Path) -> None:
    pkg = tmp_path / "pkg"
    (pkg / "sub").mkdir(parents=True)
    (pkg / "__init__.py").write_bytes(b"x = 1\n")
    (pkg / "sub" / "mod.py").write_bytes(b"y = 2\n")
    baseline = engine_source.source_fingerprint(pkg)

    (pkg / "__pycache__").mkdir()
    (pkg / "__pycache__" / "stale.py").write_bytes(b"ignored\n")
    (pkg / "notes.txt").write_text("not python", encoding="utf-8")
    (pkg / "sub" / "mod.py").write_bytes(b"y = 2\r\n")
    assert engine_source.source_fingerprint(pkg) == baseline

    (pkg / "sub" / "mod.py").write_bytes(b"y = 3\n")
    assert engine_source.source_fingerprint(pkg) != baseline

    (pkg / "sub" / "mod.py").write_bytes(b"y = 2\n")
    (pkg / "sub" / "mod.py").rename(pkg / "sub" / "renamed.py")
    assert engine_source.source_fingerprint(pkg) != baseline


# --- git HEAD without running git ---------------------------------------------------------


def test_git_head_commit_reads_detached_branch_packed_and_worktree_heads(tmp_path: Path) -> None:
    sha_a, sha_b, sha_c = "a" * 40, "b" * 40, "c" * 40
    repo = tmp_path / "repo"
    git = repo / ".git"
    (git / "refs" / "heads").mkdir(parents=True)

    (git / "HEAD").write_text(f"{sha_a}\n", encoding="utf-8")
    assert engine_source.git_head_commit(repo) == sha_a

    (git / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")
    (git / "refs" / "heads" / "main").write_text(f"{sha_b}\n", encoding="utf-8")
    assert engine_source.git_head_commit(repo) == sha_b

    (git / "refs" / "heads" / "main").unlink()
    (git / "packed-refs").write_text(
        f"# pack-refs with: peeled\n{sha_c} refs/heads/main\n", encoding="utf-8"
    )
    assert engine_source.git_head_commit(repo) == sha_c

    worktree = tmp_path / "worktree"
    worktree_git = git / "worktrees" / "wt"
    worktree_git.mkdir(parents=True)
    (worktree_git / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")
    (worktree_git / "commondir").write_text("../..\n", encoding="utf-8")
    worktree.mkdir()
    (worktree / ".git").write_text(f"gitdir: {worktree_git}\n", encoding="utf-8")
    assert engine_source.git_head_commit(worktree) == sha_c

    assert engine_source.git_head_commit(tmp_path / "not-a-repo") is None


# --- install source is reported, never trusted ---------------------------------------------


class _Dist:
    def __init__(self, direct_url: dict | None) -> None:
        self._direct_url = direct_url

    def read_text(self, name: str) -> str | None:
        assert name == "direct_url.json"
        return json.dumps(self._direct_url) if self._direct_url is not None else None


class _Metadata:
    """Stands in for capabilities.metadata with a chosen PEP 610 direct_url record."""

    import importlib.metadata as _real

    PackageNotFoundError = _real.PackageNotFoundError

    def __init__(self, direct_url: dict | None) -> None:
        self._direct_url = direct_url

    def version(self, name: str) -> str:
        if name == capabilities.ENGINE_DISTRIBUTION:
            return manifest()["engine_package_version"]
        return self._real.version(name)

    def distribution(self, name: str) -> _Dist:
        return _Dist(self._direct_url)


@pytest.mark.parametrize(
    ("direct_url", "source", "commit"),
    [
        (None, "index", None),
        (
            {
                "url": "file:///wheels/inventory_optimizer-0.1.0-py3-none-any.whl",
                "archive_info": {},
            },
            "archive",
            None,
        ),
        ({"url": "file:///src/InventoryBallast", "dir_info": {}}, "local", None),
        (
            {
                "url": "https://github.com/x/InventoryBallast.git",
                "vcs_info": {"vcs": "git", "commit_id": manifest()["engine_commit"]},
            },
            "vcs",
            manifest()["engine_commit"],
        ),
    ],
)
def test_every_pip_source_with_the_pinned_code_is_ready(
    monkeypatch: pytest.MonkeyPatch, direct_url: dict | None, source: str, commit: str | None
) -> None:
    monkeypatch.delenv("INVENTORY_OPTIMIZER_ENGINE_COMMIT", raising=False)
    monkeypatch.delenv(engine_source.ENGINE_PATH_ENV, raising=False)
    monkeypatch.setattr(capabilities, "metadata", _Metadata(direct_url))

    identity = engine_identity()

    assert identity["engine_source"] == source
    assert identity["installed_commit"] == commit
    assert identity["engine_mismatches"] == []
    assert identity["ready"] is True


def test_editable_install_reads_commit_from_the_checkout(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "HEAD").write_text("d" * 40, encoding="utf-8")
    monkeypatch.delenv("INVENTORY_OPTIMIZER_ENGINE_COMMIT", raising=False)
    monkeypatch.delenv(engine_source.ENGINE_PATH_ENV, raising=False)
    monkeypatch.setattr(
        capabilities,
        "metadata",
        _Metadata({"url": tmp_path.as_uri(), "dir_info": {"editable": True}}),
    )

    identity = engine_identity()

    assert identity["engine_source"] == "editable"
    assert identity["installed_commit"] == "d" * 40
    assert identity["engine_mismatches"] == ["commit"]
    assert identity["ready"] is False


def test_changed_engine_code_is_not_ready_even_with_matching_version_and_commit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("INVENTORY_OPTIMIZER_ENGINE_COMMIT", manifest()["engine_commit"])
    monkeypatch.setattr(engine_source, "source_fingerprint", lambda _: "0" * 64)

    identity = engine_identity()

    assert identity["engine_mismatches"] == ["fingerprint"]
    assert identity["package_compatible"] is False
    assert identity["ready"] is False


# --- INVENTORY_OPTIMIZER_ENGINE_PATH: a local checkout, no install --------------------------


def test_engine_path_checkout_is_imported_and_ready(tmp_path: Path) -> None:
    checkout = _make_checkout(tmp_path / "InventoryBallast")

    identity = _identity_in_subprocess({engine_source.ENGINE_PATH_ENV: str(checkout)})

    assert identity["imported_from"].startswith(str(checkout.resolve()))
    assert identity["engine_source"] == "path"
    assert identity["package_version"] == "0.1.0"
    assert identity["installed_commit"] is None  # not a git checkout: fingerprint decides
    assert identity["engine_mismatches"] == []
    assert identity["ready"] is True


def test_engine_path_checkout_with_edited_code_is_not_ready(tmp_path: Path) -> None:
    checkout = _make_checkout(tmp_path / "InventoryBallast")
    init = checkout / "src" / "inventory_optimizer" / "__init__.py"
    init.write_text(init.read_text(encoding="utf-8") + "\n# local edit\n", encoding="utf-8")

    identity = _identity_in_subprocess({engine_source.ENGINE_PATH_ENV: str(checkout)})

    assert identity["engine_mismatches"] == ["fingerprint"]
    assert identity["ready"] is False


def test_engine_path_with_wrong_version_is_not_ready(tmp_path: Path) -> None:
    checkout = _make_checkout(tmp_path / "InventoryBallast", version="0.2.0")

    identity = _identity_in_subprocess({engine_source.ENGINE_PATH_ENV: str(checkout)})

    assert identity["package_version"] == "0.2.0"
    assert identity["engine_mismatches"] == ["version"]
    assert identity["ready"] is False


def test_engine_path_without_an_engine_is_not_ready(tmp_path: Path) -> None:
    identity = _identity_in_subprocess({engine_source.ENGINE_PATH_ENV: str(tmp_path)})

    assert identity["engine_source"] == "path"
    assert identity["ready"] is False
    assert {"engine_not_importable", "engine_path_not_used"} & set(identity["engine_mismatches"])
