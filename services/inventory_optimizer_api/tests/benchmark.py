"""Timing/percentile benchmark harness for generation, upload parsing, and solve (AC-021).

Reusable so the suite can be re-run and re-verified locally without hand-rolling stopwatch code
each time -- same "framework, not one-off script" shape as edge_cases.py. See test_benchmark.py
for the suite that uses this, and VALIDATION.md's "Benchmark baseline" section for the last
recorded reference snapshot (the raw per-run JSON manifest is written to
tests/benchmarks/latest.json, gitignored -- machine-specific timing numbers are not meaningful to
version, the curated snapshot in VALIDATION.md is).
"""

from __future__ import annotations

import math
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import partial
from typing import Any
from uuid import uuid4

from inventory_optimizer_api.capabilities import engine_identity
from inventory_optimizer_api.contracts import RunConfig, RunRequest, SyntheticConfig
from inventory_optimizer_api.engine_service import solve
from inventory_optimizer_api.synthetic import generate_dataset
from inventory_optimizer_api.templates import json_template, workbook_template
from inventory_optimizer_api.upload import parse_upload

SCALES: tuple[str, ...] = ("small", "medium", "large")


@dataclass(frozen=True, slots=True)
class TimingStats:
    operation: str
    count: int
    min_ms: float
    p50_ms: float
    p95_ms: float
    max_ms: float
    mean_ms: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "operation": self.operation,
            "count": self.count,
            "min_ms": round(self.min_ms, 3),
            "p50_ms": round(self.p50_ms, 3),
            "p95_ms": round(self.p95_ms, 3),
            "max_ms": round(self.max_ms, 3),
            "mean_ms": round(self.mean_ms, 3),
        }


def _percentile(sorted_values: list[float], p: float) -> float:
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = p / 100 * (len(sorted_values) - 1)
    lower, upper = math.floor(rank), math.ceil(rank)
    if lower == upper:
        return sorted_values[int(rank)]
    fraction = rank - lower
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * fraction


def time_operation(operation: str, fn: Callable[[], Any], *, iterations: int) -> TimingStats:
    """Run `fn` `iterations` times with no warmup discarded (cheap operations only; this is not
    meant for anything expensive enough that JIT/cache warmup would dominate)."""
    durations_ms: list[float] = []
    for _ in range(iterations):
        started = time.perf_counter()
        fn()
        durations_ms.append((time.perf_counter() - started) * 1000)
    durations_ms.sort()
    return TimingStats(
        operation=operation,
        count=iterations,
        min_ms=durations_ms[0],
        p50_ms=_percentile(durations_ms, 50),
        p95_ms=_percentile(durations_ms, 95),
        max_ms=durations_ms[-1],
        mean_ms=sum(durations_ms) / iterations,
    )


def _solve_once(dataset: Any, run_config: RunConfig) -> None:
    solve(
        RunRequest(dataset=dataset, run_config=run_config),
        correlation_id=str(uuid4()),
        idempotency_key=str(uuid4()),
    )


def run_benchmark_suite(*, iterations: int = 20) -> dict[str, Any]:
    """Generation + solve timing across every scale preset, plus JSON/XLSX upload-parse timing.

    Returns a JSON-serializable manifest: generation metadata (timestamp, engine identity,
    iteration count) plus one TimingStats dict per operation.
    """
    stats: list[TimingStats] = []
    run_config = RunConfig(solver_time_limit_seconds=30)

    for scale in SCALES:
        config = SyntheticConfig(seed=1, profile="balanced", scale=scale)
        stats.append(
            time_operation(
                f"generate.{scale}", partial(generate_dataset, config), iterations=iterations
            )
        )
        dataset = generate_dataset(config)
        stats.append(
            time_operation(
                f"solve.{scale}",
                partial(_solve_once, dataset, run_config),
                iterations=iterations,
            )
        )

    json_bytes = json_template()
    xlsx_bytes = workbook_template("starter-xlsx")
    stats.append(
        time_operation(
            "parse.json", partial(parse_upload, json_bytes, "r.json"), iterations=iterations
        )
    )
    stats.append(
        time_operation(
            "parse.xlsx", partial(parse_upload, xlsx_bytes, "r.xlsx"), iterations=iterations
        )
    )

    identity = engine_identity()
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "iterations_per_operation": iterations,
        "engine_package_version": identity["package_version"],
        "engine_commit": identity["installed_commit"],
        "backend_version": identity["backend_version"],
        "operations": [s.as_dict() for s in stats],
    }
