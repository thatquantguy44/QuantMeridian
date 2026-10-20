"""Open-loan returns and the loans on loan at each step (spec020 PLAN section 4, decision 5)."""

import math

import numpy as np
import pytest
from conftest import loan, mini_snapshot

from indemnification_api.book import build_book
from indemnification_api.grid import build_grid
from indemnification_api.market import build_market
from indemnification_api.returns import build_activity, draw_return_noise

N = 200_000


def setup(snapshot, loans, *, mode="desk", horizon=21, step="daily", returns=None):
    snap = mini_snapshot(snapshot, loans=loans)
    snap["run"] = {**snap["run"], "mode": mode, "horizon_days": horizon, "step": step}
    if returns:
        snap["model"] = {**snap["model"], "returns": {**snap["model"]["returns"], **returns}}
    book = build_book(snap, build_market(snap))
    return snap, book, build_grid(snap["run"])


def activity(snap, book, grid, z_eq=None, seed=1, n=N):
    rng = np.random.default_rng(seed)
    noise = draw_return_noise(rng, n, len(grid.event_days) - 1, len(book.loan_ids))
    z = np.zeros(n) if z_eq is None else np.full(n, z_eq)
    return build_activity(book, snap["model"]["returns"], z, grid, noise)


def se(p, n=N):
    return math.sqrt(p * (1 - p) / n)


def test_an_open_loan_returns_at_the_stated_rate(snapshot):
    snap, book, grid = setup(snapshot, [loan("L1"), loan("L2", recallable=True)])
    a = activity(snap, book, grid)
    assert a.shape == (N, 22, 2) and a[:, 0, :].all()
    for col, hazard in ((0, 3.0), (1, 4.5)):  # recallable x1.5
        expected = math.exp(-hazard * 21 / 252)
        assert abs(a[:, 21, col].mean() - expected) < 4 * se(expected), col


def test_a_returned_open_loan_stays_returned_in_the_desk_view(snapshot):
    snap, book, grid = setup(snapshot, [loan("L1")])
    a = activity(snap, book, grid, n=20_000)
    assert (np.diff(a[:, :, 0].astype(int), axis=1) <= 0).all()


def test_returns_come_in_waves_when_equities_fall_but_not_faster_when_they_rise(snapshot):
    snap, book, grid = setup(snapshot, [loan("L1")])
    calm = activity(snap, book, grid, z_eq=0.0)[:, 21, 0].mean()
    up = activity(snap, book, grid, z_eq=+2.0)[:, 21, 0].mean()
    down = activity(snap, book, grid, z_eq=-2.0)[:, 21, 0].mean()
    assert up == calm  # same draws, no extra hazard
    stressed = math.exp(-3.0 * math.exp(0.5 * 2.0) * 21 / 252)
    assert abs(down - stressed) < 4 * se(stressed) and down < calm - 0.2


def test_a_term_loan_is_on_until_maturity_and_never_returns_early(snapshot):
    snap, book, grid = setup(snapshot, [loan("L1", term="term", maturity=8)])
    a = activity(snap, book, grid, n=1000, z_eq=-3.0)
    assert a[:, :8, 0].all() and not a[:, 8:, 0].any()


def test_the_annual_view_keeps_the_book_constant_apart_from_the_step_a_loan_returns(snapshot):
    snap, book, grid = setup(snapshot, [loan("L1")], mode="annual", horizon=252, step="weekly")
    a = activity(snap, book, grid)
    assert a[:, 0, 0].all()
    p_off = 1 - math.exp(-3.0 * 5 / 252)
    for k in (1, 10, 40):
        assert abs((~a[:, k, 0]).mean() - p_off) < 4 * se(p_off), k
    assert not (np.diff(a[:, :, 0].astype(int), axis=1) <= 0).all()  # returned loans are replaced


def test_in_the_annual_view_a_term_loan_is_off_only_on_the_steps_that_cross_a_maturity(snapshot):
    snap, book, grid = setup(
        snapshot, [loan("L1", term="term", maturity=8)], mode="annual", horizon=21, step="daily"
    )
    a = activity(snap, book, grid, n=10)
    off = [k for k in range(22) if not a[0, k, 0]]
    assert off == [8, 16]


def test_the_same_noise_gives_the_same_activity(snapshot):
    snap, book, grid = setup(snapshot, [loan("L1")])
    assert np.array_equal(activity(snap, book, grid, n=1000), activity(snap, book, grid, n=1000))
    assert not np.array_equal(
        activity(snap, book, grid, n=1000), activity(snap, book, grid, n=1000, seed=2)
    )


def test_a_zero_return_rate_keeps_every_open_loan_on(snapshot):
    snap, book, grid = setup(snapshot, [loan("L1")], returns={"open_loan_hazard_annual": 0.0})
    assert activity(snap, book, grid, n=1000, z_eq=-3.0).all()


@pytest.mark.parametrize("mode", ["desk", "annual"])
def test_activity_is_a_boolean_array_over_paths_event_days_and_loans(snapshot, mode):
    snap, book, grid = setup(snapshot, [loan("L1"), loan("L2", term="term", maturity=5)], mode=mode)
    a = activity(snap, book, grid, n=50)
    assert a.dtype == bool and a.shape == (50, len(grid.event_days), 2)
