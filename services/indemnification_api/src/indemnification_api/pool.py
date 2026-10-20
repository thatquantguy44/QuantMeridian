"""The cash collateral reinvestment pool (spec020 PLAN section 4, IND-015, IND-016).

Cash collateral is reinvested in a pool of short-term positions. Over a run:

* Each position is revalued by the credit-spread factor times its credit beta times its spread
  duration (WAM / 252). Issuers in the riskier credit buckets can default, with a hazard that rises
  when spreads have widened, and a defaulted position is worth its recovery.
* The cash owed back (``liabilities``) moves with returns, maturities and margin calls. Cash coming
  in is held in the most liquid position. Cash going out is paid from the most liquid positions
  first (T+0, T+1, T+7, TERM); a position's sale pays the profile's market impact cost, never less
  than its bucket's forced-sale floor, scaled up by the stress multiplier. If the pool cannot pay,
  the agent funds the rest.
* The reinvestment loss on a path is the peak over the event grid of the rise in the shortfall of
  pool value against cash owed (``liabilities - NAV``), measured from where it started, so an
  opening gap is data and not risk.
* ``realization`` is what a defaulting borrower's cash collateral is worth at close-out: the cash
  that the same waterfall raises for its share, as a fraction of the cash owed, capped at par. It is
  1 unless the pool lacks the value to pay.

A defaulted borrower's cash is drawn from the pool at close-out, which leaves the pool's own loss as
it was, so the two loss channels do not double count.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from .book import ADVERSE_SIGN
from .grid import YEAR_DAYS, Grid
from .market import FACTORS, MarketModel, Paths
from .profile import resolve_all

LIQUIDITY_ORDER = {"T+0": 0, "T+1": 1, "T+7": 2, "TERM": 3}
CREDIT_BUCKETS = ("HQLA", "AGENCY", "A1/P1", "BANK", "CREDIT")
MIN_PRICE_VOL = 5e-4  # daily price volatility floor for a position with no spread sensitivity
MAX_COST = 0.9999


@dataclass(frozen=True)
class PoolModel:
    ids: list[str]
    alloc: np.ndarray
    order: np.ndarray  # position indices, most liquid first
    spread_exposure: np.ndarray  # spread duration x credit beta
    hazard: np.ndarray  # per year
    recovery: float
    stress_sensitivity: float
    sigma_spread_daily: float
    adv: np.ndarray
    vol: np.ndarray
    k: np.ndarray
    alpha: np.ndarray
    floor: np.ndarray
    cap: np.ndarray
    stress_beta: np.ndarray
    stress_factor: np.ndarray
    even: np.ndarray
    mpor: np.ndarray

    @property
    def n_positions(self) -> int:
        return len(self.ids)


@dataclass(frozen=True)
class PoolRun:
    loss: np.ndarray  # (n,) reinvestment loss per path
    realization: (
        np.ndarray
    )  # (n, B, K) cash collateral realizable fraction if a borrower defaults in step k
    nav: np.ndarray  # (n, K + 1) pool value after each step's payments


def build_pool(snapshot: dict[str, Any], market: MarketModel) -> PoolModel | None:
    positions = snapshot["pool"]["positions"]
    if not positions:
        return None
    risk = snapshot["model"]["pool_risk"]
    rows = {row.position_id: row for row in resolve_all(snapshot) if row.kind == "pool_position"}
    sigma_s = float(market.factor_vol_daily[2])
    n = len(positions)
    spread_exposure = np.zeros(n)
    hazard = np.zeros(n)
    adv, vol, floor, cap, k, alpha = (np.zeros(n) for _ in range(6))
    stress_beta, mpor = np.zeros(n), np.zeros(n, dtype=int)
    stress_factor = np.zeros(n, dtype=int)
    even = np.zeros(n, dtype=bool)
    for i, p in enumerate(positions):
        row, s = rows[p["id"]], rows[p["id"]].settings
        credit, bucket = p["credit_bucket"], p["liquidity_bucket"]
        spread_exposure[i] = (p["wam_days"] / YEAR_DAYS) * risk["credit_beta"][credit]
        hazard[i] = risk["issuer_hazard_annual"][credit]
        adv[i] = risk["daily_liquidity_fraction"][bucket] * p["allocation"]
        vol[i] = (
            row.daily_vol
            if row.daily_vol is not None
            else max(spread_exposure[i] * sigma_s, MIN_PRICE_VOL)
        )
        k[i], alpha[i] = s["impact_k"], s["impact_alpha"]
        floor[i] = max(s["half_spread_floor_bps"], risk["forced_sale_floor_bps"][bucket]) / 1e4
        cap[i] = np.inf if s["cost_cap_bps"] is None else s["cost_cap_bps"] / 1e4
        stress_beta[i], stress_factor[i] = s["stress_beta"], FACTORS.index(s["stress_factor"])
        even[i], mpor[i] = s["unwind"] == "even", row.mpor_days
    order = np.array(
        sorted(range(n), key=lambda i: (LIQUIDITY_ORDER[positions[i]["liquidity_bucket"]], i)),
        dtype=int,
    )
    return PoolModel(
        ids=[p["id"] for p in positions],
        alloc=np.array([p["allocation"] for p in positions], dtype=float),
        order=order,
        spread_exposure=spread_exposure,
        hazard=hazard,
        recovery=risk["issuer_recovery"],
        stress_sensitivity=risk["issuer_stress_sensitivity"],
        sigma_spread_daily=sigma_s,
        adv=adv,
        vol=vol,
        k=k,
        alpha=alpha,
        floor=floor,
        cap=cap,
        stress_beta=stress_beta,
        stress_factor=stress_factor,
        even=even,
        mpor=mpor,
    )


def draw_pool_noise(
    rng: np.random.Generator, n_paths: int, steps: int, n_positions: int
) -> np.ndarray:
    """Uniform draws for issuer defaults, (n, K, J)."""
    return rng.random((n_paths, steps, n_positions))


def _adverse_z(model: PoolModel, market: MarketModel, paths: Paths, days: np.ndarray) -> np.ndarray:
    """(n, J): how far the stress factor of each position has moved against liquidity by `days` (per
    position).
    """
    f = model.stress_factor
    level = paths.factors[:, days, f]
    return ADVERSE_SIGN[f] * level / (market.factor_vol_daily[f] * np.sqrt(days))


def _cost(model: PoolModel, j: int, q: np.ndarray, z: np.ndarray) -> np.ndarray:
    traded = q / model.mpor[j] if model.even[j] else q
    raw = model.k[j] * model.vol[j] * np.power(traded / model.adv[j], model.alpha[j])
    cost = np.minimum(np.maximum(raw, model.floor[j]), model.cap[j])
    if model.stress_beta[j] > 0:
        z = z.reshape(z.shape + (1,) * (q.ndim - 1))
        cost = cost * (1.0 + model.stress_beta[j] * np.maximum(0.0, z))
    return np.minimum(cost, MAX_COST)


def _waterfall(
    model: PoolModel, gross: np.ndarray, need: np.ndarray, z: np.ndarray
) -> tuple[list[tuple[int, np.ndarray]], np.ndarray]:
    """Raise `need` in cash, most liquid first. Returns the gross value sold from each position and
    the cash raised.
    """
    remaining = need.copy()
    sold = []
    for j in model.order:
        avail = np.maximum(gross[:, j], 0.0).reshape((len(gross),) + (1,) * (need.ndim - 1))
        cost = _cost(model, j, np.minimum(avail, remaining), z[:, j])
        q = np.minimum(avail, remaining / (1.0 - cost))
        remaining = np.maximum(remaining - q * (1.0 - cost), 0.0)
        sold.append((int(j), q))
    return sold, need - remaining


def run_pool(
    model: PoolModel,
    market: MarketModel,
    paths: Paths,
    grid: Grid,
    liabilities: np.ndarray,
    u: np.ndarray,
) -> PoolRun:
    """Simulate the pool against `liabilities` (n, B, K + 1), the cash owed to each borrower."""
    n, n_b, _ = liabilities.shape
    days, steps = grid.event_days, len(grid.event_days) - 1
    spread = paths.factors[:, :, 2]
    owed = liabilities.sum(axis=1)
    held = np.ones((n, model.n_positions))
    defaulted = np.zeros((n, model.n_positions), dtype=bool)
    loss = np.zeros(n)
    nav = np.zeros((n, steps + 1))
    realization = np.ones((n, n_b, steps))
    opening_gap = owed[:, 0] - model.alloc.sum()
    nav[:, 0] = model.alloc.sum()
    most_liquid = int(model.order[0])
    tiny = 1e-12

    for k in range(1, steps + 1):
        t, dt = int(days[k]), int(days[k] - days[k - 1])
        price = np.exp(-model.spread_exposure * spread[:, t, None])
        z_spread = spread[:, t] / (model.sigma_spread_daily * np.sqrt(t))
        stress = 1.0 + model.stress_sensitivity * np.maximum(0.0, z_spread)
        p_default = -np.expm1(-model.hazard * stress[:, None] * dt / YEAR_DAYS)
        defaulted |= u[:, k - 1, :] < p_default
        unit = model.alloc * price * np.where(defaulted, model.recovery, 1.0)
        gross = unit * held

        change = owed[:, k] - owed[:, k - 1]
        inflow = np.maximum(change, 0.0)
        held[:, most_liquid] += inflow / np.maximum(unit[:, most_liquid], tiny)
        gross[:, most_liquid] += inflow
        outflow = np.maximum(-change, 0.0)
        z_now = _adverse_z(model, market, paths, np.full(model.n_positions, t))
        sold, _ = _waterfall(model, gross, outflow, z_now)
        for j, q in sold:
            gross[:, j] = np.maximum(gross[:, j] - q, 0.0)
            held[:, j] = np.maximum(held[:, j] - q / np.maximum(unit[:, j], tiny), 0.0)
        value = gross.sum(axis=1)
        nav[:, k] = value
        loss = np.maximum(loss, (owed[:, k] - value) - opening_gap)

        # what a borrower defaulting now could realize at close-out, from the same waterfall
        close = t + model.mpor
        price_close = np.exp(-model.spread_exposure * spread[:, close])
        gross_close = model.alloc * held * price_close * np.where(defaulted, model.recovery, 1.0)
        z_close = _adverse_z(model, market, paths, close)
        need = liabilities[:, :, k]
        _, raised = _waterfall(model, gross_close, need, z_close)
        with np.errstate(divide="ignore", invalid="ignore"):
            realization[:, :, k - 1] = np.where(need > 0, np.minimum(1.0, raised / need), 1.0)
    return PoolRun(loss=loss, realization=realization, nav=nav)
