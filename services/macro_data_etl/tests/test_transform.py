"""Tests for the transform layer (bronze -> silver -> gold)."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import polars as pl
import pytest

from macro_data_etl.src.transform.transformers import Transformer

CATALOG = {
    "countries": [
        {"iso3": "USA", "name": "United States", "flag": "US", "region": "AMER", "target_inflation": 2.0},
        {"iso3": "GBR", "name": "United Kingdom", "flag": "GB", "region": "EMEA", "target_inflation": 2.0},
    ]
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@pytest.fixture()
def tmp_transformer(tmp_path: Path) -> Transformer:
    return Transformer(tmp_path, catalog=CATALOG)


def _write_wb_raw(tmp_path: Path) -> Path:
    df = pl.DataFrame(
        {
            "country_iso3": ["USA", "USA", "GBR"],
            "indicator": ["FP.CPI.TOTL.ZG"] * 3,
            "date": ["2022", "2023", "2023"],
            "value": [8.0, 4.1, 6.8],
            "source": ["world_bank"] * 3,
            "fetched_at": [_now()] * 3,
        }
    )
    raw = tmp_path / "wb_raw.parquet"
    df.write_parquet(raw)
    return raw


def _write_bis_raw(tmp_path: Path) -> Path:
    df = pl.DataFrame(
        {
            "freq": ["M"] * 3,
            "ref_area": ["US", "US", "GB"],
            "time_period": ["2025-11", "2025-12", "2025-12"],
            "obs_value": [4.50, 4.25, 4.00],
            "source": ["bis"] * 3,
            "fetched_at": [_now()] * 3,
        }
    )
    raw = tmp_path / "bis_raw.parquet"
    df.write_parquet(raw)
    return raw


def test_bronze_inflation_normalizes(tmp_transformer: Transformer, tmp_path: Path):
    raw = _write_wb_raw(tmp_path)
    out = tmp_transformer.bronze_inflation(raw)
    df = pl.read_parquet(out)
    assert df.height == 3
    assert set(df["indicator"].unique()) == {"cpi_yoy"}
    assert df["obs_date"].dtype == pl.Date


def test_bronze_policy_rates_maps_iso(tmp_transformer: Transformer, tmp_path: Path):
    raw = _write_bis_raw(tmp_path)
    out = tmp_transformer.bronze_policy_rates(raw)
    df = pl.read_parquet(out)
    assert "USA" in df["country_iso3"].to_list()
    assert "GBR" in df["country_iso3"].to_list()
    assert df["indicator"].unique().to_list() == ["policy_rate"]


def test_silver_merge_builds_unified_schema(tmp_transformer: Transformer, tmp_path: Path):
    infl = tmp_transformer.bronze_inflation(_write_wb_raw(tmp_path))
    rates = tmp_transformer.bronze_policy_rates(_write_bis_raw(tmp_path))
    silver = tmp_transformer.silver_merge(infl, rates)
    df = pl.read_parquet(silver)
    for col in ("observation_id", "country_name", "region", "prior_value", "vintage_date"):
        assert col in df.columns
    # observation ids are unique
    assert df["observation_id"].n_unique() == df.height
    # enrichment from catalog
    usa = df.filter(pl.col("country_iso3") == "USA")
    assert "United States" in usa["country_name"].to_list()


def test_gold_country_latest(tmp_transformer: Transformer, tmp_path: Path):
    infl = tmp_transformer.bronze_inflation(_write_wb_raw(tmp_path))
    rates = tmp_transformer.bronze_policy_rates(_write_bis_raw(tmp_path))
    silver = tmp_transformer.silver_merge(infl, rates)
    out = tmp_transformer.gold_country_latest(silver)
    df = pl.read_parquet(out)
    usa = df.filter(pl.col("country_iso3") == "USA")
    assert usa.height == 1
    # latest CPI is 2023 -> 4.1; latest rate is Dec 2025 -> 4.25
    assert abs(usa["cpi_yoy"][0] - 4.1) < 1e-6
    assert abs(usa["policy_rate"][0] - 4.25) < 1e-6
    # real rate = 4.25 - 4.1
    assert abs(usa["real_rate"][0] - 0.15) < 1e-6


def test_gold_wide_timeseries(tmp_transformer: Transformer, tmp_path: Path):
    infl = tmp_transformer.bronze_inflation(_write_wb_raw(tmp_path))
    rates = tmp_transformer.bronze_policy_rates(_write_bis_raw(tmp_path))
    silver = tmp_transformer.silver_merge(infl, rates)
    out = tmp_transformer.gold_inflation_timeseries(silver)
    df = pl.read_parquet(out)
    assert "date" in df.columns
    assert "USA" in df.columns


def test_empty_inputs_dont_crash(tmp_transformer: Transformer, tmp_path: Path):
    empty = tmp_path / "empty.parquet"
    tmp_transformer._empty_bronze().write_parquet(empty)
    silver = tmp_transformer.silver_merge(empty, empty)
    gold = tmp_transformer.build_all_gold(silver)
    assert all(Path(p).exists() for p in gold.values())
