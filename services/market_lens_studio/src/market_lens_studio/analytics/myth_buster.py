"""Market myth analysis — 'sell in May', seasonality, and more."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Optional, Sequence
import math


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


def monthly_seasonality(
    dates: Sequence[date],
    values: Sequence[float],
) -> dict[int, dict[str, Optional[float]]]:
    """Average monthly returns and hit rate by calendar month."""
    monthly_rets: dict[int, list[float]] = {m: [] for m in range(1, 13)}

    i = 0
    while i < len(dates) - 1:
        d = dates[i]
        # Find end of this month
        j = i + 1
        while j < len(dates) and dates[j].month == d.month and dates[j].year == d.year:
            j += 1
        if j < len(dates) and values[i] and values[j] and values[i] > 0:
            ret = values[j] / values[i] - 1.0
            r = _finite(ret)
            if r is not None:
                monthly_rets[d.month].append(r)
        i = j

    result = {}
    for month, rets in monthly_rets.items():
        if not rets:
            result[month] = {"mean": None, "median": None, "pct_positive": None, "count": 0}
            continue
        rets_sorted = sorted(rets)
        n = len(rets_sorted)
        mean_val = sum(rets_sorted) / n
        pct_pos = sum(1 for r in rets_sorted if r >= 0) / n
        median_val = rets_sorted[n // 2]
        result[month] = {
            "mean": _finite(mean_val),
            "median": _finite(median_val),
            "pct_positive": _finite(pct_pos),
            "count": n,
        }

    return result


def sell_in_may(
    dates: Sequence[date],
    values: Sequence[float],
) -> dict[str, dict[str, Optional[float]]]:
    """Compare May-Oct vs Nov-Apr returns historically."""
    may_oct_rets: list[float] = []
    nov_apr_rets: list[float] = []

    year_starts: dict[int, dict[str, Optional[float]]] = {}

    for i, (d, v) in enumerate(zip(dates, values)):
        if v is None:
            continue
        year = d.year
        if year not in year_starts:
            year_starts[year] = {}

        if d.month == 5 and 1 in year_starts.get(year, {}):
            pass

        key = f"{d.month:02d}"
        if key not in year_starts.get(year, {}):
            year_starts[year][key] = {"idx": i, "val": v}

    # Simplified: compute May-Oct and Nov-Apr returns from monthly boundary values
    for i in range(1, len(dates)):
        d = dates[i]
        if values[i] is None or values[i - 1] is None or values[i - 1] == 0:
            continue
        month_ret = values[i] / values[i - 1] - 1.0
        r = _finite(month_ret)
        if r is None:
            continue
        if 5 <= d.month <= 10:
            may_oct_rets.append(r)
        else:
            nov_apr_rets.append(r)

    def _stats(rets: list[float]) -> dict[str, Optional[float]]:
        if not rets:
            return {"mean": None, "pct_positive": None, "count": 0}
        return {
            "mean": _finite(sum(rets) / len(rets)),
            "pct_positive": _finite(sum(1 for r in rets if r >= 0) / len(rets)),
            "count": len(rets),
        }

    return {
        "may_oct": _stats(may_oct_rets),
        "nov_apr": _stats(nov_apr_rets),
    }


def day_of_week_effect(
    dates: Sequence[date],
    values: Sequence[float],
) -> dict[str, dict[str, Optional[float]]]:
    """Average returns by day of week."""
    dow_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    dow_rets: dict[int, list[float]] = {i: [] for i in range(5)}

    for i in range(1, len(values)):
        if values[i] is None or values[i - 1] is None or values[i - 1] == 0:
            continue
        ret = values[i] / values[i - 1] - 1.0
        r = _finite(ret)
        if r is not None:
            dow = dates[i].weekday()
            if dow < 5:
                dow_rets[dow].append(r)

    result = {}
    for dow, rets in dow_rets.items():
        if not rets:
            result[dow_names[dow]] = {"mean": None, "pct_positive": None, "count": 0}
            continue
        result[dow_names[dow]] = {
            "mean": _finite(sum(rets) / len(rets)),
            "pct_positive": _finite(sum(1 for r in rets if r >= 0) / len(rets)),
            "count": len(rets),
        }

    return result


# ── Myth Testing Framework ──────────────────────────────────────────────


@dataclass
class MythDefinition:
    myth_id: str
    claim: str
    trigger_series_id: Optional[str] = None
    trigger_month_start: Optional[int] = None
    trigger_month_end: Optional[int] = None


@dataclass
class MythTestResult:
    myth_id: str
    claim: str
    verdict: str
    confidence: float
    summary: str
    sample_size: int
    forward_stats: dict = field(default_factory=dict)
    baseline_stats: dict = field(default_factory=dict)
    details: dict = field(default_factory=dict)


BUILT_IN_MYTHS: list[MythDefinition] = [
    MythDefinition("sell_in_may", "Sell in May and Go Away",
                   trigger_month_start=5, trigger_month_end=10),
    MythDefinition("january_effect", "January Effect: Markets rally in January",
                   trigger_month_start=1, trigger_month_end=1),
    MythDefinition("santa_rally", "Santa Claus Rally: Markets rally in late December",
                   trigger_month_start=12, trigger_month_end=12),
    MythDefinition("monday_effect", "Monday Effect: Markets perform worse on Mondays"),
]


def run_myth_test(
    myth: MythDefinition,
    dates: Sequence[date],
    values: Sequence[float],
    trigger_dates: Optional[Sequence[date]] = None,
    trigger_values: Optional[Sequence[float]] = None,
) -> MythTestResult:
    """Test a market myth against historical data."""
    if myth.myth_id == "sell_in_may":
        sim_result = sell_in_may(dates, values)
        may_oct = sim_result.get("may_oct", {})
        nov_apr = sim_result.get("nov_apr", {})
        may_mean = may_oct.get("mean")
        nov_mean = nov_apr.get("mean")

        if may_mean is not None and nov_mean is not None:
            diff = nov_mean - may_mean
            verdict = "SUPPORTED" if diff > 0 else "BUSTED"
            conf = min(abs(diff) / 0.01, 1.0) if diff != 0 else 0.0
        else:
            verdict = "INCONCLUSIVE"
            conf = 0.0

        return MythTestResult(
            myth_id=myth.myth_id, claim=myth.claim,
            verdict=verdict, confidence=conf,
            summary=f"May-Oct avg: {may_mean:.4f}, Nov-Apr avg: {nov_mean:.4f}" if may_mean is not None else "Insufficient data",
            sample_size=may_oct.get("count", 0) + nov_apr.get("count", 0),
            forward_stats={"may_oct": may_oct, "nov_apr": nov_apr},
            baseline_stats={},
            details=sim_result,
        )

    elif myth.myth_id == "monday_effect":
        dow = day_of_week_effect(dates, values)
        mon = dow.get("Monday", {})
        others = [dow.get(d, {}) for d in ["Tuesday", "Wednesday", "Thursday", "Friday"]]
        other_means = [o.get("mean") for o in others if o.get("mean") is not None]
        mon_mean = mon.get("mean")
        avg_other = sum(other_means) / len(other_means) if other_means else None

        if mon_mean is not None and avg_other is not None:
            verdict = "SUPPORTED" if mon_mean < avg_other else "BUSTED"
            conf = min(abs(mon_mean - avg_other) / 0.001, 1.0)
        else:
            verdict = "INCONCLUSIVE"
            conf = 0.0

        return MythTestResult(
            myth_id=myth.myth_id, claim=myth.claim,
            verdict=verdict, confidence=conf,
            summary=f"Monday avg: {mon_mean:.5f}, Other avg: {avg_other:.5f}" if mon_mean is not None else "Insufficient data",
            sample_size=mon.get("count", 0),
            forward_stats=dow,
            baseline_stats={},
            details=dow,
        )

    elif myth.myth_id in ("january_effect", "santa_rally"):
        season = monthly_seasonality(dates, values)
        target_month = myth.trigger_month_start or 1
        target = season.get(target_month, {})
        all_months = [season.get(m, {}) for m in range(1, 13)]
        all_means = [m.get("mean") for m in all_months if m.get("mean") is not None]
        avg_all = sum(all_means) / len(all_means) if all_means else None
        target_mean = target.get("mean")

        if target_mean is not None and avg_all is not None:
            verdict = "SUPPORTED" if target_mean > avg_all else "BUSTED"
            conf = min(abs(target_mean - avg_all) / 0.01, 1.0)
        else:
            verdict = "INCONCLUSIVE"
            conf = 0.0

        return MythTestResult(
            myth_id=myth.myth_id, claim=myth.claim,
            verdict=verdict, confidence=conf,
            summary=f"Target month avg: {target_mean:.4f}, Overall avg: {avg_all:.4f}" if target_mean is not None else "Insufficient data",
            sample_size=target.get("count", 0),
            forward_stats=season,
            baseline_stats={},
            details=season,
        )

    return MythTestResult(
        myth_id=myth.myth_id, claim=myth.claim,
        verdict="INCONCLUSIVE", confidence=0.0,
        summary="No test implemented for this myth.",
        sample_size=0,
    )
