"""Largest VIX increase/decrease event studies with configurable change periods."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Optional, Sequence

from .event_study import run_event_study, EventStudyResult


class VixChangePeriod(str, Enum):
    ONE_DAY = "1D"
    ONE_WEEK = "1W"
    TWO_WEEKS = "2W"
    ONE_MONTH = "1M"
    THREE_MONTHS = "3M"

    @property
    def trading_days(self) -> int:
        return {"1D": 1, "1W": 5, "2W": 10, "1M": 21, "3M": 63}[self.value]


@dataclass
class VixChangeEvent:
    index: int
    event_date: date
    vix_start: float
    vix_end: float
    change_pct: float
    change_points: float


def largest_vix_changes(
    dates: Sequence[date],
    vix_values: Sequence[float],
    change_window_days: int = 5,
    top_n: int = 20,
    direction: str = "increase",
    cooldown_days: int = 10,
) -> list[VixChangeEvent]:
    """Find the N largest VIX increases or decreases over a rolling window.

    direction: 'increase' or 'decrease'
    """
    if not vix_values or len(vix_values) <= change_window_days:
        return []

    changes: list[VixChangeEvent] = []
    for i in range(change_window_days, len(vix_values)):
        start_val = vix_values[i - change_window_days]
        end_val = vix_values[i]
        if start_val is None or end_val is None or start_val == 0:
            continue

        change_pct = (end_val - start_val) / start_val
        change_pts = end_val - start_val

        changes.append(VixChangeEvent(
            index=i,
            event_date=dates[i],
            vix_start=start_val,
            vix_end=end_val,
            change_pct=change_pct,
            change_points=change_pts,
        ))

    if direction == "increase":
        changes.sort(key=lambda e: e.change_pct, reverse=True)
    else:
        changes.sort(key=lambda e: e.change_pct)

    # Apply cooldown deduplication
    deduped: list[VixChangeEvent] = []
    for evt in changes:
        too_close = any(abs(evt.index - d.index) < cooldown_days for d in deduped)
        if not too_close:
            deduped.append(evt)
        if len(deduped) >= top_n:
            break

    return deduped


def vix_event_forward_returns(
    dates: Sequence[date],
    vix_values: Sequence[float],
    asset_values: Sequence[float],
    change_window_days: int = 5,
    top_n: int = 20,
    direction: str = "increase",
    forward_window_days: list[int] = None,
    forward_labels: list[str] = None,
    cooldown_days: int = 10,
) -> tuple[list[VixChangeEvent], EventStudyResult]:
    """Full event study: find largest VIX changes, then measure asset forward returns."""
    if forward_window_days is None:
        forward_window_days = [5, 21, 63, 126, 252]
    if forward_labels is None:
        forward_labels = ["1W", "1M", "3M", "6M", "1Y"]

    events = largest_vix_changes(dates, vix_values, change_window_days, top_n, direction, cooldown_days)
    event_indices = [e.index for e in events]

    label = f"Top {top_n} VIX {'Increases' if direction == 'increase' else 'Decreases'} ({change_window_days}D)"

    result = run_event_study(
        event_name=label,
        dates=dates,
        values=asset_values,
        event_indices=event_indices,
        window_days_list=forward_window_days,
        window_labels=forward_labels,
        cooldown_days=0,
    )

    return events, result


def _vix_study_to_dict(
    events: list[VixChangeEvent],
    es: EventStudyResult,
) -> dict:
    """Convert VIX event study results to a response dict."""
    event_table = [
        {
            "date": e.event_date.isoformat(),
            "vix_start": e.vix_start,
            "vix_end": e.vix_end,
            "change_pct": e.change_pct,
            "change_points": e.change_points,
        }
        for e in events
    ]
    return {
        "event_table": event_table,
        "forward_stats": es.statistics,
        "baseline_stats": es.baselines,
        "distribution": es.forward_returns,
        "sample_size": es.event_count,
    }


def run_vix_increase_study(
    vix_dates: Sequence[date],
    vix_values: Sequence[float],
    eq_dates: Sequence[date],
    eq_values: Sequence[float],
    period: VixChangePeriod,
    top_n: int = 20,
    forward_windows: list[int] = None,
    cooldown_days: int = 10,
) -> dict:
    """Run largest VIX increases event study."""
    if forward_windows is None:
        forward_windows = [5, 21, 63, 126, 252]
    window_labels = [f"{w}D" for w in forward_windows]
    events, es = vix_event_forward_returns(
        vix_dates, vix_values, eq_values,
        period.trading_days, top_n, "increase",
        forward_windows, window_labels, cooldown_days,
    )
    return _vix_study_to_dict(events, es)


def run_vix_decrease_study(
    vix_dates: Sequence[date],
    vix_values: Sequence[float],
    eq_dates: Sequence[date],
    eq_values: Sequence[float],
    period: VixChangePeriod,
    top_n: int = 20,
    forward_windows: list[int] = None,
    cooldown_days: int = 21,
) -> dict:
    """Run largest VIX decreases event study."""
    if forward_windows is None:
        forward_windows = [5, 21, 63, 126, 252]
    window_labels = [f"{w}D" for w in forward_windows]
    events, es = vix_event_forward_returns(
        vix_dates, vix_values, eq_values,
        period.trading_days, top_n, "decrease",
        forward_windows, window_labels, cooldown_days,
    )
    return _vix_study_to_dict(events, es)
