"""Generation/parsing/solve benchmark suite with a retained runtime manifest (AC-021).

Runs benchmark.run_benchmark_suite(), writes the manifest to tests/benchmarks/latest.json
(gitignored -- see benchmark.py's module docstring for why), and asserts every operation's p95
stays under a generous sanity threshold. Thresholds exist to catch a severe regression (something
10x+ slower than the recorded baseline), not to enforce day-to-day machine noise -- see
VALIDATION.md's "Benchmark baseline" section for the last curated reference snapshot and update it
when you deliberately improve or knowingly regress performance.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from benchmark import run_benchmark_suite

ARTIFACT_DIR = Path(__file__).parent / "benchmarks"
ARTIFACT_PATH = ARTIFACT_DIR / "latest.json"

# Generous on purpose: real numbers on a dev laptop are single-digit-to-low-double-digit
# milliseconds (see VALIDATION.md's baseline snapshot). These thresholds exist to catch a real
# regression, not to assert "as fast as the day this was written".
MAX_P95_MS: dict[str, float] = {
    "generate.small": 50.0,
    "generate.medium": 50.0,
    "generate.large": 250.0,
    "solve.small": 250.0,
    "solve.medium": 250.0,
    "solve.large": 750.0,
    "parse.json": 100.0,
    "parse.xlsx": 250.0,
}


@pytest.fixture(scope="module")
def manifest() -> dict[str, Any]:
    result = run_benchmark_suite(iterations=15)
    ARTIFACT_DIR.mkdir(exist_ok=True)
    ARTIFACT_PATH.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    return result


def test_benchmark_manifest_covers_every_expected_operation(manifest: dict[str, Any]) -> None:
    operations = {op["operation"] for op in manifest["operations"]}

    assert operations == set(MAX_P95_MS)
    assert manifest["iterations_per_operation"] == 15
    assert manifest["engine_package_version"]


@pytest.mark.parametrize("operation_name", sorted(MAX_P95_MS))
def test_operation_p95_stays_within_sanity_threshold(
    manifest: dict[str, Any], operation_name: str
) -> None:
    operation = next(op for op in manifest["operations"] if op["operation"] == operation_name)
    threshold = MAX_P95_MS[operation_name]

    assert operation["p95_ms"] < threshold, (
        f"{operation_name} p95={operation['p95_ms']}ms exceeded the {threshold}ms sanity "
        "threshold -- investigate before assuming this is machine noise"
    )


def test_benchmark_artifact_is_written_to_disk(manifest: dict[str, Any]) -> None:
    assert ARTIFACT_PATH.exists()
    on_disk = json.loads(ARTIFACT_PATH.read_text())
    assert on_disk == manifest
