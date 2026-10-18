"""Source lineage tracking for data provenance."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional


@dataclass
class LineageRecord:
    """Records the provenance of a data series used in analysis."""

    series_id: str
    source: str
    ticker: str
    fetch_timestamp: datetime = field(default_factory=datetime.utcnow)
    date_range_start: Optional[date] = None
    date_range_end: Optional[date] = None
    row_count: int = 0
    is_proxy: bool = False
    proxy_for: str = ""
    proxy_note: str = ""
    cache_hit: bool = False


class LineageTracker:
    """Tracks data lineage across an analysis run."""

    def __init__(self):
        self._records: list[LineageRecord] = []

    def record(
        self,
        series_id: str,
        source: str,
        ticker: str,
        dates: list[date],
        is_proxy: bool = False,
        proxy_for: str = "",
        proxy_note: str = "",
        cache_hit: bool = False,
    ) -> LineageRecord:
        """Record a data fetch event."""
        rec = LineageRecord(
            series_id=series_id,
            source=source,
            ticker=ticker,
            date_range_start=min(dates) if dates else None,
            date_range_end=max(dates) if dates else None,
            row_count=len(dates),
            is_proxy=is_proxy,
            proxy_for=proxy_for,
            proxy_note=proxy_note,
            cache_hit=cache_hit,
        )
        self._records.append(rec)
        return rec

    def get_records(self) -> list[LineageRecord]:
        """Return all lineage records."""
        return list(self._records)

    def get_warnings(self) -> list[str]:
        """Generate warnings from lineage records."""
        warnings: list[str] = []
        for rec in self._records:
            if rec.is_proxy and rec.proxy_note:
                warnings.append(f"[Proxy] {rec.series_id}: {rec.proxy_note}")
            if rec.row_count == 0:
                warnings.append(f"[No Data] {rec.series_id}: no data points retrieved")
            elif rec.row_count < 252:
                warnings.append(
                    f"[Short History] {rec.series_id}: only {rec.row_count} data points "
                    f"(~{rec.row_count // 252} years)"
                )
        return warnings

    def summary(self) -> dict:
        """Produce a summary dict of all lineage records."""
        return {
            "series_count": len(self._records),
            "sources_used": list({r.source for r in self._records}),
            "proxies_used": [
                {"series_id": r.series_id, "proxy_for": r.proxy_for}
                for r in self._records if r.is_proxy
            ],
            "total_data_points": sum(r.row_count for r in self._records),
            "records": [
                {
                    "series_id": r.series_id,
                    "source": r.source,
                    "ticker": r.ticker,
                    "rows": r.row_count,
                    "start": r.date_range_start.isoformat() if r.date_range_start else None,
                    "end": r.date_range_end.isoformat() if r.date_range_end else None,
                    "is_proxy": r.is_proxy,
                }
                for r in self._records
            ],
        }

    def clear(self):
        """Clear all lineage records."""
        self._records.clear()
