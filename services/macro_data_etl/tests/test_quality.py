"""Tests for the quality-check framework and full quality suite."""

from __future__ import annotations

from datetime import date

import polars as pl

from macro_data_etl.src.utils.quality import QualityChecker


def _obs_frame() -> pl.DataFrame:
    return pl.DataFrame(
        {
            "observation_id": ["a", "b", "c", "d"],
            "source": ["bis", "bis", "world_bank", "world_bank"],
            "country_iso3": ["USA", "GBR", "USA", "GBR"],
            "indicator": ["policy_rate", "policy_rate", "cpi_yoy", "cpi_yoy"],
            "date": [date(2025, 12, 1), date(2025, 12, 1), date(2023, 12, 31), date(2023, 12, 31)],
            "value": [4.25, 4.00, 4.1, 6.8],
        }
    )


def test_date_range_pass():
    qc = QualityChecker()
    res = qc.check_date_range(_obs_frame(), "date", "1950-01-01", "2100-12-31")
    assert res.passed
    assert res.rows_affected == 0


def test_date_range_flags_out_of_range():
    df = pl.DataFrame({"date": [date(1800, 1, 1), date(2025, 1, 1)]})
    qc = QualityChecker()
    res = qc.check_date_range(df, "date", "1950-01-01", "2100-12-31")
    assert not res.passed
    assert res.rows_affected == 1


def test_cross_source_validation():
    df1 = pl.DataFrame({"country_iso3": ["USA", "GBR"], "value": [4.1, 6.8]})
    df2 = pl.DataFrame({"country_iso3": ["USA", "GBR"], "value": [4.2, 9.9]})
    qc = QualityChecker()
    res = qc.check_cross_source(df1, df2, ["country_iso3"], "value", tolerance=1.0)
    # GBR differs by 3.1 > 1.0 tolerance
    assert not res.passed
    assert res.rows_affected == 1


def test_run_all_suite_and_report():
    qc = QualityChecker(
        {"quality": {"null_threshold": 0.05, "sanity_bounds": {
            "inflation_yoy_min": -20.0, "inflation_yoy_max": 500.0,
            "policy_rate_min": -2.0, "policy_rate_max": 100.0}}}
    )
    results = qc.run_all(_obs_frame())
    assert len(results) >= 2
    report = qc.report()
    assert "checks" in report
    assert qc.passed  # clean frame should pass the gate


def test_gate_fails_on_error_severity():
    df = pl.DataFrame(
        {
            "observation_id": ["a", "a"],  # duplicate
            "indicator": ["cpi_yoy", "cpi_yoy"],
            "date": [date(2023, 1, 1), date(2023, 1, 1)],
            "value": [2.0, 2.0],
        }
    )
    qc = QualityChecker()
    qc.run_all(df)
    assert not qc.passed
