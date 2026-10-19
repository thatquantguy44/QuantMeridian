"""Read only, deterministic SIM showcase backed by the reviewed InventoryBallast engine."""

from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from inventory_optimizer.config import InventoryOptimizerConfig
from inventory_optimizer.demo.manifest import ShowcaseBook, load_book_request, load_manifest
from inventory_optimizer.demo.run import run_demo
from inventory_optimizer.domain.requests import OptimizationRequest
from inventory_optimizer.domain.scenarios import Scenario
from inventory_optimizer.exceptions import InputValidationError
from inventory_optimizer.facade import InventoryOptimizer
from inventory_optimizer.scenarios.compare import build_scenario_comparison
from pydantic import ValidationError

from .capabilities import manifest, require_compatible_engine
from .engine_service import _optimizer

ARTIFACTS = {
    "base_request": "01-base.request.json",
    "base_result": "01-base.result.json",
    "shock_result": "02-shock.result.json",
    "shock_comparison": "02-shock.comparison.json",
    "diagnosis": "03-diagnose.json",
    "repair_request": "04-repair.request.json",
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


def _base_sensitivity(optimizer: InventoryOptimizer, request_path: Path) -> dict[str, Any] | None:
    if not request_path.is_file():
        return None
    request = OptimizationRequest.model_validate_json(request_path.read_text(encoding="utf-8"))
    sensitivity = optimizer.optimize(request, run_id="demo-base-ranging", ranging=True).sensitivity
    return sensitivity.model_dump(mode="json") if sensitivity is not None else None


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
        base_request = Path(directory) / book_id / "01-base.request.json"
        artifacts["base_sensitivity"] = _base_sensitivity(optimizer, base_request)
    # No recomputed objective, feasibility, ranking or diagnosis is added here. The one extra solve,
    # `base_sensitivity`, re-solves the base book's own request with the engine's LP ranging on
    # (spec0020 DIAG-002), because the guided demo steps solve without it.
    pin = manifest()
    return {
        "data_label": "SIM", "engine_commit": pin["engine_commit"],
        "engine_fingerprint": pin["engine_fingerprint"],
        "report": report.model_dump(mode="json"), "artifacts": artifacts,
    }


EDITED_LABEL = "user-edited"


class ShowcaseEditRejected(ValueError):
    """The engine refused the hand-edited request; ``messages`` say why."""

    def __init__(self, messages: list[str]) -> None:
        super().__init__("; ".join(messages))
        self.messages = messages


def _book(book_id: str) -> ShowcaseBook:
    book = next((item for item in load_manifest().books if item.book_id == book_id), None)
    if book is None:
        raise ValueError("Unknown pinned showcase book.")
    return book


def run_edited(book_id: str, request_payload: dict[str, Any]) -> dict[str, Any]:
    """Spec013 decision 3: after the guided sequence the presenter may edit a request by hand. The
    engine solves it and compares it with the book's base solve exactly as the demo compares the
    repair (``build_scenario_comparison``). The run is labelled ``user-edited``; a run that is not
    optimal and verified is returned without a comparison, as the demo skips one."""
    require_compatible_engine()
    book = _book(book_id)
    try:
        edited_request = OptimizationRequest.model_validate(request_payload)
    except ValidationError as error:
        raise ShowcaseEditRejected(
            [
                f"{'.'.join(str(part) for part in item['loc']) or 'request'}: {item['msg']}"
                for item in error.errors()[:10]
            ]
        ) from error
    optimizer = _optimizer(InventoryOptimizerConfig.model_validate({}))
    base_request = load_book_request(book)
    base = optimizer.optimize(base_request, run_id=f"demo-{book_id}-base")
    try:
        edited = optimizer.optimize(edited_request, run_id=f"demo-{book_id}-{EDITED_LABEL}")
    except InputValidationError as error:
        raise ShowcaseEditRejected([str(error)]) from error
    comparable = edited.status.value == "optimal" and edited.verification.passed
    comparison = (
        build_scenario_comparison(
            scenario=Scenario(scenario_id=EDITED_LABEL, name="User-edited request"),
            baseline_request=base_request,
            baseline_result=base,
            scenario_request=edited_request,
            scenario_result=edited,
            config=optimizer.config,
        )
        if comparable
        else None
    )
    pin = manifest()
    return {
        "data_label": "SIM", "label": EDITED_LABEL, "book_id": book_id,
        "engine_commit": pin["engine_commit"], "engine_fingerprint": pin["engine_fingerprint"],
        "governance_gates_granted": [],
        # The engine's own JSON serialization, as for the guided artifacts
        # (non-finite bounds become null).
        "base_result": json.loads(base.model_dump_json()),
        "edited_result": json.loads(edited.model_dump_json()),
        "comparison": json.loads(comparison.model_dump_json()) if comparison is not None else None,
        "comparison_skipped_reason": None if comparable else (
            f"the edited request solved {edited.status.value} with verification "
            f"{'passed' if edited.verification.passed else 'not passed'}; "
            "only an optimal, verified run is compared"
        ),
    }
