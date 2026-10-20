"""Borrower default times (spec020 decisions 3 and 4, IND-004, IND-007, IND-019).

One-factor copula. Borrower b's latent variable is

    X_b = -s_b * rho_w * Z_eq + sqrt(rho_d - rho_w^2) * Z_sys + sqrt(1 - rho_d) * eps_b

where Z_eq is the standardized equity factor over the run horizon, Z_sys a shared credit factor and
eps_b the borrower's own noise. ``s_b`` is +1 when the borrower's exposure rises with equities (it
is a short borrower: a rally squeezes it) and -1 when it falls with them (a crash hits its
collateral), so the link is always to markets that hurt the lender. Setting ``rho_w = 0`` removes
the link and leaves every other draw unchanged. Pairwise latent correlation is ``rho_d`` for
borrowers with the same sign.

Default is by time t when X_b falls below the PD(t) quantile, so with a constant hazard the default
time is ``-ln(1 - U_b) / lambda_b`` with ``U_b = Phi(X_b)``. The Student-t variant divides X_b by
sqrt(W / nu) with W ~ chi-square(nu) shared by all borrowers on a path and uses t quantiles, so
every marginal PD is unchanged while joint defaults cluster more in the tail.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.stats import norm
from scipy.stats import t as student_t

from .grid import YEAR_DAYS, Grid

GAUSSIAN = "gaussian"
STUDENT_T = "student_t"


@dataclass(frozen=True)
class DefaultNoise:
    z_sys: np.ndarray  # (n,)
    eps: np.ndarray  # (n, B)
    w: np.ndarray  # (n,) chi-square(nu) draws


def draw_default_noise(
    rng: np.random.Generator, n_paths: int, n_borrowers: int, nu: int
) -> DefaultNoise:
    """All default randomness for a run, drawn once so every variant of the run can reuse it."""
    z_sys = rng.standard_normal(n_paths)
    eps = rng.standard_normal((n_paths, n_borrowers))
    w = rng.chisquare(nu, n_paths)
    return DefaultNoise(z_sys, eps, w)


def _check(rho_d: float, rho_w: float) -> None:
    if rho_w**2 > rho_d:
        raise ValueError(f"rho_w^2 ({rho_w**2}) must not exceed rho_d ({rho_d})")


def latent_mean(
    z_eq: np.ndarray, noise: DefaultNoise, signs: np.ndarray, rho_d: float, rho_w: float
) -> np.ndarray:
    """The part of X_b shared across paths' factors: equity link plus the shared credit factor, (n,
    B).
    """
    _check(rho_d, rho_w)
    return -rho_w * np.outer(z_eq, signs) + np.sqrt(rho_d - rho_w**2) * noise.z_sys[:, None]


def _latent(a: np.ndarray, noise: DefaultNoise, rho_d: float) -> np.ndarray:
    return a + np.sqrt(1.0 - rho_d) * noise.eps


def default_times_years(
    hazards: np.ndarray, a: np.ndarray, noise: DefaultNoise, rho_d: float, *, kind: str, nu: int
) -> np.ndarray:
    """Default time in years for every path and borrower (may exceed the horizon), (n, B)."""
    x = _latent(a, noise, rho_d)
    if kind == STUDENT_T:
        u = student_t.cdf(x / np.sqrt(noise.w / nu)[:, None], nu)
    elif kind == GAUSSIAN:
        u = norm.cdf(x)
    else:
        raise ValueError(f"unknown copula {kind}")
    return -np.log1p(-u) / hazards


def default_steps(tau_years: np.ndarray, grid: Grid) -> np.ndarray:
    """Event-grid step in which each default falls (1..K), or 0 for no default by the horizon."""
    days = tau_years * YEAR_DAYS
    steps = np.searchsorted(grid.event_days, days, side="left")
    steps[steps >= len(grid.event_days)] = 0
    return steps


def conditional_step_probs(
    hazards: np.ndarray,
    a: np.ndarray,
    noise: DefaultNoise,
    rho_d: float,
    grid: Grid,
    *,
    kind: str,
    nu: int,
) -> np.ndarray:
    """P(default falls in step k | the path's factors), shape (n, B, K).

    Given the shared factors (and W for the Student-t) the borrower's own noise is the only
    randomness left, so these are exact. Averaging a loss weighted by them estimates expected loss
    without the noise of sampling rare defaults.
    """
    years = grid.years[1:]  # (K,)
    pd = -np.expm1(-hazards[:, None] * years[None, :])  # (B, K)
    if kind == STUDENT_T:
        scale = np.sqrt(noise.w / nu)[:, None, None]
        thresholds = scale * student_t.ppf(pd, nu)[None, :, :]
    elif kind == GAUSSIAN:
        thresholds = norm.ppf(pd)[None, :, :]
    else:
        raise ValueError(f"unknown copula {kind}")
    cumulative = norm.cdf((thresholds - a[:, :, None]) / np.sqrt(1.0 - rho_d))  # (n, B, K)
    return np.diff(cumulative, axis=2, prepend=0.0)
