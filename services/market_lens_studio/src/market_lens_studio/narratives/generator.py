"""Narrative text generation for Market Lens Studio analyses."""

from __future__ import annotations

from datetime import date
from typing import Any, Optional

from .caveats import format_caveats, get_applicable_caveats


def _pct(value: Any) -> str:
    """Format a value as a percentage string."""
    if value is None:
        return "N/A"
    try:
        return f"{float(value):.1%}"
    except (TypeError, ValueError):
        return "N/A"


def _num(value: Any, decimals: int = 2) -> str:
    """Format a number with fixed decimals."""
    if value is None:
        return "N/A"
    try:
        return f"{float(value):.{decimals}f}"
    except (TypeError, ValueError):
        return "N/A"


def _window_label(window_key: str) -> str:
    """Convert a window key like '5' or '252' to a human label."""
    try:
        days = int(window_key)
    except ValueError:
        return window_key

    if days <= 1:
        return "1 day"
    elif days <= 5:
        return "1 week"
    elif days <= 10:
        return "2 weeks"
    elif days <= 21:
        return "1 month"
    elif days <= 63:
        return "3 months"
    elif days <= 126:
        return "6 months"
    elif days <= 252:
        return "1 year"
    elif days <= 504:
        return "2 years"
    elif days <= 756:
        return "3 years"
    elif days <= 1260:
        return "5 years"
    else:
        return f"{days} trading days"


def _generate_ath_narrative(results: dict, series_name: str) -> str:
    """Generate narrative for all-time high analysis."""
    total = results.get("total_ath_count", 0)
    start = results.get("series_start", "N/A")
    end = results.get("series_end", "N/A")

    parts = [
        f"All-Time High Analysis for {series_name}",
        f"Period: {start} to {end}",
        f"Total all-time highs detected: {total}",
        "",
    ]

    # Count by year summary
    counts = results.get("count_by_year", {})
    if counts:
        best_year = max(counts, key=counts.get) if counts else None
        if best_year:
            parts.append(f"The year with the most ATHs was {best_year} with {counts[best_year]} new highs.")

    # Forward returns comparison
    es = results.get("event_study", {})
    fwd = es.get("forward_stats", {})
    base = es.get("baseline_stats", {})
    sample = es.get("sample_size", 0)

    if fwd and base:
        parts.append("")
        parts.append(f"Forward returns after ATH vs unconditional baseline (n={sample}):")
        for w_key in sorted(fwd.keys(), key=lambda x: int(x)):
            f_mean = fwd[w_key].get("mean")
            b_mean = base[w_key].get("mean")
            f_hit = fwd[w_key].get("hit_rate")
            label = _window_label(w_key)
            parts.append(
                f"  {label}: ATH mean {_pct(f_mean)} (hit rate {_pct(f_hit)}) "
                f"vs baseline {_pct(b_mean)}"
            )

    return "\n".join(parts)


def _generate_vix_study_narrative(results: dict, series_name: str, direction: str) -> str:
    """Generate narrative for VIX increase/decrease study."""
    period = results.get("period", "N/A")
    top_n = results.get("top_n", 0)
    sample = results.get("sample_size", 0)
    event_type_label = "increases" if direction == "increase" else "decreases"

    parts = [
        f"Largest VIX {event_type_label.title()} Event Study",
        f"Period measured: {period}",
        f"Top {top_n} events analyzed (n={sample} after deduplication)",
        "",
    ]

    meta = results.get("metadata", {})
    avg_change = meta.get("avg_vix_change_pts")
    if avg_change is not None:
        parts.append(f"Average VIX change: {_num(avg_change)} points")

    # Forward stats
    fwd = results.get("forward_stats", {})
    base = results.get("baseline_stats", {})

    if fwd:
        parts.append("")
        parts.append(f"Forward {series_name} returns after the largest VIX {event_type_label}:")
        for w_key in sorted(fwd.keys(), key=lambda x: int(x)):
            f_stats = fwd[w_key]
            b_stats = base.get(w_key, {})
            label = _window_label(w_key)
            parts.append(
                f"  {label}: mean {_pct(f_stats.get('mean'))} "
                f"(median {_pct(f_stats.get('median'))}, "
                f"hit rate {_pct(f_stats.get('hit_rate'))}) "
                f"vs baseline mean {_pct(b_stats.get('mean'))}"
            )

    # Key finding
    if fwd and base:
        windows = sorted(fwd.keys(), key=lambda x: int(x))
        if windows:
            longest = windows[-1]
            f_mean = fwd[longest].get("mean")
            b_mean = base.get(longest, {}).get("mean")
            if f_mean is not None and b_mean is not None:
                diff = f_mean - b_mean
                better_worse = "above" if diff > 0 else "below"
                parts.append("")
                parts.append(
                    f"Key finding: {_window_label(longest)} forward returns after "
                    f"the largest VIX {event_type_label} were {_pct(abs(diff))} "
                    f"{better_worse} the unconditional baseline."
                )

    return "\n".join(parts)


def _generate_panic_narrative(results: dict, series_name: str) -> str:
    """Generate narrative for panic/volatility spike study."""
    sample = results.get("sample_size", 0)
    threshold = results.get("threshold_value")
    pct = results.get("threshold_percentile")

    parts = [
        f"Panic/Volatility Spike Study for {series_name}",
        f"Threshold: {_num(threshold)} ({_num(pct, 0)}th percentile)",
        f"Events detected: {sample}",
        "",
    ]

    fwd = results.get("forward_stats", {})
    base = results.get("baseline_stats", {})

    if fwd:
        parts.append("Forward returns after panic events:")
        for w_key in sorted(fwd.keys(), key=lambda x: int(x)):
            f_stats = fwd[w_key]
            b_stats = base.get(w_key, {})
            label = _window_label(w_key)
            parts.append(
                f"  {label}: mean {_pct(f_stats.get('mean'))} "
                f"(hit rate {_pct(f_stats.get('hit_rate'))}) "
                f"vs baseline {_pct(b_stats.get('mean'))}"
            )

    return "\n".join(parts)


def _generate_drawdown_narrative(results: dict, series_name: str) -> str:
    """Generate narrative for drawdown analysis."""
    parts = [f"Drawdown Analysis for {series_name}", ""]

    current = results.get("current_drawdown")
    if current is not None:
        rank = current.get("percentile_rank")
        dd = current.get("current_drawdown")
        parts.append(f"Current drawdown: {_pct(dd)}")
        if rank is not None:
            parts.append(f"Percentile rank: {_pct(rank)} (fraction of history with deeper drawdown)")

    events = results.get("events", [])
    if events:
        parts.append(f"")
        parts.append(f"Major drawdowns detected: {len(events)}")
        for e in events[:5]:
            parts.append(
                f"  {e.get('start_date', 'N/A')} to {e.get('trough_date', 'N/A')}: "
                f"{_pct(e.get('drawdown_pct'))}"
            )

    return "\n".join(parts)


def _generate_cross_asset_narrative(results: dict) -> str:
    """Generate narrative for cross-asset leaderboard."""
    leaderboard = results.get("leaderboard", [])
    summary = results.get("summary", {})

    parts = [
        "Cross-Asset Leaderboard",
        f"Assets analyzed: {summary.get('asset_count', 0)}",
        "",
    ]

    if leaderboard:
        parts.append("Top performers (YTD):")
        for row in leaderboard[:5]:
            name = row.get("display_name", row.get("series_id", ""))
            ytd = row.get("ytd")
            parts.append(f"  {row.get('rank', '-')}. {name}: {_pct(ytd)}")

        parts.append("")
        parts.append("Bottom performers (YTD):")
        for row in leaderboard[-3:]:
            name = row.get("display_name", row.get("series_id", ""))
            ytd = row.get("ytd")
            parts.append(f"  {row.get('rank', '-')}. {name}: {_pct(ytd)}")

    return "\n".join(parts)


def _generate_myth_narrative(result: dict) -> str:
    """Generate narrative for myth buster test."""
    parts = [
        f"Myth Test: {result.get('claim', 'Unknown claim')}",
        f"Verdict: {result.get('verdict', 'N/A').upper()}",
        f"Confidence: {result.get('confidence', 'N/A')}",
        f"Sample size: {result.get('sample_size', 0)}",
        "",
        result.get("summary", ""),
    ]
    return "\n".join(parts)


def _generate_credit_narrative(results: dict, series_name: str) -> str:
    """Generate narrative for credit spread analysis."""
    current = results.get("current_state", {})
    stress = results.get("stress_events", {})

    parts = [
        f"Credit Spread Analysis for {series_name}",
        "",
    ]

    if current:
        parts.append(f"Current spread: {_num(current.get('current_spread'))} bps")
        parts.append(f"Percentile rank: {_pct(current.get('current_percentile'))}")
        parts.append(f"Z-score: {_num(current.get('current_zscore'))}")
        parts.append(f"Historical mean: {_num(current.get('historical_mean'))}")

    if stress:
        parts.append(f"")
        parts.append(f"Stress events (>{stress.get('threshold_percentile')}th pctile): {stress.get('event_count', 0)}")

    eq_fwd = results.get("equity_forward_returns", {})
    if eq_fwd:
        fwd = eq_fwd.get("forward_stats", {})
        base = eq_fwd.get("baseline_stats", {})
        if fwd:
            parts.append("")
            parts.append("Equity forward returns after spread stress:")
            for w_key in sorted(fwd.keys(), key=lambda x: int(x)):
                f_stats = fwd[w_key]
                b_stats = base.get(w_key, {})
                label = _window_label(w_key)
                parts.append(
                    f"  {label}: mean {_pct(f_stats.get('mean'))} vs baseline {_pct(b_stats.get('mean'))}"
                )

    return "\n".join(parts)


def _generate_rates_narrative(results: dict) -> str:
    """Generate narrative for rate/yield curve analysis."""
    current = results.get("current_state", {})
    inversions = results.get("inversions", [])

    parts = ["Yield Curve & Rate Analysis", ""]

    if current:
        parts.append(f"Fed funds rate: {_num(current.get('fed_funds_rate'))}%")
        parts.append(f"Current 10Y-2Y spread: {_num(current.get('current_spread'))} pct")
        is_inv = current.get("is_inverted")
        if is_inv is not None:
            parts.append(f"Yield curve inverted: {'Yes' if is_inv else 'No'}")

    if inversions:
        parts.append(f"")
        parts.append(f"Historical inversions detected: {len(inversions)}")
        for inv in inversions[-3:]:
            parts.append(
                f"  {inv.get('inversion_start', 'N/A')} to {inv.get('inversion_end', 'N/A')}: "
                f"min spread {_num(inv.get('min_spread'))}%, duration {inv.get('duration_days', 0)} days"
            )

    rate_study = results.get("rate_event_study", {})
    if rate_study and rate_study.get("sample_size", 0) > 0:
        parts.append(f"")
        parts.append(f"Rate change events: {rate_study['sample_size']}")

    return "\n".join(parts)


def _generate_inflation_narrative(results: dict) -> str:
    """Generate narrative for inflation analysis."""
    summary = results.get("summary", {})

    parts = [
        f"Inflation & Purchasing Power Analysis for {summary.get('asset_name', 'Asset')}",
        f"Period: {summary.get('period_start', 'N/A')} to {summary.get('period_end', 'N/A')}",
        "",
    ]

    latest_yoy = summary.get("latest_yoy_inflation")
    if latest_yoy is not None:
        parts.append(f"Latest YoY inflation: {_pct(latest_yoy)}")

    cum = summary.get("total_cumulative_inflation")
    if cum is not None:
        parts.append(f"Cumulative inflation over period: {_pct(cum)}")

    nom = summary.get("nominal_total_return")
    real = summary.get("real_total_return")
    drag = summary.get("inflation_drag")
    if nom is not None:
        parts.append(f"Nominal total return: {_pct(nom)}")
    if real is not None:
        parts.append(f"Real (inflation-adjusted) total return: {_pct(real)}")
    if drag is not None:
        parts.append(f"Inflation drag: {_pct(drag)}")

    pp = results.get("purchasing_power", {})
    current_pp = pp.get("current_value")
    initial = pp.get("initial_dollars")
    if current_pp is not None and initial is not None:
        parts.append(f"")
        parts.append(
            f"Purchasing power of ${_num(initial, 0)}: "
            f"${_num(current_pp)} in today's dollars"
        )

    return "\n".join(parts)


# ── Narrative template dispatch ──────────────────────────────────────────

_GENERATORS: dict[str, callable] = {
    "all_time_high_analyzer": lambda r, s, _: _generate_ath_narrative(r, s),
    "drawdown_recovery_analyzer": lambda r, s, _: _generate_drawdown_narrative(r, s),
    "panic_volatility_spike": lambda r, s, _: _generate_panic_narrative(r, s),
    "vix_largest_increases_forward_returns": lambda r, s, _: _generate_vix_study_narrative(r, s, "increase"),
    "vix_largest_decreases_forward_returns": lambda r, s, _: _generate_vix_study_narrative(r, s, "decrease"),
    "cross_asset_leaderboard": lambda r, _, __: _generate_cross_asset_narrative(r),
    "market_myth_buster_studio": lambda r, _, __: _generate_myth_narrative(r),
    "credit_spread_stress": lambda r, s, _: _generate_credit_narrative(r, s),
    "fed_rates_yield_curve": lambda r, _, __: _generate_rates_narrative(r),
    "inflation_purchasing_power": lambda r, _, __: _generate_inflation_narrative(r),
}


def generate_narrative(
    view_id: str,
    results_dict: dict,
    series_info: dict | None = None,
    proxy_warnings: list[str] | None = None,
) -> str:
    """Generate narrative text for an analysis result.

    Args:
        view_id: The view identifier to select the narrative template.
        results_dict: The analysis results dictionary.
        series_info: Optional series metadata for context.
        proxy_warnings: Optional proxy warning strings.

    Returns:
        Formatted narrative text string.
    """
    if series_info is None:
        series_info = {}
    if proxy_warnings is None:
        proxy_warnings = []

    series_name = series_info.get("display_name", series_info.get("series_id", "Market"))

    # Select generator
    gen = _GENERATORS.get(view_id)
    if gen is not None:
        narrative = gen(results_dict, series_name, series_info)
    else:
        narrative = _generate_generic_narrative(view_id, results_dict, series_name)

    # Append proxy warnings
    if proxy_warnings:
        narrative += "\n\nProxy Warnings:\n"
        for w in proxy_warnings:
            narrative += f"  - {w}\n"

    # Append caveats
    sample_size = results_dict.get("sample_size", 0)
    as_of_str = results_dict.get("series_end") or results_dict.get("as_of_date")
    as_of = None
    if as_of_str:
        try:
            as_of = date.fromisoformat(str(as_of_str))
        except (ValueError, TypeError):
            pass

    uses_vix = view_id in (
        "panic_volatility_spike",
        "vix_largest_increases_forward_returns",
        "vix_largest_decreases_forward_returns",
    )
    uses_macro = view_id in (
        "inflation_purchasing_power",
        "fed_rates_yield_curve",
        "recession_signal_dashboard",
    )

    caveats = get_applicable_caveats(
        series_info=series_info,
        sample_size=sample_size,
        as_of_date=as_of,
        uses_vix=uses_vix,
        uses_macro=uses_macro,
    )

    if caveats:
        narrative += "\n\nCaveats:\n" + format_caveats(caveats, style="bullets")

    return narrative


def _generate_generic_narrative(
    view_id: str,
    results_dict: dict,
    series_name: str,
) -> str:
    """Generate a generic narrative when no specific template exists."""
    parts = [
        f"Analysis: {view_id.replace('_', ' ').title()}",
        f"Series: {series_name}",
        "",
    ]

    # Try to extract common keys
    sample = results_dict.get("sample_size")
    if sample is not None:
        parts.append(f"Sample size: {sample}")

    fwd = results_dict.get("forward_stats", {})
    if fwd:
        parts.append("")
        parts.append("Forward return statistics:")
        for w_key in sorted(fwd.keys(), key=lambda x: int(x) if x.isdigit() else 0):
            stats = fwd[w_key]
            label = _window_label(w_key)
            parts.append(
                f"  {label}: mean {_pct(stats.get('mean'))}, "
                f"median {_pct(stats.get('median'))}, "
                f"hit rate {_pct(stats.get('hit_rate'))}"
            )

    current = results_dict.get("current_state", {})
    if current:
        parts.append("")
        parts.append("Current state:")
        for k, v in current.items():
            parts.append(f"  {k}: {v}")

    return "\n".join(parts)
