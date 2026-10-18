"""Return computation: forward returns, rolling returns, unconditional baselines."""

from __future__ import annotations

import math
from datetime import date
from typing import Optional, Sequence


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


def compute_forward_returns(
    dates: Sequence[date],
    values: Sequence[float],
    event_indices: list[int],
    window_days: int,
) -> list[Optional[float]]:
    """Compute forward returns for each event index over a window.

    Returns a list of decimal returns (or None if not enough forward data).
    """
    results = []
    n = len(values)
    for idx in event_indices:
        end_idx = idx + window_days
        if end_idx >= n or idx < 0:
            results.append(None)
            continue
        base = values[idx]
        end_val = values[end_idx]
        if base is None or end_val is None or base == 0:
            results.append(None)
        else:
            results.append(_finite(end_val / base - 1.0))
    return results


def compute_rolling_returns(
    values: Sequence[float],
    window_days: int,
) -> list[Optional[float]]:
    """Rolling returns over a fixed observation window."""
    if not values or window_days <= 0:
        return []
    out = []
    for i in range(window_days, len(values)):
        base = values[i - window_days]
        cur = values[i]
        if base is None or cur is None or base == 0:
            out.append(None)
        else:
            out.append(_finite(cur / base - 1.0))
    return out


def unconditional_baseline(
    values: Sequence[float],
    window_days: int,
) -> dict[str, Optional[float]]:
    """Compute unconditional baseline statistics for a given window.

    Returns median, mean, pct_positive, 25th and 75th percentiles of
    all rolling returns.
    """
    rolls = [r for r in compute_rolling_returns(values, window_days) if r is not None]
    if not rolls:
        return {"median": None, "mean": None, "pct_positive": None, "p25": None, "p75": None, "count": 0}

    rolls_sorted = sorted(rolls)
    n = len(rolls_sorted)
    mean_val = sum(rolls_sorted) / n
    pct_pos = sum(1 for r in rolls_sorted if r >= 0) / n

    def _percentile(arr: list[float], q: float) -> float:
        pos = q * (len(arr) - 1)
        lo = int(math.floor(pos))
        hi = int(math.ceil(pos))
        if lo == hi:
            return arr[lo]
        frac = pos - lo
        return arr[lo] * (1 - frac) + arr[hi] * frac

    return {
        "median": _finite(_percentile(rolls_sorted, 0.5)),
        "mean": _finite(mean_val),
        "pct_positive": _finite(pct_pos),
        "p25": _finite(_percentile(rolls_sorted, 0.25)),
        "p75": _finite(_percentile(rolls_sorted, 0.75)),
        "count": n,
    }


def annualized_return(values: Sequence[float], years: float) -> Optional[float]:
    """CAGR from first to last value over the given year span."""
    if not values or years <= 0:
        return None
    first = values[0]
    last = values[-1]
    if first is None or last is None or first <= 0 or last <= 0:
        return None
    growth = last / first
    if growth <= 0:
        return None
    return _finite(growth ** (1.0 / years) - 1.0)


def excess_return(
    asset_values: Sequence[float],
    benchmark_values: Sequence[float],
    window_days: int,
) -> list[Optional[float]]:
    """Rolling excess returns (asset - benchmark) over a window."""
    n = min(len(asset_values), len(benchmark_values))
    if n <= window_days:
        return []
    out = []
    for i in range(window_days, n):
        ab = asset_values[i - window_days]
        ae = asset_values[i]
        bb = benchmark_values[i - window_days]
        be = benchmark_values[i]
        if any(v is None or v == 0 for v in [ab, ae, bb, be]):
            out.append(None)
        else:
            ar = ae / ab - 1.0
            br = be / bb - 1.0
            out.append(_finite(ar - br))
    return out
