"""VIX spike detection and panic regime analysis."""

from __future__ import annotations

import math
from datetime import date
from typing import Optional, Sequence

from .event_study import run_event_study, EventStudyResult


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


def detect_vix_spikes(
    dates: Sequence[date],
    vix_values: Sequence[float],
    threshold: float = 30.0,
    cooldown_days: int = 5,
) -> list[int]:
    """Detect days where VIX crosses above the threshold."""
    if not vix_values:
        return []

    events = []
    last_event = -cooldown_days - 1
    prev_below = True

    for i, v in enumerate(vix_values):
        if v is None:
            continue
        if v >= threshold and prev_below and (i - last_event >= cooldown_days):
            events.append(i)
            last_event = i
        prev_below = v < threshold

    return events


def vix_spike_study(
    dates: Sequence[date],
    vix_values: Sequence[float],
    asset_values: Sequence[float],
    threshold: float = 30.0,
    window_days_list: list[int] = None,
    window_labels: list[str] = None,
    cooldown_days: int = 5,
) -> EventStudyResult:
    """Event study: what happens to assets when VIX spikes above threshold?"""
    if window_days_list is None:
        window_days_list = [5, 21, 63, 126, 252]
    if window_labels is None:
        window_labels = ["1W", "1M", "3M", "6M", "1Y"]

    events = detect_vix_spikes(dates, vix_values, threshold, cooldown_days)
    return run_event_study(
        event_name=f"VIX Spike Above {threshold}",
        dates=dates,
        values=asset_values,
        event_indices=events,
        window_days_list=window_days_list,
        window_labels=window_labels,
        cooldown_days=0,
    )


def panic_regime_detection(
    vix_values: Sequence[float],
    thresholds: tuple[float, float, float] = (20.0, 30.0, 40.0),
) -> list[str]:
    """Classify each observation into a volatility regime.

    Returns list of regime labels: 'LOW', 'MODERATE', 'HIGH', 'PANIC'.
    """
    low, med, high = thresholds
    regimes = []
    for v in vix_values:
        if v is None:
            regimes.append("UNKNOWN")
        elif v < low:
            regimes.append("LOW")
        elif v < med:
            regimes.append("MODERATE")
        elif v < high:
            regimes.append("HIGH")
        else:
            regimes.append("PANIC")
    return regimes


def run_panic_study(
    vix_dates: Sequence[date],
    vix_values: Sequence[float],
    equity_dates: Sequence[date],
    equity_values: Sequence[float],
    forward_windows: list[int],
    percentile_threshold: float = 95.0,
    cooldown_days: int = 10,
) -> dict:
    """Run panic/high-vol event study with forward equity returns."""
    clean_vix = sorted([v for v in vix_values if v is not None])
    if not clean_vix:
        return {"panic_events": [], "forward_stats": {}, "baseline_stats": {}, "distribution": {}}

    pct_idx = int(percentile_threshold / 100 * (len(clean_vix) - 1))
    threshold = clean_vix[min(pct_idx, len(clean_vix) - 1)]

    window_labels = [f"{w}D" for w in forward_windows]
    es = vix_spike_study(
        vix_dates, vix_values, equity_values,
        threshold, forward_windows, window_labels, cooldown_days,
    )

    events = []
    for i, ed in enumerate(es.event_dates):
        idx = next((j for j, d in enumerate(vix_dates) if d == ed), None)
        row = {"date": ed.isoformat(), "vix_level": vix_values[idx] if idx is not None else None}
        for wl in es.window_labels:
            fwd_list = es.forward_returns.get(wl, [])
            row[f"fwd_{wl}"] = fwd_list[i] if i < len(fwd_list) else None
        events.append(row)

    return {
        "panic_events": events,
        "threshold": threshold,
        "forward_stats": es.statistics,
        "baseline_stats": es.baselines,
        "distribution": es.forward_returns,
        "sample_size": es.event_count,
    }


def rolling_volatility(
    values: Sequence[float],
    window: int = 21,
) -> list[Optional[float]]:
    """Rolling annualized volatility of log returns."""
    if not values or len(values) < window + 1:
        return []

    log_rets = []
    for i in range(1, len(values)):
        if values[i] is None or values[i - 1] is None or values[i - 1] <= 0 or values[i] <= 0:
            log_rets.append(None)
        else:
            log_rets.append(math.log(values[i] / values[i - 1]))

    out = [None] * (window)
    for i in range(window, len(log_rets)):
        w = log_rets[i - window:i]
        clean = [r for r in w if r is not None]
        if len(clean) < window // 2:
            out.append(None)
            continue
        mean = sum(clean) / len(clean)
        var = sum((r - mean) ** 2 for r in clean) / (len(clean) - 1)
        ann_vol = math.sqrt(var * 252)
        out.append(_finite(ann_vol))

    return out
