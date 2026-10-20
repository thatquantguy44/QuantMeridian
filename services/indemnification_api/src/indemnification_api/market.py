"""Market factor paths and security prices (spec020 PLAN section 1, IND-003).

Four correlated Gaussian factors (equity return, yield change, credit spread change, FX return) drive
every security through its loadings: equity beta, minus rate duration, minus spread duration. Each
security also has idiosyncratic noise sized so its total daily volatility matches the snapshot, and
hard-to-borrow securities can take upward squeeze jumps. Log prices carry a drift that makes every
price a martingale, so no security has a built-in trend.

Prices are simulated daily. All draws for a call are made in a fixed order from the caller's generator,
so a seed reproduces a run exactly and variants of a run (such as the no-wrong-way run) can reuse them.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np

from .grid import YEAR_DAYS

FACTORS = ("equity", "rates", "credit_spread", "fx")
IDIO_FLOOR = 0.25  # idiosyncratic vol is at least this share of a security's total daily vol


@dataclass(frozen=True)
class MarketModel:
    security_ids: list[str]
    index: dict[str, int]
    price0: np.ndarray                  # (S,) starting prices
    factor_vol_daily: np.ndarray        # (4,)
    factor_corr: np.ndarray             # (4, 4)
    factor_root: np.ndarray             # (4, 4), factor_root @ factor_root.T == factor_corr
    factor_cov_daily: np.ndarray        # (4, 4)
    loadings: np.ndarray                # (S, 4)
    idio_daily: np.ndarray              # (S,)
    drift_daily: np.ndarray             # (S,)
    jump_on: np.ndarray                 # (S,) bool
    jump_columns: list[int]             # security indices that jump
    jump_intensity_daily: float
    jump_mean: float
    jump_sd: float


@dataclass(frozen=True)
class Paths:
    """Cumulative factor levels and log prices relative to day 0, for days 0..days."""

    factors: np.ndarray                 # (n, days + 1, 4)
    log_price: np.ndarray               # (n, days + 1, S)
    jump_counts: np.ndarray             # (n, J) jumps per path for each jumping security

    def standardized_equity(self, horizon_days: int, model: MarketModel) -> np.ndarray:
        """Cumulative equity factor return at the horizon, scaled to unit variance."""
        return self.factors[:, horizon_days, 0] / (model.factor_vol_daily[0] * math.sqrt(horizon_days))


def build_market(snapshot: dict[str, Any]) -> MarketModel:
    market = snapshot["model"]["market"]
    vol = np.array(
        [
            market["equity_vol_annual"] / math.sqrt(YEAR_DAYS),
            market["rates_vol_bps_daily"] / 1e4,
            market["spread_vol_bps_daily"] / 1e4,
            market["fx_vol_annual"] / math.sqrt(YEAR_DAYS),
        ]
    )
    corr = np.array(market["factor_corr"], dtype=float)
    w, v = np.linalg.eigh(corr)
    root = v * np.sqrt(np.clip(w, 0.0, None))
    cov = corr * np.outer(vol, vol)

    securities = snapshot["securities"]
    ids = [s["id"] for s in securities]
    loadings = np.array(
        [[s["equity_beta"], -s["rate_duration"], -s["spread_duration"], 0.0] for s in securities]
    )
    total = np.array([s["daily_vol"] for s in securities])
    systematic = np.einsum("sf,fg,sg->s", loadings, cov, loadings)
    idio = np.sqrt(np.maximum(total**2 - systematic, (IDIO_FLOOR * total) ** 2))

    jump_on = np.array([s["hard_to_borrow"] for s in securities], dtype=bool)
    lam = market["jump_intensity_annual"] / YEAR_DAYS
    mu, sd = market["jump_mean"], market["jump_sd"]
    compensator = lam * math.expm1(mu + 0.5 * sd**2)
    drift = -0.5 * (systematic + idio**2) - np.where(jump_on, compensator, 0.0)
    return MarketModel(
        security_ids=ids,
        index={sid: i for i, sid in enumerate(ids)},
        price0=np.array([s["price"] for s in securities], dtype=float),
        factor_vol_daily=vol,
        factor_corr=corr,
        factor_root=root,
        factor_cov_daily=cov,
        loadings=loadings,
        idio_daily=idio,
        drift_daily=drift,
        jump_on=jump_on,
        jump_columns=[int(i) for i in np.flatnonzero(jump_on)],
        jump_intensity_daily=lam,
        jump_mean=mu,
        jump_sd=sd,
    )


def simulate_paths(
    model: MarketModel, rng: np.random.Generator, n_paths: int, days: int
) -> Paths:
    n_sec = len(model.security_ids)
    n_jump = len(model.jump_columns)
    z = rng.standard_normal((n_paths, days, 4))
    eps = rng.standard_normal((n_paths, days, n_sec))
    counts = rng.poisson(model.jump_intensity_daily, (n_paths, days, n_jump))
    jump_z = rng.standard_normal((n_paths, days, n_jump))

    d_factor = (z @ model.factor_root.T) * model.factor_vol_daily        # (n, days, 4)
    returns = d_factor @ model.loadings.T + eps * model.idio_daily + model.drift_daily
    if n_jump:
        returns[:, :, model.jump_columns] += counts * model.jump_mean + np.sqrt(counts) * model.jump_sd * jump_z

    factors = np.zeros((n_paths, days + 1, 4))
    np.cumsum(d_factor, axis=1, out=factors[:, 1:, :])
    log_price = np.zeros((n_paths, days + 1, n_sec))
    np.cumsum(returns, axis=1, out=log_price[:, 1:, :])
    return Paths(factors=factors, log_price=log_price, jump_counts=counts.sum(axis=1))
