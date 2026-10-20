"""Run orchestration (spec020 PLAN sections 0-3, IND-003 to IND-007, IND-019, IND-021).

A run is split into fixed-size chunks of paths. Each chunk has its own random stream spawned from
the run's seed, so a seed reproduces a run exactly and the first half of the chunks is a valid
half-size run (used for the convergence check). Within a chunk the market paths and the default
draws are made once; the three default variants (Gaussian with and without the wrong-way link, and
Student-t) reuse them, so differences between variants are the model's, not noise.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .book import Book, build_book
from .closeout import evaluate, required_days
from .credit import BorrowerCredit, resolve_credit
from .defaults import (
    GAUSSIAN,
    STUDENT_T,
    conditional_step_probs,
    default_steps,
    default_times_years,
    draw_default_noise,
    latent_mean,
)
from .grid import Grid, build_grid
from .market import MarketModel, build_market, simulate_paths
from .schema import require_valid_snapshot

CHUNK_PATHS = 5000
MAX_EXPOSURE_BYTES = 2_000_000_000
GAUSSIAN_WW, GAUSSIAN_NO_WW, STUDENT_T_WW = "gaussian_ww", "gaussian_no_ww", "student_t"


@dataclass
class VariantLosses:
    cond: np.ndarray  # (n, B) probability-weighted shortfall: the low-variance EL estimator
    sampled: np.ndarray  # (n, B) shortfall if the borrower defaulted in the path (VaR, ES, Euler)


@dataclass
class RunOutput:
    grid: Grid
    book: Book
    market: MarketModel
    credits: list[BorrowerCredit]
    n_paths: int
    chunk_bounds: list[tuple[int, int]]
    exposure: np.ndarray  # (n, B, K + 1) float32
    variants: dict[str, VariantLosses]
    pool_loss: np.ndarray  # (n,) reinvestment channel
    extras: dict[str, Any] = field(default_factory=dict)


def _chunk_sizes(n_paths: int) -> list[int]:
    full, rest = divmod(n_paths, CHUNK_PATHS)
    return [CHUNK_PATHS] * full + ([rest] if rest else [])


def variant_names(snapshot: dict[str, Any]) -> list[str]:
    names = [GAUSSIAN_WW, GAUSSIAN_NO_WW]
    if snapshot["model"]["student_t_enabled"]:
        names.append(STUDENT_T_WW)
    return names


def simulate(
    snapshot: dict[str, Any], *, validate: bool = True, hazards: np.ndarray | None = None
) -> RunOutput:
    """Run the simulation. ``hazards`` overrides the snapshot's credit inputs (used by tests)."""
    if validate:
        require_valid_snapshot(snapshot)
    run, model = snapshot["run"], snapshot["model"]
    market = build_market(snapshot)
    book = build_book(snapshot, market)
    grid = build_grid(run)
    n_b, n_events = book.n_borrowers, len(grid.event_days)
    n_paths = int(run["paths"])

    if n_paths * n_b * n_events * 4 > MAX_EXPOSURE_BYTES:
        raise ValueError(
            f"{n_paths} paths x {n_b} borrowers x {n_events} event days needs more than "
            f"{MAX_EXPOSURE_BYTES / 1e9:.0f} GB for exposures; "
            "reduce paths, horizon or use a coarser step"
        )

    credit_by_id = resolve_credit(snapshot)
    credits = [credit_by_id[b] for b in book.borrower_ids]
    lam = (
        np.array([c.hazard for c in credits])
        if hazards is None
        else np.asarray(hazards, dtype=float)
    )

    sizes = _chunk_sizes(n_paths)
    streams = np.random.SeedSequence(int(run["seed"])).spawn(len(sizes))
    days = required_days(book, grid)
    names = variant_names(snapshot)
    cond = {v: np.zeros((n_paths, n_b)) for v in names}
    sampled = {v: np.zeros((n_paths, n_b)) for v in names}
    exposure = np.zeros((n_paths, n_b, n_events), dtype=np.float32)
    bounds: list[tuple[int, int]] = []

    start = 0
    for size, stream in zip(sizes, streams, strict=True):
        rng = np.random.default_rng(stream)
        paths = simulate_paths(market, rng, size, days)
        evaluation = evaluate(book, market, paths, grid)
        z_eq = paths.standardized_equity(grid.horizon_days, market)
        noise = draw_default_noise(rng, size, n_b, model["student_t_nu"])
        sl = slice(start, start + size)
        exposure[sl] = evaluation.exposure
        for name in names:
            rho_w = 0.0 if name == GAUSSIAN_NO_WW else model["rho_w"]
            kind = STUDENT_T if name == STUDENT_T_WW else GAUSSIAN
            a = latent_mean(z_eq, noise, book.signs, model["rho_d"], rho_w)
            with np.errstate(divide="ignore", invalid="ignore"):
                probs = conditional_step_probs(
                    lam, a, noise, model["rho_d"], grid, kind=kind, nu=model["student_t_nu"]
                )
                tau = default_times_years(
                    lam, a, noise, model["rho_d"], kind=kind, nu=model["student_t_nu"]
                )
            probs = np.nan_to_num(probs)
            cond[name][sl] = (probs * evaluation.shortfall).sum(axis=2)
            steps = default_steps(tau, grid)
            picked = np.take_along_axis(
                evaluation.shortfall, np.maximum(steps - 1, 0)[:, :, None], axis=2
            )[:, :, 0]
            sampled[name][sl] = np.where(steps > 0, picked, 0.0)
        bounds.append((start, start + size))
        start += size

    return RunOutput(
        grid=grid,
        book=book,
        market=market,
        credits=credits,
        n_paths=n_paths,
        chunk_bounds=bounds,
        exposure=exposure,
        variants={v: VariantLosses(cond[v], sampled[v]) for v in names},
        pool_loss=np.zeros(n_paths),
    )
