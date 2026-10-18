"""Standard caveat library for Market Lens Studio analyses."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Optional


# ── Standard Caveats ─────────────────────────────────────────────────────

PROXY_CAVEAT = (
    "This analysis uses ETF proxies rather than the underlying index. "
    "ETF returns may differ from index returns due to tracking error, "
    "expense ratios, and dividend handling. Results prior to ETF inception "
    "are not available."
)

SMALL_SAMPLE_CAVEAT = (
    "The sample size for this analysis is small (fewer than 30 events). "
    "Statistical conclusions should be treated with caution. "
    "Small samples are more susceptible to outlier influence and may not "
    "represent the full distribution of outcomes."
)

STALE_DATA_CAVEAT = (
    "The data used in this analysis may not reflect the most recent "
    "market conditions. The as-of date is more than 3 trading days old. "
    "Please verify that the data source is current before acting on these results."
)

SHORT_HISTORY_CAVEAT = (
    "This series has a limited history (fewer than 5 years of data). "
    "Conclusions drawn from short histories may not generalize across "
    "different market regimes. Consider results directional rather than definitive."
)

SURVIVORSHIP_CAVEAT = (
    "ETF-based analysis may suffer from survivorship bias. "
    "Funds that performed poorly may have been delisted or merged, "
    "potentially biasing results upward."
)

LOOKAHEAD_CAVEAT = (
    "Forward return calculations use data that was not available at the "
    "time of the event. Actual implementable returns may differ due to "
    "execution costs, slippage, and information delays."
)

MACRO_LAG_CAVEAT = (
    "Macroeconomic data (GDP, CPI, employment) is released with a lag "
    "and subject to revision. The values used here are as-reported and "
    "may differ from real-time values available to investors."
)

VIX_NOT_INVESTABLE_CAVEAT = (
    "The VIX index is not directly investable. VIX-linked products "
    "(e.g., VIXY, VXX) track VIX futures, not the spot index, and "
    "suffer from contango-driven decay over time."
)

PAST_PERFORMANCE_CAVEAT = (
    "Past performance is not indicative of future results. "
    "Historical patterns may not repeat, and market conditions can change "
    "in ways that invalidate historical relationships."
)


# ── Caveat Selection ─────────────────────────────────────────────────────

def get_applicable_caveats(
    series_info: dict | None = None,
    sample_size: int = 0,
    as_of_date: date | None = None,
    uses_vix: bool = False,
    uses_macro: bool = False,
) -> list[str]:
    """Return a list of applicable caveats based on analysis context.

    Args:
        series_info: Dict with keys like 'is_proxy', 'data_points', 'asset_class'.
        sample_size: Number of events in the analysis.
        as_of_date: The most recent date in the data.
        uses_vix: Whether the analysis involves VIX data.
        uses_macro: Whether the analysis uses macro/economic data.

    Returns:
        List of caveat strings that apply to this analysis.
    """
    caveats: list[str] = []

    # Always include past performance disclaimer
    caveats.append(PAST_PERFORMANCE_CAVEAT)

    if series_info is None:
        series_info = {}

    # Proxy caveat
    if series_info.get("is_proxy", False):
        caveats.append(PROXY_CAVEAT)

    # Small sample caveat
    if 0 < sample_size < 30:
        caveats.append(SMALL_SAMPLE_CAVEAT)

    # Stale data caveat
    if as_of_date is not None:
        today = date.today()
        days_stale = (today - as_of_date).days
        if days_stale > 5:  # More than ~3 trading days
            caveats.append(STALE_DATA_CAVEAT)

    # Short history caveat
    data_points = series_info.get("data_points", 0)
    if 0 < data_points < 1260:  # ~5 years of daily data
        caveats.append(SHORT_HISTORY_CAVEAT)

    # VIX caveat
    if uses_vix:
        caveats.append(VIX_NOT_INVESTABLE_CAVEAT)

    # Macro lag caveat
    if uses_macro:
        caveats.append(MACRO_LAG_CAVEAT)

    # Survivorship caveat for multi-asset analyses
    if series_info.get("asset_count", 0) > 5:
        caveats.append(SURVIVORSHIP_CAVEAT)

    return caveats


def format_caveats(caveats: list[str], style: str = "bullets") -> str:
    """Format caveats for display.

    Args:
        caveats: List of caveat strings.
        style: "bullets", "numbered", or "paragraph".

    Returns:
        Formatted string.
    """
    if not caveats:
        return ""

    if style == "bullets":
        return "\n".join(f"  - {c}" for c in caveats)
    elif style == "numbered":
        return "\n".join(f"  {i + 1}. {c}" for i, c in enumerate(caveats))
    else:
        return " ".join(caveats)
