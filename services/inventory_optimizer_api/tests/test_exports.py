"""Export bundle round-trip and byte-parity with the engine's own tables (AC-016).

export_bundle() already calls reporting.tables.result_tables() directly to build the CSVs, so
these tests exist to catch a bug in the *serialization* step (_table_csv), not to re-verify the
engine's table-building logic itself: every CSV cell, once written and read back, must equal what
result_tables() actually returned for the exact same OptimizationResult -- not a value the export
path recomputed or rounded differently.

CSV stringification rule (verified empirically, csv.writer's default dialect): `None` becomes an
empty string; every other value becomes `str(value)` (floats keep Python's shortest
round-trippable repr, bools become "True"/"False"). That rule is what the comparison helpers below
encode -- it is the correct behavior, not a limitation to work around.
"""

from __future__ import annotations

import csv
import json
import zipfile
from io import BytesIO, StringIO
from uuid import uuid4

import pytest
from edge_cases import BOUNDARY_SYNTHETIC_CONFIGS, solve_dataset
from inventory_optimizer.domain.results import OptimizationResult
from inventory_optimizer.reporting.tables import result_tables

from inventory_optimizer_api.canonical import canonical_json
from inventory_optimizer_api.contracts import ExportRequest, RunConfig, RunRequest, SyntheticConfig
from inventory_optimizer_api.engine_service import _table_csv, export_bundle, solve
from inventory_optimizer_api.synthetic import generate_dataset

EXPECTED_TABLE_NAMES = (
    "allocations",
    "allocation_evidence",
    "balances",
    "demand",
    "constraints",
    "economics",
    "run_summary",
)


def _csv_cell(value: object) -> str:
    return "" if value is None else str(value)


def _solved_bundle(seed: int = 42, run_config: RunConfig | None = None):
    dataset = generate_dataset(SyntheticConfig(seed=seed, profile="balanced", scale="small"))
    config = run_config or RunConfig(solver_time_limit_seconds=15)
    response = solve(
        RunRequest(dataset=dataset, run_config=config),
        correlation_id=str(uuid4()),
        idempotency_key=str(uuid4()),
    )
    archive_bytes = export_bundle(ExportRequest(dataset=dataset, result=response.result))
    return dataset, response.result, archive_bytes


def _read_zip(archive_bytes: bytes) -> zipfile.ZipFile:
    return zipfile.ZipFile(BytesIO(archive_bytes))


# --- archive contents -------------------------------------------------------------------------


def test_export_bundle_contains_exactly_the_expected_files() -> None:
    _, _, archive_bytes = _solved_bundle()

    with _read_zip(archive_bytes) as archive:
        names = set(archive.namelist())

    expected = {
        "normalized-input.json",
        "raw-result.json",
        "validation-report.json",
        *(f"result-tables/{name}.csv" for name in EXPECTED_TABLE_NAMES),
    }
    assert names == expected


def test_normalized_input_round_trips_exactly() -> None:
    dataset, _, archive_bytes = _solved_bundle()

    with _read_zip(archive_bytes) as archive:
        normalized = json.loads(archive.read("normalized-input.json"))

    assert normalized == dataset.request
    # And it must be the exact canonical serialization, not a re-derived equivalent.
    assert archive_read_text(archive_bytes, "normalized-input.json").strip() == canonical_json(
        dataset.request
    )


def test_raw_result_round_trips_exactly() -> None:
    _, result, archive_bytes = _solved_bundle()

    with _read_zip(archive_bytes) as archive:
        raw_result = json.loads(archive.read("raw-result.json"))

    assert raw_result == result


def test_validation_report_matches_dataset_validation() -> None:
    dataset, _, archive_bytes = _solved_bundle()

    with _read_zip(archive_bytes) as archive:
        report = json.loads(archive.read("validation-report.json"))

    assert report["valid"] is True
    assert report["issues"] == []
    assert dataset.validation.valid is True


def archive_read_text(archive_bytes: bytes, name: str) -> str:
    with _read_zip(archive_bytes) as archive:
        return archive.read(name).decode("utf-8")


# --- CSV content vs. the engine's own tables --------------------------------------------------


@pytest.mark.parametrize("table_name", EXPECTED_TABLE_NAMES)
def test_result_table_csv_matches_engine_table_content(table_name: str) -> None:
    _, result, archive_bytes = _solved_bundle()
    engine_tables = {t.name: t for t in result_tables(OptimizationResult.model_validate(result))}
    engine_table = engine_tables[table_name]

    with _read_zip(archive_bytes) as archive:
        csv_text = archive.read(f"result-tables/{table_name}.csv").decode("utf-8")

    rows = list(csv.reader(StringIO(csv_text)))
    header, data_rows = rows[0], rows[1:]

    assert tuple(header) == engine_table.columns
    assert len(data_rows) == len(engine_table.rows)
    for csv_row, engine_row in zip(data_rows, engine_table.rows, strict=True):
        assert tuple(csv_row) == tuple(_csv_cell(v) for v in engine_row)


@pytest.mark.parametrize(
    "config", BOUNDARY_SYNTHETIC_CONFIGS, ids=[str(c.seed) for c in BOUNDARY_SYNTHETIC_CONFIGS]
)
def test_export_round_trips_at_boundary_configs(config: SyntheticConfig) -> None:
    dataset = generate_dataset(config)
    response = solve_dataset(dataset)

    archive_bytes = export_bundle(ExportRequest(dataset=dataset, result=response.result))

    with _read_zip(archive_bytes) as archive:
        names = set(archive.namelist())
        raw_result = json.loads(archive.read("raw-result.json"))

    assert names >= {f"result-tables/{name}.csv" for name in EXPECTED_TABLE_NAMES}
    assert raw_result == response.result


# --- _table_csv serialization edge cases (no full solve needed) -------------------------------


def test_table_csv_escapes_commas_quotes_and_newlines() -> None:
    columns = ("id", "label")
    rows = (
        ("SYN-1", "has,a,comma"),
        ("SYN-2", 'has"a"quote'),
        ("SYN-3", "has\na newline"),
    )

    csv_bytes = _table_csv(columns, rows)
    parsed = list(csv.reader(StringIO(csv_bytes.decode("utf-8"))))

    assert parsed[0] == list(columns)
    assert parsed[1:] == [list(row) for row in rows]


def test_table_csv_renders_none_as_empty_string_and_preserves_float_precision() -> None:
    columns = ("id", "optional_value", "precise_value", "flag")
    rows = ((("SYN-1", None, 0.123456789012345, True)),)

    csv_bytes = _table_csv(columns, rows)
    parsed = list(csv.reader(StringIO(csv_bytes.decode("utf-8"))))

    assert parsed[1] == ["SYN-1", "", "0.123456789012345", "True"]
