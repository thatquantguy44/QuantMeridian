"""Read only, deterministic SIM showcase backed by the reviewed InventoryBallast engine."""

from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from inventory_optimizer.config import InventoryOptimizerConfig
from inventory_optimizer.demo.manifest import load_manifest
from inventory_optimizer.demo.run import run_demo

from .capabilities import manifest, require_compatible_engine
from .engine_service import _optimizer


ARTIFACTS = {
    "base_result": "01-base.result.json",
    "shock_result": "02-shock.result.json",
    "shock_comparison": "02-shock.comparison.json",
    "diagnosis": "03-diagnose.json",
    "repair_result": "04-repair.result.json",
    "repair_comparison": "05-compare.comparison.json",
}


def catalog() -> dict[str, Any]:
    require_compatible_engine()
    source = load_manifest()
    pin = manifest()
    return {
        "data_label": "SIM", "provenance": source.provenance.model_dump(mode="json"),
        "manifest_version": source.manifest_version,
        "engine_commit": pin["engine_commit"],
        "engine_fingerprint": pin["engine_fingerprint"],
        "engine_package_version": pin["engine_package_version"],
        "governance_gates_granted": [],
        "books": [{"book_id": book.book_id, "title": book.title,
                   "behavior": book.behavior, "shock": book.shock.model_dump(mode="json"),
                   "repair": {"repair_id": book.repair.repair_id,
                              "description": book.repair.description,
                              "expected_status": book.repair.expected_status}}
                  for book in source.books],
    }


def run_book(book_id: str) -> dict[str, Any]:
    require_compatible_engine()
    source = load_manifest()
    book = next((item for item in source.books if item.book_id == book_id), None)
    if book is None:
        raise ValueError("Unknown pinned showcase book.")
    optimizer = _optimizer(InventoryOptimizerConfig.model_validate({}))
    with TemporaryDirectory(prefix="ibal-showcase-") as directory:
        report = run_demo(optimizer, output_dir=Path(directory), book_ids=(book_id,), manifest=source)
        artifacts = {}
        for label, filename in ARTIFACTS.items():
            path = Path(directory) / book_id / filename
            artifacts[label] = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None
    # No recomputed objective, feasibility, ranking or diagnosis is added here.
    pin = manifest()
    return {
        "data_label": "SIM", "engine_commit": pin["engine_commit"],
        "engine_fingerprint": pin["engine_fingerprint"],
        "report": report.model_dump(mode="json"), "artifacts": artifacts,
    }
