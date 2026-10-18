"""Drawdown detection, recovery analysis, and severity ranking."""

from __future__ import annotations

from dataclasses import dataclass
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


@dataclass
class DrawdownEvent:
    peak_date: date
    trough_date: date
    peak_value: float
    trough_value: float
    drawdown_pct: float
    recovery_date: Optional[date] = None
    recovery_days: Optional[int] = None
    peak_index: int = 0
    trough_index: int = 0


def detect_drawdowns(
    dates: Sequence[date],
    values: Sequence[float],
    threshold: float = -0.10,
) -> list[DrawdownEvent]:
    """Detect all drawdown events exceeding the threshold (negative decimal).

    Returns events sorted by severity (most negative first).
    """
    if not dates or not values or len(dates) != len(values):
        return []

    events: list[DrawdownEvent] = []
    n = len(values)
    peak_val = values[0]
    peak_idx = 0
    trough_val = values[0]
    trough_idx = 0
    in_drawdown = False

    for i in range(1, n):
        v = values[i]
        if v is None:
            continue

        if v > peak_val:
            if in_drawdown:
                dd_pct = trough_val / peak_val - 1.0
                if dd_pct <= threshold:
                    recovery_days = (dates[i] - dates[trough_idx]).days
                    events.append(DrawdownEvent(
                        peak_date=dates[peak_idx],
                        trough_date=dates[trough_idx],
                        peak_value=peak_val,
                        trough_value=trough_val,
                        drawdown_pct=dd_pct,
                        recovery_date=dates[i],
                        recovery_days=recovery_days,
                        peak_index=peak_idx,
                        trough_index=trough_idx,
                    ))
                in_drawdown = False
            peak_val = v
            peak_idx = i
            trough_val = v
            trough_idx = i
        elif v < trough_val:
            trough_val = v
            trough_idx = i
            dd = v / peak_val - 1.0 if peak_val > 0 else 0
            if dd <= threshold:
                in_drawdown = True

    # Handle ongoing drawdown at end of series
    if in_drawdown:
        dd_pct = trough_val / peak_val - 1.0
        if dd_pct <= threshold:
            events.append(DrawdownEvent(
                peak_date=dates[peak_idx],
                trough_date=dates[trough_idx],
                peak_value=peak_val,
                trough_value=trough_val,
                drawdown_pct=dd_pct,
                recovery_date=None,
                recovery_days=None,
                peak_index=peak_idx,
                trough_index=trough_idx,
            ))

    events.sort(key=lambda e: e.drawdown_pct)
    return events


def max_drawdown(values: Sequence[float]) -> Optional[float]:
    """Peak-to-trough max drawdown (decimal, <= 0)."""
    if not values:
        return None
    peak = None
    worst = 0.0
    for v in values:
        if v is None:
            continue
        if peak is None or v > peak:
            peak = v
        if peak and peak > 0:
            dd = v / peak - 1.0
            if dd < worst:
                worst = dd
    return _finite(worst)


def drawdown_series(values: Sequence[float]) -> list[Optional[float]]:
    """Running drawdown from peak at each observation (decimal, <= 0)."""
    if not values:
        return []
    peak = None
    out = []
    for v in values:
        if v is None:
            out.append(None)
            continue
        if peak is None or v > peak:
            peak = v
        out.append(_finite(v / peak - 1.0) if peak > 0 else None)
    return out


class _DictFrame:
    """Minimal DataFrame-like wrapper for dict-of-lists."""

    def __init__(self, columns: dict):
        self._columns = columns

    def __getitem__(self, key):
        return _DictColumn(self._columns[key])

    @property
    def height(self):
        for v in self._columns.values():
            return len(v)
        return 0

    def to_dicts(self):
        keys = list(self._columns.keys())
        n = self.height
        return [{k: self._columns[k][i] for k in keys} for i in range(n)]


class _DictColumn:
    def __init__(self, data):
        self._data = data

    def to_list(self):
        return list(self._data)


class _DrawdownEventView:
    """Wrapper providing a friendlier interface over DrawdownEvent."""

    def __init__(self, e: DrawdownEvent):
        self.start_date = e.peak_date
        self.trough_date = e.trough_date
        self.recovery_date = e.recovery_date
        self.drawdown_pct = e.drawdown_pct
        self.recovery_days = e.recovery_days
        self.is_recovered = e.recovery_date is not None


def compute_drawdown_series(
    dates: Sequence[date],
    values: Sequence[float],
) -> _DictFrame:
    """Compute running drawdown series as a DataFrame-like object."""
    dd = drawdown_series(values)
    return _DictFrame({"date": list(dates[: len(dd)]), "drawdown": dd})


def identify_drawdown_events(
    dates: Sequence[date],
    values: Sequence[float],
    threshold: float = -0.10,
) -> list[_DrawdownEventView]:
    """Detect drawdown events with start_date/is_recovered fields."""
    events = detect_drawdowns(dates, values, threshold)
    return [_DrawdownEventView(e) for e in events]


def current_drawdown_rank(
    dates: Sequence[date],
    values: Sequence[float],
) -> dict:
    """Current drawdown state relative to history."""
    dd_list = drawdown_series(values)
    current_dd = dd_list[-1] if dd_list else 0
    worst = max_drawdown(values)
    return {
        "current_drawdown": current_dd,
        "max_drawdown": worst,
        "is_in_drawdown": current_dd is not None and current_dd < -0.01,
    }


def drawdown_recovery_table(
    dates: Sequence[date],
    values: Sequence[float],
) -> _DictFrame:
    """Calendar year returns vs max intra-year drawdown."""
    year_data: dict[int, list[float]] = {}
    for d, v in zip(dates, values):
        if v is None:
            continue
        y = d.year
        if y not in year_data:
            year_data[y] = []
        year_data[y].append(v)

    years = []
    returns = []
    max_dds = []
    for year in sorted(year_data.keys()):
        vals = year_data[year]
        if len(vals) < 2:
            continue
        yr_return = _finite(vals[-1] / vals[0] - 1.0) if vals[0] > 0 else None
        yr_maxdd = max_drawdown(vals)
        years.append(year)
        returns.append(yr_return)
        max_dds.append(yr_maxdd)

    return _DictFrame({"year": years, "return": returns, "max_drawdown": max_dds})
