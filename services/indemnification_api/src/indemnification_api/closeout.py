"""Close-out shortfall and exposure per path, borrower and event step (spec020 PLAN section 3).

If borrower b defaults at event day d the agent buys back the loaned securities over the close-out
period and sells the collateral, and the shortfall is what the sales fall short of the buy-backs:

* Loans: ``q * P(d + M) * (1 + cost)`` per leg, where ``P(d + M)`` is the path's own price M
  business days later (or the average of the daily prices for an even unwind) and ``cost`` is the
  liquidity cost of the aggregate leg quantity.
* Collateral was last reset at the borrower's most recent margin call ``t_m <= d`` to ``margin * q *
  P(t_m)`` per loan, so a price move since that call is a margin lag shortfall. Cash is worth its
  par times the pool's realization ratio; securities are worth ``Q * P(d + M) * (1 - cost)``.
* Shortfall is ``max(0, loans - collateral)``.

Exposure at day d is the margin-period-of-risk exposure: the same difference before liquidity costs
and with cash at par, ``max(0, loans at d + M - collateral as of the last margin call)``. A book
margined every day still has exposure, because prices move over the close-out period; "current"
exposure would be zero.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from .book import ADVERSE_SIGN, Book, Legs
from .grid import Grid
from .market import MarketModel, Paths


@dataclass(frozen=True)
class Evaluation:
    shortfall: np.ndarray  # (n, B, K): loss if the borrower defaults in event step k = 1..K
    exposure: np.ndarray  # (n, B, K + 1): current exposure at event days 0..K


Activity = Callable[[int], np.ndarray]
Realization = Callable[[int, int], np.ndarray]


def required_days(book: Book, grid: Grid) -> int:
    """Days of prices to simulate: the horizon plus the longest close-out period."""
    return grid.horizon_days + book.max_mpor


def default_activity(book: Book) -> Activity:
    """Desk view: term loans end at maturity. Annual view: the book is constant (matured loans
    roll).
    """
    if book.mode == "annual":
        return lambda day: np.ones(len(book.loan_ids), dtype=bool)
    return lambda day: day < book.loan_maturity


def _prices(market: MarketModel, paths: Paths, secs: np.ndarray, days: np.ndarray) -> np.ndarray:
    return market.price0[secs] * np.exp(paths.log_price[:, days, secs])


def _leg_prices(market: MarketModel, paths: Paths, legs: Legs, day: int) -> np.ndarray:
    price = _prices(market, paths, legs.sec, day + legs.mpor)
    for g in np.flatnonzero(legs.even):
        window = np.exp(paths.log_price[:, day + 1 : day + int(legs.mpor[g]) + 1, legs.sec[g]])
        price[:, g] = market.price0[legs.sec[g]] * window.mean(axis=1)
    return price


def _leg_costs(
    market: MarketModel, paths: Paths, legs: Legs, quantity: np.ndarray, day: int
) -> np.ndarray:
    traded = np.where(legs.even, quantity / legs.mpor, quantity)
    raw = legs.k * legs.vol * np.power(traded / legs.adv, legs.alpha)
    cost = np.minimum(np.maximum(raw, legs.floor), legs.cap)
    for g in np.flatnonzero(legs.stress_beta > 0):
        end = day + int(legs.mpor[g])
        f = int(legs.stress_factor[g])
        z = paths.factors[:, end, f] / (market.factor_vol_daily[f] * np.sqrt(end))
        cost[:, g] = cost[:, g] * (1.0 + legs.stress_beta[g] * np.maximum(0.0, ADVERSE_SIGN[f] * z))
    return cost


def _onehot(index: np.ndarray, size: int) -> np.ndarray:
    m = np.zeros((len(index), size))
    m[np.arange(len(index)), index] = 1.0
    return m


def evaluate(
    book: Book,
    market: MarketModel,
    paths: Paths,
    grid: Grid,
    *,
    activity: Activity | None = None,
    realization: Realization | None = None,
) -> Evaluation:
    needed = required_days(book, grid)
    if paths.log_price.shape[1] - 1 < needed:
        raise ValueError(f"paths cover {paths.log_price.shape[1] - 1} days but {needed} are needed")
    activity = activity or default_activity(book)
    n = paths.log_price.shape[0]
    n_b, n_loans = book.n_borrowers, len(book.loan_ids)
    steps = len(grid.event_days) - 1

    by_borrower = _onehot(book.loan_borrower, n_b)  # (L, B)
    by_leg = _onehot(book.loan_leg, len(book.loan_legs)) if n_loans else np.zeros((0, 0))
    leg_to_borrower = _onehot(book.loan_legs.borrower, n_b)  # (G, B)
    coll = book.coll_legs
    coll_to_borrower = _onehot(coll.borrower, n_b)  # (Cg, B)

    shortfall = np.zeros((n, n_b, steps))
    exposure = np.zeros((n, n_b, steps + 1))
    for k, day in enumerate(grid.event_days):
        day = int(day)
        active = np.asarray(activity(day), dtype=float)  # (L,) or (n, L)
        qty = active * book.loan_qty  # (L,) or (n, L)
        t_loan = day - day % book.loan_call
        t_borrower = day - day % book.borrower_call

        required = qty * book.loan_margin * _prices(market, paths, book.loan_sec, t_loan)  # (n, L)
        cash_req = (required * book.loan_cash) @ by_borrower  # (n, B)
        noncash_req = (required * ~book.loan_cash) @ by_borrower

        if len(coll):
            held = (
                noncash_req[:, coll.borrower]
                * coll.weight
                / _prices(market, paths, coll.sec, t_borrower[coll.borrower])
            )
        else:
            held = None
        if k == 0:
            continue  # nothing is exposed before the first step

        leg_qty = np.broadcast_to(qty @ by_leg, (n, len(book.loan_legs)))
        loan_prices = _leg_prices(market, paths, book.loan_legs, day)
        loan_raw = (leg_qty * loan_prices) @ leg_to_borrower
        loan_value = (
            leg_qty * loan_prices * (1.0 + _leg_costs(market, paths, book.loan_legs, leg_qty, day))
        ) @ leg_to_borrower
        rho = np.ones((n, n_b)) if realization is None else realization(k, day)
        collateral_raw = cash_req
        collateral_value = cash_req * rho
        if held is not None:
            coll_prices = _leg_prices(market, paths, coll, day)
            collateral_raw = collateral_raw + (held * coll_prices) @ coll_to_borrower
            collateral_value = (
                collateral_value
                + (held * coll_prices * (1.0 - _leg_costs(market, paths, coll, held, day)))
                @ coll_to_borrower
            )
        exposure[:, :, k] = np.maximum(0.0, loan_raw - collateral_raw)
        shortfall[:, :, k - 1] = np.maximum(0.0, loan_value - collateral_value)
    return Evaluation(shortfall, exposure)
