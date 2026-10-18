"""Adapter for the existing FRED data pipeline."""

from __future__ import annotations

import logging
import os
from datetime import date
from typing import Optional

import polars as pl

logger = logging.getLogger(__name__)


class FredAdapter:
    """Bridge between Market Lens Studio and FRED data sources."""

    def __init__(self, store=None, api_key: Optional[str] = None):
        """Initialize with optional DuckDB store and FRED API key.

        Args:
            store: A DuckDBStore instance for reading cached normalized data.
            api_key: FRED API key. Falls back to FRED_API_KEY env var.
        """
        self._store = store
        self._api_key = api_key or os.environ.get("FRED_API_KEY", "")

    def fetch_series(
        self,
        fred_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        series_id: Optional[str] = None,
    ) -> tuple[list[date], list[float]]:
        """Fetch a FRED series as (dates, values) lists.

        Tries the DuckDB store first, falls back to direct FRED API fetch.
        """
        sid = series_id or fred_id

        # Try cached store first
        if self._store is not None:
            try:
                df = self._store.normalized(asset_classes=None)
                sub = df.filter(pl.col("series_id") == sid).sort("date")
                if start_date:
                    sub = sub.filter(pl.col("date") >= start_date)
                if end_date:
                    sub = sub.filter(pl.col("date") <= end_date)
                if sub.height > 0:
                    dates_col = sub["date"].to_list()
                    values_col = sub["value"].to_list()
                    pairs = [(d, v) for d, v in zip(dates_col, values_col) if v is not None]
                    if pairs:
                        return [p[0] for p in pairs], [p[1] for p in pairs]
            except Exception as exc:
                logger.warning("DuckDB store read failed for %s: %s", sid, exc)

        return self._fetch_fred_api(fred_id, start_date, end_date)

    def _fetch_fred_api(
        self,
        fred_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> tuple[list[date], list[float]]:
        """Fetch directly from the FRED API using httpx."""
        try:
            import httpx
        except ImportError:
            logger.error("httpx not installed.")
            return [], []

        if not self._api_key:
            logger.error("No FRED API key. Set FRED_API_KEY env var.")
            return [], []

        params: dict = {
            "series_id": fred_id,
            "api_key": self._api_key,
            "file_type": "json",
        }
        if start_date:
            params["observation_start"] = start_date.isoformat()
        if end_date:
            params["observation_end"] = end_date.isoformat()

        try:
            resp = httpx.get(
                "https://api.stlouisfed.org/fred/series/observations",
                params=params,
                timeout=30.0,
            )
            resp.raise_for_status()
            data = resp.json()
            observations = data.get("observations", [])
            dates_out: list[date] = []
            values_out: list[float] = []
            for obs in observations:
                try:
                    d = date.fromisoformat(obs["date"])
                    v_str = obs["value"]
                    if v_str == ".":
                        continue
                    v = float(v_str)
                    dates_out.append(d)
                    values_out.append(v)
                except (ValueError, KeyError):
                    continue
            return dates_out, values_out
        except Exception as exc:
            logger.error("FRED API fetch failed for %s: %s", fred_id, exc)
            return [], []

    def fetch_dataframe(
        self,
        fred_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        series_id: Optional[str] = None,
    ) -> pl.DataFrame:
        """Fetch as a polars DataFrame with date and value columns."""
        dates, values = self.fetch_series(fred_id, start_date, end_date, series_id)
        return pl.DataFrame({"date": dates, "value": values}).sort("date")
