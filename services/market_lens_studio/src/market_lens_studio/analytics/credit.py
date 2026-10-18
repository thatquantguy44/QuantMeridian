"""Credit spread stress analysis."""

from __future__ import annotations

import math
from datetime import date
from typing import Optional

import polars as pl

from .event_study import run_event_study


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


def compute_spread_percentiles(
    dates: list[date],
    values: list[float],
) -> pl.DataFrame:
    """Compute rolling percentile rank of credit spreads.

    Args:
        dates: Sorted dates.
        values: Spread values (e.g. HY OAS in bps).

    Returns:
        DataFrame with columns: date, spread, percentile_rank.
    """
    if not dates or not values:
        return pl.DataFrame({"date": [], "spread": [], "percentile_rank": []})

    n = len(values)
    ranks: list[Optional[float]] = []

    for i in range(n):
        # Use all history up to this point
        history = values[:i + 1]
        if len(history) < 2:
            ranks.append(None)
            continue
        current = values[i]
        below = sum(1 for h in history if h <= current)
        ranks.append(_safe_round(below / len(history), 4))

    return pl.DataFrame({
        "date": dates,
        "spread": values,
        "percentile_rank": ranks,
    })


def detect_spread_widening(
    dates: list[date],
    values: list[float],
    percentile_threshold: float = 90.0,
    cooldown_days: int = 20,
) -> tuple[list[date], list[float]]:
    """Detect credit spread widening events above a percentile.

    Args:
        dates: Sorted dates.
        values: Spread values.
        percentile_threshold: Percentile above which to trigger (e.g. 90).
        cooldown_days: Minimum days between events.

    Returns:
        Tuple of (event_dates, spread_at_event).
    """
    if not dates or not values:
        return [], []

    pct_df = compute_spread_percentiles(dates, values)
    ranks = pct_df["percentile_rank"].to_list()

    threshold = percentile_threshold / 100.0
    event_dates: list[date] = []
    event_values: list[float] = []
    last_event: Optional[date] = None

    for i, (d, v, r) in enumerate(zip(dates, values, ranks)):
        if r is None:
            continue
        if r >= threshold:
            if last_event is None or (d - last_event).days >= cooldown_days:
                event_dates.append(d)
                event_values.append(v)
                last_event = d

    return event_dates, event_values


def compute_spread_zscore(
    dates: list[date],
    values: list[float],
    lookback: int = 252,
) -> pl.DataFrame:
    """Compute rolling z-score of credit spreads.

    Args:
        dates: Sorted dates.
        values: Spread values.
        lookback: Rolling window for z-score calculation.

    Returns:
        DataFrame with columns: date, spread, zscore.
    """
    if not dates or not values:
        return pl.DataFrame({"date": [], "spread": [], "zscore": []})

    n = len(values)
    zscores: list[Optional[float]] = []

    for i in range(n):
        if i < lookback:
            zscores.append(None)
            continue
        window = values[i - lookback:i]
        s = pl.Series("w", window)
        mean = s.mean()
        std = s.std()
        if std is not None and std > 0 and mean is not None:
            z = (values[i] - mean) / std
            zscores.append(_safe_round(z, 4))
        else:
            zscores.append(None)

    return pl.DataFrame({
        "date": dates,
        "spread": values,
        "zscore": zscores,
    })


def run_credit_analysis(
    spread_dates: list[date],
    spread_values: list[float],
    equity_dates: list[date],
    equity_values: list[float],
    credit_etf_dates: list[date] | None = None,
    credit_etf_values: list[float] | None = None,
    forward_windows: list[int] | None = None,
    percentile_threshold: float = 90.0,
    cooldown_days: int = 20,
) -> dict:
    """Run full credit spread stress analysis.

    Args:
        spread_dates/values: Credit spread series (e.g. HY OAS).
        equity_dates/values: Equity return series.
        credit_etf_dates/values: Optional credit ETF series (e.g. HYG).
        forward_windows: Trading day windows.
        percentile_threshold: Threshold for stress events.
        cooldown_days: Cooldown between events.

    Returns:
        Dict with spread_analysis, stress_events, forward_returns, current_state.
    """
    if forward_windows is None:
        forward_windows = [21, 63, 126, 252]

    # Spread percentiles and z-scores
    pct_df = compute_spread_percentiles(spread_dates, spread_values)
    zscore_df = compute_spread_zscore(spread_dates, spread_values)

    # Detect stress events
    event_dates, event_spreads = detect_spread_widening(
        spread_dates, spread_values, percentile_threshold, cooldown_days
    )

    # Forward returns on equity after stress events
    equity_fwd: dict = {}
    if event_dates and equity_dates:
        date_to_idx = {d: i for i, d in enumerate(equity_dates)}
        event_indices = [date_to_idx[ed] for ed in event_dates if ed in date_to_idx]
        matched_spreads = [s for ed, s in zip(event_dates, event_spreads) if ed in date_to_idx]

        if event_indices:
            window_labels = [f"{w}D" for w in forward_windows]
            es_result = run_event_study(
                event_name="Spread Widening",
                dates=equity_dates,
                values=equity_values,
                event_indices=event_indices,
                window_days_list=forward_windows,
                window_labels=window_labels,
                cooldown_days=0,
            )
            events_table = []
            for j, spread_val in enumerate(matched_spreads):
                row = {
                    "date": es_result.event_dates[j].isoformat() if j < len(es_result.event_dates) else None,
                    "spread_at_event": _safe_round(spread_val, 2),
                }
                for wl in window_labels:
                    fwd_list = es_result.forward_returns.get(wl, [])
                    row[f"fwd_{wl}"] = fwd_list[j] if j < len(fwd_list) else None
                events_table.append(row)

            equity_fwd = {
                "events": events_table,
                "forward_stats": es_result.statistics,
                "baseline_stats": es_result.baselines,
                "sample_size": es_result.event_count,
            }

    # Forward returns on credit ETF
    credit_fwd: dict = {}
    if event_dates and credit_etf_dates and credit_etf_values:
        date_to_idx_c = {d: i for i, d in enumerate(credit_etf_dates)}
        event_indices_c = [date_to_idx_c[ed] for ed in event_dates if ed in date_to_idx_c]

        if event_indices_c:
            window_labels_c = [f"{w}D" for w in forward_windows]
            es_c = run_event_study(
                event_name="Spread Widening (Credit)",
                dates=credit_etf_dates,
                values=credit_etf_values,
                event_indices=event_indices_c,
                window_days_list=forward_windows,
                window_labels=window_labels_c,
                cooldown_days=0,
            )
            credit_fwd = {
                "forward_stats": es_c.statistics,
                "sample_size": es_c.event_count,
            }

    # Current state
    current_state: dict = {}
    if spread_values:
        current_state["current_spread"] = _safe_round(spread_values[-1], 2)
        ranks = pct_df["percentile_rank"].to_list()
        current_state["current_percentile"] = ranks[-1] if ranks else None
        zscores = zscore_df["zscore"].to_list()
        current_state["current_zscore"] = zscores[-1] if zscores else None
        s = pl.Series("s", spread_values)
        current_state["historical_mean"] = _safe_round(s.mean(), 2)
        current_state["historical_median"] = _safe_round(s.median(), 2)
        current_state["historical_min"] = _safe_round(s.min(), 2)
        current_state["historical_max"] = _safe_round(s.max(), 2)

    return {
        "spread_series": {
            "dates": [d.isoformat() for d in spread_dates],
            "spreads": spread_values,
            "percentile_ranks": pct_df["percentile_rank"].to_list(),
            "zscores": zscore_df["zscore"].to_list(),
        },
        "stress_events": {
            "threshold_percentile": percentile_threshold,
            "event_count": len(event_dates),
            "event_dates": [d.isoformat() for d in event_dates],
        },
        "equity_forward_returns": equity_fwd,
        "credit_forward_returns": credit_fwd,
        "current_state": current_state,
    }
