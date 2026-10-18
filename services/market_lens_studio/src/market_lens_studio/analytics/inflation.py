"""Purchasing power analysis and real return calculations."""

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


def real_returns(
    nominal_values: Sequence[float],
    cpi_values: Sequence[float],
    window_days: int,
) -> list[Optional[float]]:
    """Compute rolling real returns adjusted for inflation."""
    n = min(len(nominal_values), len(cpi_values))
    if n <= window_days:
        return []

    out = []
    for i in range(window_days, n):
        nb = nominal_values[i - window_days]
        ne = nominal_values[i]
        cb = cpi_values[i - window_days]
        ce = cpi_values[i]
        if any(v is None or v == 0 for v in [nb, ne, cb, ce]):
            out.append(None)
            continue
        nominal_ret = ne / nb - 1.0
        inflation = ce / cb - 1.0
        real_ret = (1 + nominal_ret) / (1 + inflation) - 1.0
        out.append(_finite(real_ret))

    return out


def purchasing_power(
    cpi_values: Sequence[float],
    base_amount: float = 100.0,
) -> list[Optional[float]]:
    """How much purchasing power remains for a fixed dollar amount."""
    if not cpi_values:
        return []
    base_cpi = cpi_values[0]
    if base_cpi is None or base_cpi == 0:
        return [None] * len(cpi_values)
    return [_finite(base_amount * base_cpi / c) if c and c > 0 else None for c in cpi_values]


def inflation_adjusted_series(
    nominal_values: Sequence[float],
    cpi_values: Sequence[float],
) -> list[Optional[float]]:
    """Deflate a nominal series by CPI to get real values."""
    n = min(len(nominal_values), len(cpi_values))
    if n == 0:
        return []
    last_cpi = cpi_values[-1]
    if last_cpi is None or last_cpi == 0:
        return [None] * n
    return [
        _finite(nv * last_cpi / cv) if nv is not None and cv is not None and cv > 0 else None
        for nv, cv in zip(nominal_values[:n], cpi_values[:n])
    ]


def breakeven_inflation(
    nominal_yield: float,
    tips_yield: float,
) -> Optional[float]:
    """Market-implied breakeven inflation rate."""
    return _finite(nominal_yield - tips_yield)


def run_inflation_analysis(
    nominal_dates: Sequence[date],
    nominal_values: Sequence[float],
    cpi_dates: Sequence[date],
    cpi_values: Sequence[float],
    asset_name: str = "Asset",
) -> dict:
    """Run comprehensive inflation/purchasing power analysis."""
    pp = purchasing_power(cpi_values)
    real_rets = real_returns(nominal_values, cpi_values, 252)
    n = min(len(nominal_dates), len(cpi_dates))
    dates_iso = [d.isoformat() for d in nominal_dates[:n]]

    summary: dict = {}
    if cpi_values and len(cpi_values) > 1 and cpi_values[0] and cpi_values[0] > 0:
        total_inf = _finite(cpi_values[-1] / cpi_values[0] - 1.0)
        summary = {
            "asset_name": asset_name,
            "total_inflation": total_inf,
            "current_purchasing_power": pp[-1] if pp else None,
            "data_points": n,
        }

    return {
        "inflation_series": {
            "dates": dates_iso,
            "cpi_values": list(cpi_values[:n]),
        },
        "purchasing_power": {
            "dates": dates_iso,
            "values": pp[:n] if pp else [],
        },
        "real_returns": {
            "dates": dates_iso[252:] if len(dates_iso) > 252 else [],
            "values": real_rets,
        },
        "summary": summary,
        "sample_size": n,
    }
