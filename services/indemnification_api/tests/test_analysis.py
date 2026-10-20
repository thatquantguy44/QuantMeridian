"""The complete analysis: run, sensitivities and stresses in one validated result."""

import json

import pytest
from conftest import CONTRACTS

from indemnification_api.analysis import run_analysis
from indemnification_api.contracts import seal
from indemnification_api.stress import SCENARIOS

CREATED = "2026-10-20T12:00:00Z"


@pytest.fixture(scope="module")
def analysis():
    book = json.loads((CONTRACTS / "fixtures" / "sim-book.example.json").read_text("utf-8"))
    snap = seal({**book, "run": {**book["run"], "paths": 1000}})
    return snap, run_analysis(snap, sensitivity_paths=1000, created_at=CREATED)


def test_the_full_result_validates_against_the_contract(analysis, validator_for):
    _, result = analysis
    assert [e.message for e in validator_for("result-1.0.schema.json").iter_errors(result)] == []


def test_it_carries_the_run_the_sweeps_the_stresses_and_the_cross_check(analysis):
    _, result = analysis
    assert [s["parameter"] for s in result["sensitivities"]] == [
        "margin_pct", "mpor_days", "rho_w", "collateral_substitution",
    ]  # fmt: skip
    assert [s["id"] for s in result["stresses"]] == list(SCENARIOS)
    assert len(result["borrowers"]) == 16 and len(result["cross_check"]["borrowers"]) == 16
    assert result["program"]["gaussian"]["with_wrong_way"]["total"]["el"]["value"] > 0


def test_the_analysis_is_reproducible(analysis):
    snap, first = analysis
    assert run_analysis(snap, sensitivity_paths=1000, created_at=CREATED) == first


def test_stress_overrides_apply_to_the_stresses_and_not_to_the_run(analysis):
    snap, base = analysis
    costly = run_analysis(
        snap,
        sensitivity_paths=1000,
        created_at=CREATED,
        stress_profile_overrides={"half_spread_floor_bps": 200.0},
    )
    assert costly["program"] == base["program"] and costly["sensitivities"] == base["sensitivities"]
    assert costly["stresses"] != base["stresses"]
