from __future__ import annotations

import os
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]


def quantsmith_root() -> Path | None:
    """The owner's local QuantSmith checkout, when one is configured and present."""
    value = os.environ.get("QUANTSMITH_ROOT", "").strip()
    if value:
        path = Path(value).expanduser()
        if not path.is_absolute():
            path = (REPO_ROOT / path).resolve()
        return path if (path / "src" / "quantsmith").is_dir() else None
    return None


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if quantsmith_root() is not None:
        return
    skip = pytest.mark.skip(reason="needs_quantsmith: set QUANTSMITH_ROOT to a local checkout")
    for item in items:
        if "needs_quantsmith" in item.keywords:
            item.add_marker(skip)
