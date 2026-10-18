"""All-time high detection and forward return analysis."""

from __future__ import annotations

from datetime import date
from typing import Optional, Sequence

from .event_study import run_event_study, EventStudyResult


def detect_all_time_highs(
    dates: Sequence[date],
    values: Sequence[float],
    cooldown_days: int = 5,
) -> list[int]:
    """Return indices where the value sets a new all-time high.

    Applies cooldown deduplication to avoid clustering.
    """
    if not values:
        return []

    ath_indices = []
    running_max = float("-inf")
    last_event_idx = -cooldown_days - 1

    for i, v in enumerate(values):
        if v is None:
            continue
        if v > running_max:
            running_max = v
            if i - last_event_idx >= cooldown_days:
                ath_indices.append(i)
                last_event_idx = i

    return ath_indices


def ath_forward_returns(
    dates: Sequence[date],
    values: Sequence[float],
    window_days_list: list[int],
    window_labels: list[str],
    cooldown_days: int = 5,
) -> EventStudyResult:
    """Complete event study: what happens after new all-time highs?"""
    events = detect_all_time_highs(dates, values, cooldown_days)
    return run_event_study(
        event_name="All-Time High",
        dates=dates,
        values=values,
        event_indices=events,
        window_days_list=window_days_list,
        window_labels=window_labels,
        cooldown_days=0,  # already deduped
    )


def ath_frequency(
    dates: Sequence[date],
    values: Sequence[float],
) -> dict[int, int]:
    """Count all-time highs per calendar year."""
    if not dates or not values:
        return {}

    counts: dict[int, int] = {}
    running_max = float("-inf")

    for d, v in zip(dates, values):
        if v is None:
            continue
        if v > running_max:
            running_max = v
            year = d.year
            counts[year] = counts.get(year, 0) + 1

    return counts


def run_ath_analysis(
    dates: Sequence[date],
    values: Sequence[float],
    forward_windows: list[int],
    cooldown_days: int = 5,
) -> dict:
    """Run complete all-time high analysis."""
    window_labels = [f"{w}D" for w in forward_windows]
    es = ath_forward_returns(dates, values, forward_windows, window_labels, cooldown_days)
    freq = ath_frequency(dates, values)

    return {
        "count_by_year": freq,
        "event_study": {
            "event_name": es.event_name,
            "event_count": es.event_count,
            "forward_returns": es.forward_returns,
            "statistics": es.statistics,
            "baselines": es.baselines,
        },
        "forward_return_comparison": {
            "windows": es.window_labels,
            "event_stats": es.statistics,
            "baseline_stats": es.baselines,
        },
        "sample_size": es.event_count,
    }
