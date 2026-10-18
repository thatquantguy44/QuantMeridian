"""Transform layer — raw -> bronze -> silver -> gold using Polars.

* **bronze** — per-source cleaning: parse dates, drop nulls, normalize codes.
* **silver** — a single unified ``macro_observations`` table across all sources,
  with deterministic ``observation_id`` for dedupe and vintage tracking.
* **gold** — analytical tables consumed by the terminal (latest snapshot, wide
  timeseries, real rates, vintage history).
"""

from __future__ import annotations

import hashlib
from datetime import date, datetime, timezone
from pathlib import Path

import polars as pl

from macro_data_etl.src.utils.logging import get_logger

logger = get_logger(__name__)

# ISO-2 (BIS ref_area) -> ISO-3 mapping for the central banks we track.
ISO2_TO_ISO3 = {
    "US": "USA", "GB": "GBR", "XM": "EMU", "EA": "EMU", "JP": "JPN", "DE": "DEU",
    "FR": "FRA", "IT": "ITA", "CA": "CAN", "MX": "MEX", "BR": "BRA", "CN": "CHN",
    "IN": "IND", "AU": "AUS", "KR": "KOR", "CH": "CHE", "SE": "SWE", "NO": "NOR",
    "NZ": "NZL", "TR": "TUR", "ID": "IDN", "ZA": "ZAF", "ES": "ESP", "SA": "SAU",
    "RU": "RUS", "PL": "POL", "TH": "THA", "MY": "MYS", "PH": "PHL", "CL": "CHL",
    "CO": "COL", "PE": "PER", "HU": "HUN", "CZ": "CZE", "IL": "ISR", "HK": "HKG",
    "DK": "DNK",
}

VINTAGE_DEFAULT = "latest"


class Transformer:
    """Drives the medallion transform across the configured data path."""

    def __init__(
        self, data_path: Path | str = Path("./data"), catalog: dict | None = None
    ) -> None:
        self.data_path = Path(data_path)
        self.catalog = catalog or {}
        for layer in ("bronze", "silver", "gold"):
            (self.data_path / layer).mkdir(parents=True, exist_ok=True)
        # country lookups for region / name / flag enrichment
        self._by_iso3: dict[str, dict] = {
            c["iso3"]: c for c in self.catalog.get("countries", []) if c.get("iso3")
        }

    # ==================================================================
    # Bronze
    # ==================================================================

    def bronze_inflation(self, raw_path: Path) -> Path:
        """Clean World Bank inflation into a normalized bronze frame."""
        df = pl.read_parquet(raw_path)
        if df.height == 0:
            out = self.data_path / "bronze" / "inflation.parquet"
            self._empty_bronze().write_parquet(out)
            return out

        clean = (
            df.filter(pl.col("value").is_not_null() & (pl.col("country_iso3") != ""))
            .with_columns(
                pl.col("date").cast(pl.Utf8).alias("period"),
                # World Bank inflation is already annual YoY %.
                pl.col("value").cast(pl.Float64),
                pl.lit("cpi_yoy").alias("indicator"),
                pl.lit("A").alias("frequency"),
                pl.lit("percent").alias("unit"),
                pl.lit("world_bank").alias("source"),
            )
            .with_columns(
                # Annual obs -> Dec-31 of the year for a sortable date.
                (pl.col("period").str.slice(0, 4) + pl.lit("-12-31"))
                .str.strptime(pl.Date, "%Y-%m-%d", strict=False)
                .alias("obs_date")
            )
            .select(
                "country_iso3", "indicator", "frequency", "obs_date",
                "value", "unit", "source", "fetched_at",
            )
            .unique(subset=["country_iso3", "indicator", "obs_date"])
            .sort(["country_iso3", "obs_date"])
        )
        out = self.data_path / "bronze" / "inflation.parquet"
        clean.write_parquet(out, compression="zstd")
        logger.info("bronze_inflation: %d rows -> %s", clean.height, out)
        return out

    def bronze_policy_rates(self, raw_path: Path) -> Path:
        """Clean BIS policy rates: parse periods, ISO2 -> ISO3."""
        df = pl.read_parquet(raw_path)
        if df.height == 0:
            out = self.data_path / "bronze" / "policy_rates.parquet"
            self._empty_bronze().write_parquet(out)
            return out

        mapping = pl.DataFrame(
            {"ref_area": list(ISO2_TO_ISO3.keys()), "country_iso3": list(ISO2_TO_ISO3.values())}
        )
        clean = (
            df.filter(pl.col("obs_value").is_not_null())
            .join(mapping, on="ref_area", how="left")
            .with_columns(
                pl.coalesce([pl.col("country_iso3"), pl.col("ref_area")]).alias("country_iso3"),
                pl.col("obs_value").cast(pl.Float64).alias("value"),
                pl.lit("policy_rate").alias("indicator"),
                pl.lit("M").alias("frequency"),
                pl.lit("percent").alias("unit"),
                pl.lit("bis").alias("source"),
                self._period_to_date(pl.col("time_period")).alias("obs_date"),
            )
            .filter(pl.col("obs_date").is_not_null())
            .select(
                "country_iso3", "indicator", "frequency", "obs_date",
                "value", "unit", "source", "fetched_at",
            )
            .unique(subset=["country_iso3", "indicator", "obs_date"])
            .sort(["country_iso3", "obs_date"])
        )
        out = self.data_path / "bronze" / "policy_rates.parquet"
        clean.write_parquet(out, compression="zstd")
        logger.info("bronze_policy_rates: %d rows -> %s", clean.height, out)
        return out

    def bronze_imf(self, raw_path: Path, indicator: str = "cpi_yoy") -> Path:
        """Clean IMF fallback data into the bronze shape."""
        df = pl.read_parquet(raw_path)
        out = self.data_path / "bronze" / "imf.parquet"
        if df.height == 0:
            self._empty_bronze().write_parquet(out)
            return out
        clean = (
            df.filter(pl.col("value").is_not_null() & (pl.col("country_iso3") != ""))
            .with_columns(
                (pl.col("date").cast(pl.Utf8).str.slice(0, 4) + pl.lit("-12-31"))
                .str.strptime(pl.Date, "%Y-%m-%d", strict=False)
                .alias("obs_date"),
                pl.lit(indicator).alias("indicator"),
                pl.lit("A").alias("frequency"),
                pl.lit("percent").alias("unit"),
                pl.lit("imf").alias("source"),
                pl.col("value").cast(pl.Float64),
            )
            .select(
                "country_iso3", "indicator", "frequency", "obs_date",
                "value", "unit", "source", "fetched_at",
            )
            .unique(subset=["country_iso3", "indicator", "obs_date"])
        )
        clean.write_parquet(out, compression="zstd")
        return out

    # ==================================================================
    # Silver
    # ==================================================================

    def silver_merge(
        self,
        inflation_path: Path,
        rates_path: Path,
        imf_path: Path | None = None,
    ) -> Path:
        """Merge bronze frames into the unified ``macro_observations`` silver table."""
        frames = [pl.read_parquet(inflation_path), pl.read_parquet(rates_path)]
        if imf_path and Path(imf_path).exists():
            frames.append(pl.read_parquet(imf_path))
        frames = [f for f in frames if f.height]
        if not frames:
            out = self.data_path / "silver" / "macro_observations.parquet"
            self._empty_silver().write_parquet(out)
            return out

        df = pl.concat(frames, how="vertical_relaxed")

        # Enrichment maps from the catalog.
        names = {iso: c.get("name", iso) for iso, c in self._by_iso3.items()}
        regions = {iso: c.get("region", "") for iso, c in self._by_iso3.items()}

        vintage = date.today()
        df = (
            df.with_columns(
                pl.col("country_iso3").replace_strict(names, default=pl.col("country_iso3")).alias("country_name"),
                pl.col("country_iso3").replace_strict(regions, default=pl.lit("")).alias("region"),
                pl.lit(vintage).alias("vintage_date"),
                pl.lit(False).alias("is_preliminary"),
                pl.lit(None, dtype=pl.Utf8).alias("quality_flag"),
            )
            .sort(["source", "country_iso3", "indicator", "obs_date"])
            # prior_value & revision tracking via window over the ordered series
            .with_columns(
                pl.col("value")
                .shift(1)
                .over(["source", "country_iso3", "indicator"])
                .alias("prior_value")
            )
            .with_columns(pl.lit(None, dtype=pl.Float64).alias("revision_from"))
            .with_columns(
                pl.struct(["source", "country_iso3", "indicator", "obs_date"])
                .map_elements(
                    lambda s: self._observation_id(
                        s["source"], s["country_iso3"], s["indicator"],
                        str(s["obs_date"]), VINTAGE_DEFAULT,
                    ),
                    return_dtype=pl.Utf8,
                )
                .alias("observation_id")
            )
            .rename({"obs_date": "date"})
            .with_columns(pl.col("fetched_at").cast(pl.Utf8))
            .select(
                "observation_id", "source", "country_iso3", "country_name", "region",
                "indicator", "frequency", "date", "value", "unit", "prior_value",
                "revision_from", "vintage_date", "is_preliminary", "fetched_at",
                "quality_flag",
            )
            .unique(subset=["observation_id"], keep="last")
        )

        out = self.data_path / "silver" / "macro_observations.parquet"
        df.write_parquet(out, compression="zstd")
        logger.info("silver_merge: %d observations -> %s", df.height, out)
        return out

    @staticmethod
    def _observation_id(
        source: str, country: str, indicator: str, date_str: str, vintage: str
    ) -> str:
        """Deterministic 16-hex id for dedupe/upsert."""
        key = f"{source}|{country}|{indicator}|{date_str}|{vintage}"
        return hashlib.sha256(key.encode()).hexdigest()[:16]

    # ==================================================================
    # Gold
    # ==================================================================

    def gold_country_latest(self, silver_path: Path) -> Path:
        """One row per country: latest CPI + policy rate with trend/streak/real rate."""
        df = pl.read_parquet(silver_path)
        out = self.data_path / "gold" / "country_macro_latest.parquet"
        if df.height == 0:
            self._empty_gold_latest().write_parquet(out)
            return out

        cpi = self._latest_with_trend(df, "cpi_yoy", prefer_source="world_bank")
        rate = self._latest_with_trend(df, "policy_rate", prefer_source="bis")

        cpi = cpi.rename(
            {"value": "cpi_yoy", "prior": "cpi_prior", "trend": "cpi_trend",
             "streak": "cpi_streak", "date": "cpi_date"}
        )
        rate = rate.rename(
            {"value": "policy_rate", "prior": "rate_prior", "trend": "rate_cycle",
             "streak": "rate_streak", "date": "rate_date"}
        ).select(["country_iso3", "policy_rate", "rate_prior", "rate_cycle", "rate_streak", "rate_date"])

        merged = cpi.join(rate, on="country_iso3", how="full", coalesce=True)

        # catalog enrichment: flag, name, region, target
        flags = {iso: c.get("flag", "") for iso, c in self._by_iso3.items()}
        names = {iso: c.get("name", iso) for iso, c in self._by_iso3.items()}
        regions = {iso: c.get("region", "") for iso, c in self._by_iso3.items()}
        targets = {
            iso: float(c.get("target_inflation") if c.get("target_inflation") is not None else 2.0)
            for iso, c in self._by_iso3.items()
        }

        merged = (
            merged.with_columns(
                pl.col("country_iso3").replace_strict(flags, default=pl.lit("")).alias("flag"),
                pl.col("country_iso3").replace_strict(names, default=pl.col("country_iso3")).alias("country_name"),
                pl.col("country_iso3").replace_strict(regions, default=pl.lit("")).alias("region"),
                pl.col("country_iso3").replace_strict(targets, default=pl.lit(2.0)).alias("target_inflation"),
            )
            .with_columns(
                (pl.col("policy_rate") - pl.col("cpi_yoy")).round(2).alias("real_rate"),
                (pl.col("cpi_yoy") - pl.col("target_inflation")).round(2).alias("vs_target"),
                pl.lit(datetime.now(timezone.utc).isoformat()).alias("last_updated"),
            )
            .sort("policy_rate", descending=True, nulls_last=True)
        )
        merged.write_parquet(out, compression="zstd")
        logger.info("gold_country_latest: %d countries -> %s", merged.height, out)
        return out

    def gold_inflation_timeseries(self, silver_path: Path) -> Path:
        """Wide CPI YoY timeseries: dates as rows, countries as columns."""
        return self._gold_wide(silver_path, "cpi_yoy", "inflation_timeseries.parquet")

    def gold_policy_rate_timeseries(self, silver_path: Path) -> Path:
        """Wide policy-rate timeseries for overlay charts."""
        return self._gold_wide(silver_path, "policy_rate", "policy_rate_timeseries.parquet")

    def gold_real_rates(self, silver_path: Path) -> Path:
        """Real policy rate (rate - inflation) per country × date.

        Inflation is annual; the latest available annual CPI is forward-filled
        onto the monthly policy-rate grid.
        """
        df = pl.read_parquet(silver_path)
        out = self.data_path / "gold" / "real_rates.parquet"
        if df.height == 0:
            pl.DataFrame(schema={"country_iso3": pl.Utf8, "date": pl.Date, "real_rate": pl.Float64}).write_parquet(out)
            return out

        rates = df.filter(pl.col("indicator") == "policy_rate").select(
            "country_iso3", "date", pl.col("value").alias("policy_rate")
        )
        cpi = (
            df.filter(pl.col("indicator") == "cpi_yoy")
            .select("country_iso3", pl.col("date").alias("cpi_date"), pl.col("value").alias("cpi_yoy"))
            .sort(["country_iso3", "cpi_date"])
        )
        if rates.height == 0 or cpi.height == 0:
            pl.DataFrame(schema={"country_iso3": pl.Utf8, "date": pl.Date, "real_rate": pl.Float64}).write_parquet(out)
            return out

        # as-of join: most recent annual CPI at/before each rate observation
        rates = rates.sort(["country_iso3", "date"])
        joined = rates.join_asof(
            cpi.sort(["country_iso3", "cpi_date"]),
            left_on="date",
            right_on="cpi_date",
            by="country_iso3",
            strategy="backward",
        ).with_columns((pl.col("policy_rate") - pl.col("cpi_yoy")).round(2).alias("real_rate"))
        joined.select("country_iso3", "date", "policy_rate", "cpi_yoy", "real_rate").write_parquet(
            out, compression="zstd"
        )
        logger.info("gold_real_rates: %d rows -> %s", joined.height, out)
        return out

    def gold_vintage_snapshots(self, silver_path: Path) -> Path:
        """Vintage tracking: every (series, date) with its vintage + revision delta."""
        df = pl.read_parquet(silver_path)
        out = self.data_path / "gold" / "vintage_snapshots.parquet"
        if df.height == 0:
            df.write_parquet(out)
            return out
        snap = df.select(
            "country_iso3", "indicator", "date", "value", "prior_value",
            "revision_from", "vintage_date", "source",
        ).with_columns(
            (pl.col("value") - pl.col("prior_value")).round(3).alias("change_from_prior")
        )
        snap.write_parquet(out, compression="zstd")
        return out

    def build_all_gold(self, silver_path: Path) -> dict[str, Path]:
        """Build the full gold layer from silver."""
        return {
            "country_macro_latest": self.gold_country_latest(silver_path),
            "inflation_timeseries": self.gold_inflation_timeseries(silver_path),
            "policy_rate_timeseries": self.gold_policy_rate_timeseries(silver_path),
            "real_rates": self.gold_real_rates(silver_path),
            "vintage_snapshots": self.gold_vintage_snapshots(silver_path),
        }

    # ==================================================================
    # Helpers
    # ==================================================================

    @staticmethod
    def _period_to_date(col: pl.Expr) -> pl.Expr:
        """Parse a BIS TIME_PERIOD (YYYY-MM or YYYY-MM-DD or YYYY) to a Date."""
        s = col.cast(pl.Utf8)
        return (
            pl.when(s.str.len_chars() == 7)
            .then((s + pl.lit("-01")).str.strptime(pl.Date, "%Y-%m-%d", strict=False))
            .when(s.str.len_chars() == 4)
            .then((s + pl.lit("-12-31")).str.strptime(pl.Date, "%Y-%m-%d", strict=False))
            .otherwise(s.str.strptime(pl.Date, "%Y-%m-%d", strict=False))
        )

    def _latest_with_trend(
        self, df: pl.DataFrame, indicator: str, prefer_source: str
    ) -> pl.DataFrame:
        """Per-country latest value + prior, trend label and consecutive streak."""
        sub = df.filter(pl.col("indicator") == indicator)
        if sub.height == 0:
            return pl.DataFrame(
                schema={
                    "country_iso3": pl.Utf8, "value": pl.Float64, "prior": pl.Float64,
                    "trend": pl.Utf8, "streak": pl.Int64, "date": pl.Date,
                }
            )
        # Prefer the canonical source where both exist.
        if prefer_source in sub["source"].unique().to_list():
            preferred = sub.filter(pl.col("source") == prefer_source)
            covered = preferred["country_iso3"].unique().to_list()
            extra = sub.filter(
                (pl.col("source") != prefer_source) & ~pl.col("country_iso3").is_in(covered)
            )
            sub = pl.concat([preferred, extra], how="vertical_relaxed")

        sub = sub.sort(["country_iso3", "date"])

        # direction of each step; streak counts consecutive same-direction steps.
        sub = sub.with_columns(
            (pl.col("value") - pl.col("value").shift(1).over("country_iso3")).alias("delta")
        ).with_columns(
            pl.when(pl.col("delta") > 0.05).then(1)
            .when(pl.col("delta") < -0.05).then(-1)
            .otherwise(0)
            .alias("dir")
        )

        rows = []
        for iso, g in sub.group_by("country_iso3", maintain_order=True):
            iso_code = iso[0] if isinstance(iso, tuple) else iso
            vals = g["value"].to_list()
            dirs = g["dir"].to_list()
            dates = g["date"].to_list()
            value = vals[-1]
            prior = vals[-2] if len(vals) >= 2 else None
            last_dir = dirs[-1] if dirs else 0
            trend = "RISING" if last_dir > 0 else "FALLING" if last_dir < 0 else "FLAT"
            streak = 0
            for d in reversed(dirs):
                if d == last_dir and last_dir != 0:
                    streak += 1
                else:
                    break
            rows.append(
                {
                    "country_iso3": iso_code,
                    "value": round(value, 3) if value is not None else None,
                    "prior": round(prior, 3) if prior is not None else None,
                    "trend": trend,
                    "streak": streak,
                    "date": dates[-1],
                }
            )
        return pl.DataFrame(rows)

    def _gold_wide(self, silver_path: Path, indicator: str, fname: str) -> Path:
        df = pl.read_parquet(silver_path)
        out = self.data_path / "gold" / fname
        sub = df.filter(pl.col("indicator") == indicator)
        if sub.height == 0:
            pl.DataFrame(schema={"date": pl.Date}).write_parquet(out)
            return out
        wide = (
            sub.select("date", "country_iso3", "value")
            .unique(subset=["date", "country_iso3"], keep="last")
            .pivot(values="value", index="date", on="country_iso3")
            .sort("date")
        )
        wide.write_parquet(out, compression="zstd")
        logger.info("%s: %d dates × %d countries", fname, wide.height, wide.width - 1)
        return out

    # ---- empty-frame factories -----------------------------------------

    @staticmethod
    def _empty_bronze() -> pl.DataFrame:
        return pl.DataFrame(
            schema={
                "country_iso3": pl.Utf8, "indicator": pl.Utf8, "frequency": pl.Utf8,
                "obs_date": pl.Date, "value": pl.Float64, "unit": pl.Utf8,
                "source": pl.Utf8, "fetched_at": pl.Utf8,
            }
        )

    @staticmethod
    def _empty_silver() -> pl.DataFrame:
        return pl.DataFrame(
            schema={
                "observation_id": pl.Utf8, "source": pl.Utf8, "country_iso3": pl.Utf8,
                "country_name": pl.Utf8, "region": pl.Utf8, "indicator": pl.Utf8,
                "frequency": pl.Utf8, "date": pl.Date, "value": pl.Float64,
                "unit": pl.Utf8, "prior_value": pl.Float64, "revision_from": pl.Float64,
                "vintage_date": pl.Date, "is_preliminary": pl.Boolean,
                "fetched_at": pl.Utf8, "quality_flag": pl.Utf8,
            }
        )

    @staticmethod
    def _empty_gold_latest() -> pl.DataFrame:
        return pl.DataFrame(
            schema={
                "country_iso3": pl.Utf8, "country_name": pl.Utf8, "region": pl.Utf8,
                "flag": pl.Utf8, "cpi_yoy": pl.Float64, "cpi_prior": pl.Float64,
                "cpi_trend": pl.Utf8, "cpi_streak": pl.Int64, "policy_rate": pl.Float64,
                "rate_prior": pl.Float64, "rate_cycle": pl.Utf8, "rate_streak": pl.Int64,
                "real_rate": pl.Float64, "vs_target": pl.Float64, "last_updated": pl.Utf8,
            }
        )
