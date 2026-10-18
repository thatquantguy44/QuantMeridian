"""Yield curve analysis and Fed rate path tracking."""

from __future__ import annotations

import math
from datetime import date
from typing import Optional, Sequence

import polars as pl

from .event_study import run_event_study
from .returns import compute_forward_returns, unconditional_baseline


def _safe_round(x, ndigits=4):
    if x is None:
        return None
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(xf) or math.isinf(xf):
        return None
    return round(xf, ndigits)


def compute_yield_spread(
    dates_long: list[date],
    values_long: list[float],
    dates_short: list[date],
    values_short: list[float],
) -> pl.DataFrame:
    """Compute yield spread between long and short rates.

    Args:
        dates_long: Dates for long-term rate (e.g. 10Y).
        values_long: Long-term rate values.
        dates_short: Dates for short-term rate (e.g. 2Y).
        values_short: Short-term rate values.

    Returns:
        DataFrame with columns: date, long_rate, short_rate, spread.
    """
    if not dates_long or not dates_short:
        return pl.DataFrame({"date": [], "long_rate": [], "short_rate": [], "spread": []})

    long_df = pl.DataFrame({"date": dates_long, "long_rate": values_long}).sort("date")
    short_df = pl.DataFrame({"date": dates_short, "short_rate": values_short}).sort("date")

    merged = long_df.join_asof(short_df, on="date", strategy="backward")
    merged = merged.filter(pl.col("short_rate").is_not_null())

    return merged.with_columns(
        (pl.col("long_rate") - pl.col("short_rate")).round(4).alias("spread")
    )


def detect_inversions(
    dates: list[date],
    spread_values: list[float],
    cooldown_days: int = 30,
) -> list[dict]:
    """Detect yield curve inversions (spread goes negative).

    Args:
        dates: Sorted dates.
        spread_values: Spread values (e.g. 10Y-2Y).
        cooldown_days: Minimum days between inversion events.

    Returns:
        List of dicts with inversion_start, inversion_end, min_spread, duration_days.
    """
    if not dates or not spread_values:
        return []

    inversions: list[dict] = []
    in_inversion = False
    start_date: Optional[date] = None
    min_spread = 0.0

    for i, (d, s) in enumerate(zip(dates, spread_values)):
        if s < 0 and not in_inversion:
            in_inversion = True
            start_date = d
            min_spread = s
        elif s < 0 and in_inversion:
            if s < min_spread:
                min_spread = s
        elif s >= 0 and in_inversion:
            in_inversion = False
            inversions.append({
                "inversion_start": start_date.isoformat(),
                "inversion_end": d.isoformat(),
                "min_spread": _safe_round(min_spread, 4),
                "duration_days": (d - start_date).days if start_date else 0,
            })
            start_date = None
            min_spread = 0.0

    # Handle ongoing inversion
    if in_inversion and start_date:
        inversions.append({
            "inversion_start": start_date.isoformat(),
            "inversion_end": None,
            "min_spread": _safe_round(min_spread, 4),
            "duration_days": (dates[-1] - start_date).days,
        })

    return inversions


def detect_rate_changes(
    dates: list[date],
    values: list[float],
    threshold: float = -0.25,
    cooldown_days: int = 30,
) -> tuple[list[date], list[float], list[str]]:
    """Detect Fed rate cuts or hikes.

    A rate cut is detected when the rate drops by at least |threshold|.
    A rate hike is when the rate increases by at least |threshold|.

    Args:
        dates: Sorted dates for fed funds rate.
        values: Rate values.
        threshold: Negative for cuts, positive for hikes.
        cooldown_days: Minimum days between events.

    Returns:
        Tuple of (event_dates, rate_at_event, event_labels).
    """
    if not dates or len(dates) < 2:
        return [], [], []

    event_dates: list[date] = []
    event_values: list[float] = []
    event_labels: list[str] = []
    last_event: Optional[date] = None

    is_cut = threshold < 0

    for i in range(1, len(dates)):
        change = values[i] - values[i - 1]
        if is_cut and change <= threshold:
            triggered = True
        elif not is_cut and change >= threshold:
            triggered = True
        else:
            triggered = False

        if triggered:
            if last_event is None or (dates[i] - last_event).days >= cooldown_days:
                event_dates.append(dates[i])
                event_values.append(values[i])
                label = f"{'Cut' if is_cut else 'Hike'} {abs(change)*100:.0f}bps to {values[i]:.2f}%"
                event_labels.append(label)
                last_event = dates[i]

    return event_dates, event_values, event_labels


def run_rate_analysis(
    fed_dates: list[date],
    fed_values: list[float],
    long_dates: list[date],
    long_values: list[float],
    short_dates: list[date],
    short_values: list[float],
    equity_dates: list[date],
    equity_values: list[float],
    forward_windows: list[int],
    rate_change_threshold: float = -0.25,
    cooldown_days: int = 30,
) -> dict:
    """Run comprehensive rate and yield curve analysis.

    Args:
        fed_dates/values: Fed funds rate series.
        long_dates/values: Long-term yield (e.g. 10Y).
        short_dates/values: Short-term yield (e.g. 2Y).
        equity_dates/values: Equity series for forward returns.
        forward_windows: Trading day windows.
        rate_change_threshold: Threshold for rate change detection.
        cooldown_days: Cooldown between events.

    Returns:
        Dict with spread_series, inversions, rate_events, forward_returns.
    """
    # Yield spread
    spread_df = compute_yield_spread(long_dates, long_values, short_dates, short_values)
    spread_dates = spread_df["date"].to_list() if spread_df.height > 0 else []
    spread_vals = spread_df["spread"].to_list() if spread_df.height > 0 else []

    # Inversions
    inversions = detect_inversions(spread_dates, spread_vals, cooldown_days)

    # Rate change events
    event_dates, event_vals, event_labels = detect_rate_changes(
        fed_dates, fed_values, rate_change_threshold, cooldown_days
    )

    # Forward returns after rate events
    fwd_result: dict = {}
    if event_dates and equity_dates:
        date_to_idx = {d: i for i, d in enumerate(equity_dates)}
        event_indices = []
        matched_vals = []
        matched_labels = []
        for ed, ev, el in zip(event_dates, event_vals, event_labels):
            if ed in date_to_idx:
                event_indices.append(date_to_idx[ed])
                matched_vals.append(ev)
                matched_labels.append(el)

        if event_indices:
            window_labels = [f"{w}D" for w in forward_windows]
            es_result = run_event_study(
                event_name="Rate Change",
                dates=equity_dates,
                values=equity_values,
                event_indices=event_indices,
                window_days_list=forward_windows,
                window_labels=window_labels,
                cooldown_days=0,
            )

            events_table = []
            for j, (ev, el) in enumerate(zip(matched_vals, matched_labels)):
                row = {
                    "date": es_result.event_dates[j].isoformat() if j < len(es_result.event_dates) else None,
                    "rate": _safe_round(ev, 2),
                    "label": el,
                }
                for wl in window_labels:
                    fwd_list = es_result.forward_returns.get(wl, [])
                    row[f"fwd_{wl}"] = fwd_list[j] if j < len(fwd_list) else None
                events_table.append(row)

            fwd_result = {
                "events": events_table,
                "forward_stats": es_result.statistics,
                "baseline_stats": es_result.baselines,
                "sample_size": es_result.event_count,
            }

    # Current state
    current_state = {}
    if fed_values:
        current_state["fed_funds_rate"] = _safe_round(fed_values[-1], 2)
    if spread_vals:
        current_state["current_spread"] = _safe_round(spread_vals[-1], 4)
        current_state["is_inverted"] = spread_vals[-1] < 0

    return {
        "spread_series": {
            "dates": [d.isoformat() for d in spread_dates],
            "spreads": spread_vals,
        },
        "inversions": inversions,
        "rate_event_study": fwd_result,
        "current_state": current_state,
    }
