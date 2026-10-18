"""Generic event study framework with cooldown deduplication."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Optional, Sequence
import math

from .returns import compute_forward_returns, unconditional_baseline


def _finite(x: Optional[float]) -> Optional[float]:
    if x is None:
        return None
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(xf) or math.isinf(xf):
        return None
    return xf


@dataclass
class EventStudyResult:
    event_name: str
    event_dates: list[date]
    event_count: int
    forward_windows: list[int]  # trading days
    window_labels: list[str]
    forward_returns: dict[str, list[Optional[float]]]
    statistics: dict[str, dict[str, Optional[float]]]
    baselines: dict[str, dict[str, Optional[float]]]
    sample_size_warnings: list[str] = field(default_factory=list)


def deduplicate_events(
    event_indices: list[int],
    cooldown_days: int,
) -> list[int]:
    """Remove events that fall within cooldown_days of a prior event."""
    if cooldown_days <= 0 or not event_indices:
        return list(event_indices)

    sorted_events = sorted(event_indices)
    deduped = [sorted_events[0]]
    for idx in sorted_events[1:]:
        if idx - deduped[-1] >= cooldown_days:
            deduped.append(idx)
    return deduped


def _compute_stats(returns: list[Optional[float]]) -> dict[str, Optional[float]]:
    """Compute summary statistics for a set of returns."""
    clean = [r for r in returns if r is not None]
    if not clean:
        return {"mean": None, "median": None, "pct_positive": None, "count": 0, "min": None, "max": None}

    clean_sorted = sorted(clean)
    n = len(clean_sorted)
    mean_val = sum(clean_sorted) / n
    pct_pos = sum(1 for r in clean_sorted if r >= 0) / n

    if n % 2 == 0:
        median_val = (clean_sorted[n // 2 - 1] + clean_sorted[n // 2]) / 2
    else:
        median_val = clean_sorted[n // 2]

    return {
        "mean": _finite(mean_val),
        "median": _finite(median_val),
        "pct_positive": _finite(pct_pos),
        "count": n,
        "min": _finite(clean_sorted[0]),
        "max": _finite(clean_sorted[-1]),
    }


def run_event_study(
    event_name: str,
    dates: Sequence[date],
    values: Sequence[float],
    event_indices: list[int],
    window_days_list: list[int],
    window_labels: list[str],
    cooldown_days: int = 5,
) -> EventStudyResult:
    """Run a full event study: forward returns at multiple windows with baselines."""
    deduped = deduplicate_events(event_indices, cooldown_days)
    event_dates_list = [dates[i] for i in deduped if i < len(dates)]

    forward_returns: dict[str, list[Optional[float]]] = {}
    statistics: dict[str, dict[str, Optional[float]]] = {}
    baselines: dict[str, dict[str, Optional[float]]] = {}
    warnings: list[str] = []

    for wd, label in zip(window_days_list, window_labels):
        fwd = compute_forward_returns(dates, values, deduped, wd)
        forward_returns[label] = fwd
        statistics[label] = _compute_stats(fwd)
        baselines[label] = unconditional_baseline(values, wd)

        n_valid = sum(1 for r in fwd if r is not None)
        if n_valid < 10:
            warnings.append(f"Small sample size for {label}: only {n_valid} valid observations")

    return EventStudyResult(
        event_name=event_name,
        event_dates=event_dates_list,
        event_count=len(deduped),
        forward_windows=window_days_list,
        window_labels=window_labels,
        forward_returns=forward_returns,
        statistics=statistics,
        baselines=baselines,
        sample_size_warnings=warnings,
    )
