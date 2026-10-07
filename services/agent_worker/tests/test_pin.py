"""QuantSmith fingerprint tool (T-001): determinism, sensitivity, and the shipped pin."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import REPO_ROOT, quantsmith_root

from agent_worker import pin

PIN_PATH = REPO_ROOT / "contracts" / "agent" / "quantsmith-pin.json"


def _write(path: Path, content: bytes | str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content if isinstance(content, bytes) else content.encode("utf-8"))
    return path


@pytest.fixture
def package(tmp_path: Path) -> Path:
    root = tmp_path / "quantsmith"
    _write(root / "__init__.py", "x = 1\n")
    _write(root / "sub" / "mod.py", "y = 2\n")
    return root


# --- code digest ------------------------------------------------------------------------------


def test_code_digest_is_stable_and_prefixed(package: Path) -> None:
    first = pin.code_digest(package)
    assert first.startswith("sha256:") and len(first) == len("sha256:") + 64
    assert pin.code_digest(package) == first


def test_code_digest_ignores_caches_and_non_python_files(package: Path) -> None:
    baseline = pin.code_digest(package)
    _write(package / "__pycache__" / "mod.cpython-312.pyc", b"\x00\x01")
    _write(package / "sub" / "__pycache__" / "stale.py", "ignored = True\n")
    _write(package / "notes.txt", "not python")
    _write(package / ".DS_Store", b"junk")
    assert pin.code_digest(package) == baseline


def test_code_digest_changes_with_content_name_or_new_file(package: Path) -> None:
    baseline = pin.code_digest(package)
    mod = package / "sub" / "mod.py"

    mod.write_text("y = 3\n", encoding="utf-8")
    assert pin.code_digest(package) != baseline

    mod.write_text("y = 2\n", encoding="utf-8")
    assert pin.code_digest(package) == baseline

    mod.rename(package / "sub" / "renamed.py")
    assert pin.code_digest(package) != baseline

    (package / "sub" / "renamed.py").rename(mod)
    _write(package / "extra.py", "z = 4\n")
    assert pin.code_digest(package) != baseline


def test_code_digest_does_not_normalize_line_endings(package: Path) -> None:
    baseline = pin.code_digest(package)
    (package / "sub" / "mod.py").write_bytes(b"y = 2\r\n")
    assert pin.code_digest(package) != baseline


def test_code_digest_is_location_independent(package: Path, tmp_path: Path) -> None:
    moved = tmp_path / "elsewhere" / "quantsmith"
    shutil.copytree(package, moved)
    assert pin.code_digest(moved) == pin.code_digest(package)


def test_code_digest_rejects_a_tree_without_python(tmp_path: Path) -> None:
    (tmp_path / "empty").mkdir()
    with pytest.raises(ValueError, match="no Python files"):
        pin.code_digest(tmp_path / "empty")


# --- assets digest ----------------------------------------------------------------------------


@pytest.fixture
def assets(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    _write(root / "knowledge" / "packs" / "a.json", '{"a": 1}')
    _write(root / "knowledge" / "packs" / "deep" / "b.md", "# b")
    _write(root / "templates" / "t.md", "template")
    return root


PATHS = ["knowledge/packs", "templates/t.md"]


def test_assets_digest_absent_without_a_root() -> None:
    assert pin.assets_digest(None, PATHS) == pin.ABSENT


def test_assets_digest_covers_directories_and_single_files(assets: Path) -> None:
    baseline = pin.assets_digest(assets, PATHS)
    assert baseline.startswith("sha256:")

    (assets / "knowledge" / "packs" / "deep" / "b.md").write_text("# changed", encoding="utf-8")
    assert pin.assets_digest(assets, PATHS) != baseline


def test_assets_digest_ignores_files_outside_the_listed_paths(assets: Path) -> None:
    baseline = pin.assets_digest(assets, PATHS)
    _write(assets / "knowledge" / "other" / "c.json", "{}")
    _write(assets / "README.md", "unlisted")
    assert pin.assets_digest(assets, PATHS) == baseline


def test_assets_digest_fails_on_a_missing_path_instead_of_digesting_a_partial_tree(
    assets: Path,
) -> None:
    with pytest.raises(FileNotFoundError, match="missing/dir"):
        pin.assets_digest(assets, [*PATHS, "missing/dir"])


def test_assets_digest_rejects_paths_that_escape_the_root(assets: Path, tmp_path: Path) -> None:
    _write(tmp_path / "outside.md", "secret")
    with pytest.raises(ValueError, match="escapes"):
        pin.assets_digest(assets, ["../outside.md"])


# --- locating a copy ---------------------------------------------------------------------------


def test_find_copy_path_mode(tmp_path: Path) -> None:
    repo = tmp_path / "QuantSmith"
    _write(repo / "src" / "quantsmith" / "__init__.py", "")
    _write(repo / "pyproject.toml", '[project]\nname = "quantsmith"\nversion = "9.9.9"\n')

    copy = pin.find_copy(str(repo), installed=False)

    assert copy["mode"] == "path"
    assert copy["package_dir"] == (repo / "src" / "quantsmith").resolve()
    assert copy["assets_root"] == repo.resolve()
    assert copy["version"] == "9.9.9"


def test_find_copy_rejects_a_directory_without_the_package(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        pin.find_copy(str(tmp_path), installed=False)


def test_find_copy_requires_a_mode() -> None:
    with pytest.raises(ValueError):
        pin.find_copy(None, installed=False)


# --- comparison and the shipped pin ------------------------------------------------------------


def _pin(code: str = "sha256:c", assets_digest: str = "sha256:a") -> dict:
    return {"package": {"code_digest": code}, "assets": {"digest": assets_digest}}


@pytest.mark.parametrize(
    ("found_code", "found_assets", "expected"),
    [
        ("sha256:c", "sha256:a", []),
        ("sha256:x", "sha256:a", ["code"]),
        ("sha256:c", "sha256:x", ["assets"]),
        ("sha256:x", "sha256:y", ["code", "assets"]),
        ("sha256:c", pin.ABSENT, []),  # absent assets remove capabilities, not a mismatch
        ("sha256:x", pin.ABSENT, ["code"]),
    ],
)
def test_compare(found_code: str, found_assets: str, expected: list[str]) -> None:
    found = {"code_digest": found_code, "assets_digest": found_assets}
    assert pin.compare(found, _pin()) == expected


def test_shipped_pin_is_well_formed() -> None:
    shipped = pin.read_pin(PIN_PATH)

    assert shipped["package"]["name"] == "quantsmith"
    assert shipped["package"]["code_digest"].startswith("sha256:")
    assert shipped["assets"]["digest"].startswith("sha256:")
    paths = shipped["assets"]["paths"]
    assert len(set(paths)) == len(paths)
    assert all(not p.startswith("/") and ".." not in Path(p).parts for p in paths)
    assert len(shipped["reviewed"]["source_commit"]) == 40


def test_read_pin_rejects_an_unknown_schema_version(tmp_path: Path) -> None:
    bad = _write(tmp_path / "pin.json", json.dumps({"schema_version": "quantsmith-pin/2"}))
    with pytest.raises(ValueError, match="unsupported pin schema_version"):
        pin.read_pin(bad)


# --- command line ------------------------------------------------------------------------------


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    script = Path(pin.__file__)
    return subprocess.run(
        [sys.executable, "-I", str(script), *args], capture_output=True, text=True, check=False
    )


def test_cli_reports_mismatch_and_exits_one_with_check(tmp_path: Path) -> None:
    repo = tmp_path / "QuantSmith"
    _write(repo / "src" / "quantsmith" / "__init__.py", "x = 1\n")
    _write(repo / "pyproject.toml", '[project]\nversion = "0.1.0"\n')
    for asset in json.loads(PIN_PATH.read_text())["assets"]["paths"]:
        # a listed path is a single file when it has an extension, else a directory
        _write(repo / asset if Path(asset).suffix else repo / asset / "f.txt", "x")

    plain = _run("--root", str(repo))
    checked = _run("--root", str(repo), "--check")

    assert plain.returncode == 0
    assert checked.returncode == 1
    report = json.loads(checked.stdout)
    assert report["mismatches"] == ["code", "assets"]


def test_cli_usage_errors_exit_two(tmp_path: Path) -> None:
    result = _run("--root", str(tmp_path / "nowhere"))
    assert result.returncode == 2
    assert "pin:" in result.stderr


# --- the real copy (owner's machine only) ------------------------------------------------------


@pytest.mark.needs_quantsmith
def test_local_copy_matches_the_shipped_pin() -> None:
    shipped = pin.read_pin(PIN_PATH)
    root = quantsmith_root()
    assert root is not None

    found = pin.fingerprints(pin.find_copy(str(root), installed=False), shipped["assets"]["paths"])

    assert pin.compare(found, shipped) == []
    assert found["version"] == shipped["package"]["version"]
