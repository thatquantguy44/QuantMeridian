"""Cross-asset correlation and relative strength analysis."""

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


def rolling_correlation(
    values_a: Sequence[float],
    values_b: Sequence[float],
    window: int = 63,
) -> list[Optional[float]]:
    """Rolling Pearson correlation between two return series."""
    n = min(len(values_a), len(values_b))
    if n < window:
        return []

    out = []
    for i in range(window, n + 1):
        a = values_a[i - window:i]
        b = values_b[i - window:i]
        clean = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
        if len(clean) < window // 2:
            out.append(None)
            continue
        ax, bx = zip(*clean)
        ma = sum(ax) / len(ax)
        mb = sum(bx) / len(bx)
        cov = sum((x - ma) * (y - mb) for x, y in clean) / (len(clean) - 1)
        va = sum((x - ma) ** 2 for x in ax) / (len(ax) - 1)
        vb = sum((y - mb) ** 2 for y in bx) / (len(bx) - 1)
        denom = math.sqrt(va * vb)
        if denom == 0:
            out.append(None)
        else:
            out.append(_finite(cov / denom))

    return out


def relative_strength(
    asset_values: Sequence[float],
    benchmark_values: Sequence[float],
) -> list[Optional[float]]:
    """Relative strength line (asset / benchmark), normalized to 100 at start."""
    n = min(len(asset_values), len(benchmark_values))
    if n == 0:
        return []

    base_a = asset_values[0]
    base_b = benchmark_values[0]
    if base_a is None or base_b is None or base_a == 0 or base_b == 0:
        return [None] * n

    out = []
    for a, b in zip(asset_values[:n], benchmark_values[:n]):
        if a is None or b is None or b == 0:
            out.append(None)
        else:
            out.append(_finite(100 * (a / base_a) / (b / base_b)))
    return out


def rank_assets(
    asset_returns: dict[str, Optional[float]],
) -> list[tuple[str, Optional[float]]]:
    """Rank assets by return, descending."""
    items = [(k, v) for k, v in asset_returns.items()]
    items.sort(key=lambda x: x[1] if x[1] is not None else float("-inf"), reverse=True)
    return items


def run_cross_asset_dashboard(
    series_data: dict[str, tuple[Sequence[date], Sequence[float]]],
    display_names: dict[str, str],
) -> dict:
    """Run cross-asset leaderboard analysis."""
    windows = {"1W": 5, "1M": 21, "3M": 63, "6M": 126, "1Y": 252}

    leaderboard = []
    returns_by_window: dict[str, dict[str, Optional[float]]] = {w: {} for w in windows}

    for sid, (dates, values) in series_data.items():
        if not values or len(values) < 2:
            continue
        name = display_names.get(sid, sid)
        row: dict = {"series_id": sid, "display_name": name}

        for wlabel, wdays in windows.items():
            if len(values) > wdays and values[-wdays - 1] and values[-wdays - 1] > 0:
                ret = values[-1] / values[-wdays - 1] - 1.0
                row[wlabel] = _finite(ret)
                returns_by_window[wlabel][sid] = _finite(ret)
            else:
                row[wlabel] = None

        leaderboard.append(row)

    leaderboard.sort(
        key=lambda r: r.get("1Y") if r.get("1Y") is not None else float("-inf"),
        reverse=True,
    )

    best_worst = {}
    for wlabel, rets in returns_by_window.items():
        ranked = rank_assets(rets)
        if ranked:
            best_worst[wlabel] = {
                "best": {"series_id": ranked[0][0], "return": ranked[0][1]},
                "worst": {"series_id": ranked[-1][0], "return": ranked[-1][1]},
            }

    return {
        "leaderboard": leaderboard,
        "best_worst_by_window": best_worst,
        "summary": {"asset_count": len(leaderboard)},
        "sample_size": len(leaderboard),
    }
