"""Generate a deterministic demo gold snapshot + JSON export.

The live connectors require outbound network access (World Bank / BIS / CME).
Where that is unavailable (sandboxed CI, the terminal's free hosting tier) this
script synthesizes a plausible mid-2026 macro regime for every country in the
catalog, runs it through the *real* transform/gold/load/export path, and writes
JSON the terminal can consume. Values are deterministic (seeded), so they are
reproducible and SSR-safe — but they are clearly a demo, not a live feed.

Run live data instead with:  macro-etl run --source all && macro-etl fedwatch
"""

from __future__ import annotations

import hashlib
from datetime import date, datetime, timezone
from pathlib import Path

import polars as pl

from macro_data_etl.src.analytics.fed_probability import FedProbabilityEngine
from macro_data_etl.src.load.loaders import DuckDBLoader
from macro_data_etl.src.orchestration.pipeline import Pipeline


def _seed(key: str) -> float:
    """Deterministic float in [0, 1) from a string key."""
    h = hashlib.sha256(key.encode()).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


def _country_seed_values(c: dict) -> tuple[float, float]:
    """Plausible current CPI YoY and policy rate for a country (deterministic)."""
    iso = c["iso3"]
    target = float(c.get("target_inflation") or 2.0)
    # CPI: anchored near target with a country-specific spread; EMs run hotter.
    spread = (_seed(f"cpi{iso}") - 0.4) * 2.5
    em_boost = 0.0
    if iso in {"TUR", "ARG", "BRA", "RUS", "ZAF", "IND", "IDN", "MEX", "EGY", "NGA"}:
        em_boost = _seed(f"em{iso}") * 4.0
    cpi = round(max(-1.0, target + spread + em_boost), 1)
    if iso == "TUR":
        cpi = round(28.0 + _seed("tur") * 12, 1)
    # Policy rate: real rate roughly +0.5..+2.5 over CPI, floored.
    real = 0.5 + _seed(f"real{iso}") * 2.0
    rate = round(max(0.0, cpi + real - 1.0), 2)
    if iso == "JPN":
        rate = round(0.5 + _seed("jpn") * 0.5, 2)
    return cpi, rate


def build_silver(pipe: Pipeline) -> Path:
    """Synthesize a macro_observations silver frame for all catalog countries."""
    now = datetime.now(timezone.utc).isoformat()
    vintage = date.today()
    rows: list[dict] = []
    for c in pipe.countries:
        iso = c["iso3"]
        name = c.get("name", iso)
        region = c.get("region", "")
        cpi, rate = _country_seed_values(c)

        # 24 months of monthly history converging to the current print.
        for ind, latest, src, unit in (
            ("cpi_yoy", cpi, "world_bank", "percent"),
            ("policy_rate", rate, "bis", "percent"),
        ):
            prev = None
            for m in range(24, -1, -1):
                # drift from a higher past toward the current value (disinflation / easing)
                drift = (m / 24.0) * (1.5 if ind == "cpi_yoy" else 1.0)
                noise = (_seed(f"{iso}{ind}{m}") - 0.5) * 0.2
                val = round(latest + drift + noise, 2) if m else latest
                d = date(2026, 6, 1)
                y = d.year - (m // 12)
                mo = d.month - (m % 12)
                if mo <= 0:
                    mo += 12
                    y -= 1
                obs_date = date(y, mo, 28 if ind == "cpi_yoy" else 1)
                oid = hashlib.sha256(
                    f"{src}|{iso}|{ind}|{obs_date}|latest".encode()
                ).hexdigest()[:16]
                rows.append(
                    {
                        "observation_id": oid,
                        "source": src,
                        "country_iso3": iso,
                        "country_name": name,
                        "region": region,
                        "indicator": ind,
                        "frequency": "M",
                        "date": obs_date,
                        "value": float(val),
                        "unit": unit,
                        "prior_value": prev,
                        "revision_from": None,
                        "vintage_date": vintage,
                        "is_preliminary": False,
                        "fetched_at": now,
                        "quality_flag": "demo",
                    }
                )
                prev = float(val)

    df = pl.DataFrame(rows)
    out = pipe.data_path / "silver" / "macro_observations.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(out, compression="zstd")
    print(f"seed: silver {df.height} observations -> {out}")
    return out


def main() -> None:
    pipe = Pipeline()
    silver = build_silver(pipe)
    gold = pipe.transformer.build_all_gold(silver)

    # FedWatch via the deterministic fallback curve.
    engine = FedProbabilityEngine()
    meetings = pipe._upcoming_meetings()
    engine.set_fomc_calendar(meetings)
    prices = pipe._fallback_futures_curve(engine, meetings)
    results = engine.compute_meeting_probabilities(prices)
    prob_df = engine.to_dataframe(results).with_columns(pl.lit("sim").alias("price_source"))
    prob_path = pipe.data_path / "gold" / "fed_probabilities.parquet"
    prob_df.write_parquet(prob_path, compression="zstd")
    gold["fed_probabilities"] = prob_path
    print(f"seed: fed_probabilities {prob_df.height} meetings -> {prob_path}")

    with DuckDBLoader(pipe.db_path) as db:
        db.load_silver(silver)
        db.load_gold(gold)

    # JSON export for the terminal.
    export_dir = pipe.data_path / "export"
    export_dir.mkdir(parents=True, exist_ok=True)
    with DuckDBLoader(pipe.db_path) as db:
        for table in (
            "country_macro_latest",
            "inflation_timeseries",
            "policy_rate_timeseries",
            "fed_probabilities",
        ):
            db.export_json(table, export_dir / f"{table}.json")
    print(f"seed: exported JSON -> {export_dir}")


if __name__ == "__main__":
    main()
