"""Risk metrics and standard errors (spec020 IND-006, IND-008).

* EL uses the conditional-probability estimator (see PLAN); VaR and expected shortfall use sampled
  defaults.
* VaR is the upper empirical quantile; expected shortfall is the mean of the worst ``ceil((1 -
  level) * n)`` losses, which stays correct when much of the distribution is a point mass at zero.
* PFE at a level is the peak over the event grid of the cross-path quantile of exposure; EPE is the
  time average of expected exposure.
* Standard errors: the mean is ``std / sqrt(n)``. For quantiles, peaks and tail means, paths are
  split into consecutive blocks (chunks are independent, so blocks are too) and the standard error
  is the spread of the block estimates over ``sqrt(blocks)``.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from .grid import Grid

LEVELS = {
    "pfe95": 0.95,
    "pfe99": 0.99,
    "var99": 0.99,
    "var999": 0.999,
    "es99": 0.99,
    "es999": 0.999,
}
BLOCKS = 20


@dataclass(frozen=True)
class Metric:
    value: float
    std_error: float | None

    def as_dict(self) -> dict[str, float | None]:
        return {
            "value": float(self.value),
            "std_error": None if self.std_error is None else float(self.std_error),
        }


def tail_count(n: int, level: float) -> int:
    """Number of worst paths in the ``1 - level`` tail. The tolerance stops (1 - 0.99) * 100, which
    is 1.0000000000000009 in floating point, from rounding up to 2.
    """
    return max(1, math.ceil((1.0 - level) * n - 1e-9))


def value_at_risk(losses: np.ndarray, level: float) -> float:
    return float(np.quantile(losses, level, method="higher"))


def expected_shortfall(losses: np.ndarray, level: float) -> float:
    return float(np.sort(losses)[-tail_count(len(losses), level) :].mean())


def _block_estimate(fn: Callable[..., float], *arrays: np.ndarray, blocks: int = BLOCKS) -> Metric:
    value = float(fn(*arrays))
    n = len(arrays[0])
    if n < blocks * 2:
        return Metric(value, None)
    edges = np.linspace(0, n, blocks + 1).astype(int)
    parts = [fn(*(a[edges[i] : edges[i + 1]] for a in arrays)) for i in range(blocks)]
    return Metric(value, float(np.std(parts, ddof=1) / math.sqrt(blocks)))


def _mean(x: np.ndarray) -> Metric:
    return Metric(float(x.mean()), float(x.std(ddof=1) / math.sqrt(len(x))) if len(x) > 1 else None)


def _peak_pfe(level: float) -> Callable[[np.ndarray], float]:
    return lambda exposure: float(np.quantile(exposure, level, axis=0, method="higher").max())


def channel_metrics(
    *, cond: np.ndarray, sampled: np.ndarray, exposure: np.ndarray | None, grid: Grid
) -> dict[str, Metric]:
    """All eight metrics for one loss series.

    ``cond`` is the per-path conditional-expectation loss (EL), ``sampled`` the per-path sampled
    loss (VaR, ES). ``exposure`` is (n, K + 1) counterparty exposure; pass None for a channel with
    no exposure concept, which reports zeros for EPE and PFE.
    """
    out = {
        "el": _mean(cond),
        "var99": _block_estimate(lambda x: value_at_risk(x, 0.99), sampled),
        "var999": _block_estimate(lambda x: value_at_risk(x, 0.999), sampled),
        "es99": _block_estimate(lambda x: expected_shortfall(x, 0.99), sampled),
        "es999": _block_estimate(lambda x: expected_shortfall(x, 0.999), sampled),
    }
    if exposure is None:
        zero = Metric(0.0, 0.0)
        out.update(epe=zero, pfe95=zero, pfe99=zero)
    else:
        horizon = grid.horizon_days
        per_path = np.trapezoid(exposure, grid.event_days, axis=1) / horizon
        out["epe"] = _mean(per_path)
        out["pfe95"] = _block_estimate(_peak_pfe(LEVELS["pfe95"]), exposure)
        out["pfe99"] = _block_estimate(_peak_pfe(LEVELS["pfe99"]), exposure)
    return {
        name: out[name]
        for name in ("el", "epe", "pfe95", "pfe99", "var99", "var999", "es99", "es999")
    }


def euler_expected_shortfall(
    by_borrower: np.ndarray, pool: np.ndarray, level: float
) -> tuple[np.ndarray, float]:
    """Each borrower's (and the pool's) mean loss over the worst paths of the total, summing to the
    ES.
    """
    total = by_borrower.sum(axis=1) + pool
    tail = np.argsort(total, kind="stable")[-tail_count(len(total), level) :]
    return by_borrower[tail].mean(axis=0), float(pool[tail].mean())
