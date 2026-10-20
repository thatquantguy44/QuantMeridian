"""Close-out shortfall and exposure on hand-built price paths (spec020 IND-005, IND-016, AC-004).

Each case sets the exact prices on a few paths, so every expected shortfall is a number computed by hand.
"""

import copy
import math

import numpy as np
import pytest
from conftest import cash_holding, loan, mini_snapshot, security_holding
from indemnification_api.book import build_book
from indemnification_api.closeout import evaluate, required_days
from indemnification_api.grid import build_grid
from indemnification_api.market import Paths, build_market

EQ, GV = 0, 1


def setup(base, loans, collateral=None, *, mode="desk", horizon=21, securities=None, edit=None, **kw):
    snap = mini_snapshot(base, loans=loans, collateral=collateral, securities=securities, **kw)
    snap["run"] = {**snap["run"], "mode": mode, "horizon_days": horizon, "step": "daily"}
    snap["closeout_profile"]["defaults"]["impact_k"] = 0.0          # costs off unless a test turns them on
    if edit:
        edit(snap)
    market = build_market(snap)
    book = build_book(snap, market)
    grid = build_grid(snap["run"])
    return snap, market, book, grid


def flat_paths(market, book, grid, n=3):
    days = required_days(book, grid)
    return Paths(
        factors=np.zeros((n, days + 1, 4)),
        log_price=np.zeros((n, days + 1, len(market.security_ids))),
        jump_counts=np.zeros((n, 0), dtype=int),
    )


def set_price(paths, path, sec, from_day, price_ratio, to_day=None):
    paths.log_price[path, from_day : (to_day + 1 if to_day is not None else None), sec] = math.log(price_ratio)


def step_of(grid, day):
    return int(np.flatnonzero(grid.event_days == day)[0])


def test_a_fully_collateralized_loan_with_no_price_move_has_no_shortfall(snapshot):
    snap, market, book, grid = setup(snapshot, [loan(margin=105.0)])
    snap_costs = copy.deepcopy(snap)
    snap_costs["closeout_profile"]["defaults"]["impact_k"] = 0.5     # AC-004 holds with costs on too
    for s in (snap, snap_costs):
        m = build_market(s)
        b = build_book(s, m)
        result = evaluate(b, m, flat_paths(m, b, grid), grid)
        assert result.shortfall.max() == 0.0


def test_a_price_rise_over_the_close_out_period_leaves_a_shortfall(snapshot):
    snap, market, book, grid = setup(snapshot, [loan(quantity=1000, margin=102.0)])
    paths = flat_paths(market, book, grid)
    set_price(paths, 1, EQ, 15, 1.05)           # +5% from day 15 on
    result = evaluate(book, market, paths, grid)
    # default on day 10: collateral reset at day 10 to 102,000; M = 5, buy-back at day 15 price 105
    assert result.shortfall[1, 0, step_of(grid, 10) - 1] == pytest.approx(1000 * 105 - 102_000)
    assert result.shortfall[0].max() == 0.0     # a flat path has none
    # default on day 9: close-out on day 14, before the rise
    assert result.shortfall[1, 0, step_of(grid, 9) - 1] == 0.0
    # default on day 15: collateral is reset to the higher price that day, so the rise is covered
    assert result.shortfall[1, 0, step_of(grid, 15) - 1] == 0.0


def test_the_buy_back_pays_the_liquidity_cost_on_the_aggregate_quantity(snapshot):
    snap, market, book, grid = setup(snapshot, [loan("L1", quantity=600), loan("L2", quantity=400)],
                                     edit=lambda s: s["closeout_profile"]["defaults"].update(impact_k=0.5))
    assert len(book.loan_legs) == 1                       # same borrower, security and settings: one leg
    paths = flat_paths(market, book, grid)
    set_price(paths, 1, EQ, 15, 1.02)
    cost = 0.5 * 0.02 * math.sqrt(1000 / 1_000_000)       # k * vol * (q / ADV) ** alpha on all 1,000
    result = evaluate(book, market, paths, grid)
    expected = 1000 * 102 * (1 + cost) - 102_000
    assert result.shortfall[1, 0, step_of(grid, 10) - 1] == pytest.approx(expected, rel=1e-12)


def test_cost_floor_and_cap(snapshot):
    def run_with(**changes):
        snap, market, book, grid = setup(snapshot, [loan(quantity=1000)],
                                         edit=lambda s: s["closeout_profile"]["defaults"].update(impact_k=0.5, **changes))
        paths = flat_paths(market, book, grid)
        set_price(paths, 1, EQ, 15, 1.02)
        return evaluate(book, market, paths, grid).shortfall[1, 0, step_of(grid, 10) - 1]

    assert run_with(half_spread_floor_bps=50.0) == pytest.approx(102_000 * 1.005 - 102_000)
    assert run_with(cost_cap_bps=1.0) == pytest.approx(102_000 * 1.0001 - 102_000)


def test_margin_lag_leaves_a_shortfall_that_daily_calls_remove(snapshot):
    for call, expected in ((5, 1000 * 104 - 102_000), (1, 0.0)):
        def edit(s, call=call):
            s["closeout_profile"]["defaults"]["margin_call_every_days"] = call
        snap, market, book, grid = setup(snapshot, [loan(quantity=1000)], edit=edit)
        paths = flat_paths(market, book, grid)
        set_price(paths, 1, EQ, 6, 1.04)        # the rise happens after the day-5 call
        shortfall = evaluate(book, market, paths, grid).shortfall[1, 0, step_of(grid, 7) - 1]
        assert shortfall == pytest.approx(expected), call


def test_non_cash_collateral_is_sold_net_of_its_own_cost_and_close_out_period(snapshot):
    snap, market, book, grid = setup(
        snapshot, [loan(quantity=1000, cash=False)], [security_holding(quantity=1020.0)],
        edit=lambda s: s["closeout_profile"]["defaults"].update(impact_k=0.5),
    )
    paths = flat_paths(market, book, grid)
    set_price(paths, 1, GV, 15, 0.95)           # the collateral falls 5% over the close-out period
    held = 102_000 / 100                        # units bought at the day-10 price of 100
    cost_loan = 0.5 * 0.02 * math.sqrt(1000 / 1_000_000)
    cost_coll = 0.5 * 0.003 * math.sqrt(held / 5_000_000)
    expected = 1000 * 100 * (1 + cost_loan) - held * 95 * (1 - cost_coll)
    result = evaluate(book, market, paths, grid)
    assert result.shortfall[1, 0, step_of(grid, 10) - 1] == pytest.approx(expected, rel=1e-12)


def test_a_term_loan_stops_at_maturity_in_the_desk_view_and_rolls_in_the_annual_view(snapshot):
    for mode, after in (("desk", 0.0), ("annual", None)):
        snap, market, book, grid = setup(snapshot, [loan(term="term", maturity=8, quantity=1000)], mode=mode)
        paths = flat_paths(market, book, grid)
        set_price(paths, 1, EQ, 15, 1.10)
        result = evaluate(book, market, paths, grid)
        k = step_of(grid, 10) - 1
        if after == 0.0:
            assert result.shortfall[1, 0, k] == 0.0                       # matured on day 8
            assert result.shortfall[1, 0, step_of(grid, 7) - 1] == 0.0    # 7 + 5 = day 12, still flat
            assert result.exposure[1, 0, step_of(grid, 7)] == 0.0
        else:
            assert result.shortfall[1, 0, k] == pytest.approx(1000 * 110 - 102_000)


def test_even_unwind_uses_the_average_price_and_the_lower_cost(snapshot):
    snap, market, book, grid = setup(
        snapshot, [loan(quantity=1000)],
        edit=lambda s: s["closeout_profile"]["defaults"].update(impact_k=0.5, unwind="even"),
    )
    paths = flat_paths(market, book, grid)
    for day, ratio in zip(range(11, 16), (1.01, 1.02, 1.03, 1.04, 1.05), strict=True):
        set_price(paths, 1, EQ, day, ratio, to_day=day)
    paths.log_price[1, 16:, EQ] = math.log(1.05)
    cost = 0.5 * 0.02 * math.sqrt((1000 / 5) / 1_000_000)
    expected = 1000 * 103 * (1 + cost) - 102_000
    assert evaluate(book, market, paths, grid).shortfall[1, 0, step_of(grid, 10) - 1] == pytest.approx(expected, rel=1e-12)


def test_the_stress_multiplier_raises_the_cost_when_the_chosen_factor_moves_against_liquidity(snapshot):
    def edit(s):
        s["closeout_profile"]["defaults"].update(impact_k=0.5, stress_beta=2.0, stress_factor="equity")

    snap, market, book, grid = setup(snapshot, [loan(quantity=1000)], edit=edit)
    paths = flat_paths(market, book, grid)
    set_price(paths, 1, EQ, 15, 1.02)
    set_price(paths, 2, EQ, 15, 1.02)
    # path 1: equity factor down 1 sigma by day 15 (adverse); path 2: up 1 sigma (not adverse)
    paths.factors[1, 15, 0] = -market.factor_vol_daily[0] * math.sqrt(15)
    paths.factors[2, 15, 0] = +market.factor_vol_daily[0] * math.sqrt(15)
    raw = 0.5 * 0.02 * math.sqrt(1000 / 1_000_000)
    result = evaluate(book, market, paths, grid)
    k = step_of(grid, 10) - 1
    assert result.shortfall[1, 0, k] == pytest.approx(102_000 * (1 + 3 * raw) - 102_000, rel=1e-9)
    assert result.shortfall[2, 0, k] == pytest.approx(102_000 * (1 + raw) - 102_000, rel=1e-9)


def test_cash_collateral_is_worth_par_times_the_pool_realization(snapshot):
    snap, market, book, grid = setup(snapshot, [loan(quantity=1000)])
    paths = flat_paths(market, book, grid)
    result = evaluate(book, market, paths, grid, realization=lambda k, day: np.full((3, 1), 0.9))
    assert result.shortfall[0, 0, 5] == pytest.approx(1000 * 100 - 0.9 * 102_000)


def test_exposure_is_the_current_loan_value_less_collateral_at_the_last_margin_call(snapshot):
    def edit(s):
        s["closeout_profile"]["defaults"]["margin_call_every_days"] = 20
    snap, market, book, grid = setup(snapshot, [loan(quantity=1000)], edit=edit)
    paths = flat_paths(market, book, grid)
    set_price(paths, 1, EQ, 12, 1.05)
    result = evaluate(book, market, paths, grid)
    assert result.exposure[1, 0, 0] == 0.0
    assert result.exposure[1, 0, step_of(grid, 11)] == 0.0
    assert result.exposure[1, 0, step_of(grid, 12)] == pytest.approx(1000 * 105 - 102_000)
    assert result.exposure[0].max() == 0.0


def test_borrowers_are_independent(snapshot):
    borrowers = [
        {"id": "B1", "name": "Alderwood Capital", "rating": "A", "spread_bps": None, "recovery": None, "credit_provenance": "sim"},
        {"id": "B2", "name": "Harrowgate Partners", "rating": "BBB", "spread_bps": None, "recovery": None, "credit_provenance": "sim"},
    ]
    snap, market, book, grid = setup(snapshot, [loan("L1", borrower="B1", security="EQ"), loan("L2", borrower="B2", security="GV", quantity=500)],
                                     borrowers=borrowers)
    paths = flat_paths(market, book, grid)
    set_price(paths, 1, EQ, 15, 1.05)
    result = evaluate(book, market, paths, grid)
    k = step_of(grid, 10) - 1
    assert result.shortfall[1, book.borrower_ids.index("B1"), k] > 0
    assert result.shortfall[1, book.borrower_ids.index("B2"), k] == 0.0


def test_a_non_cash_loan_without_security_collateral_is_rejected(snapshot):
    snap = mini_snapshot(snapshot, loans=[loan(cash=False)])
    with pytest.raises(ValueError, match="no security collateral"):
        build_book(snap, build_market(snap))


def test_paths_that_are_too_short_are_rejected(snapshot):
    snap, market, book, grid = setup(snapshot, [loan()])
    short = Paths(np.zeros((2, 10, 4)), np.zeros((2, 10, 2)), np.zeros((2, 0), dtype=int))
    with pytest.raises(ValueError, match="26 are needed"):
        evaluate(book, market, short, grid)


def test_wrong_way_signs_follow_the_borrowers_net_equity_delta(snapshot):
    securities = [
        {"id": "EQ", "label": "Equity", "asset_class": "EQUITY", "liquidity_class": "liquid", "hard_to_borrow": False,
         "currency": "USD", "price": 100.0, "adv_units": 1e6, "daily_vol": 0.02, "equity_beta": 1.0,
         "rate_duration": 0.0, "spread_duration": 0.0},
        {"id": "GV", "label": "Govt", "asset_class": "GOVT", "liquidity_class": "liquid", "hard_to_borrow": False,
         "currency": "USD", "price": 100.0, "adv_units": 5e6, "daily_vol": 0.003, "equity_beta": 0.0,
         "rate_duration": 0.0, "spread_duration": 0.0},
        {"id": "ETF", "label": "Equity ETF", "asset_class": "ETF", "liquidity_class": "liquid", "hard_to_borrow": False,
         "currency": "USD", "price": 100.0, "adv_units": 5e6, "daily_vol": 0.01, "equity_beta": 1.0,
         "rate_duration": 0.0, "spread_duration": 0.0},
    ]
    borrowers = [
        {"id": "B1", "name": "Alderwood Capital", "rating": "A", "spread_bps": None, "recovery": None, "credit_provenance": "sim"},
        {"id": "B2", "name": "Harrowgate Partners", "rating": "BBB", "spread_bps": None, "recovery": None, "credit_provenance": "sim"},
    ]
    loans = [loan("L1", borrower="B1", security="EQ"),                                     # short equity, cash collateral
             loan("L2", borrower="B2", security="GV", quantity=1000, cash=False)]          # bond loan, equity collateral
    collateral = [cash_holding("C1", borrower="B1"), security_holding("C2", borrower="B2", security="ETF", quantity=1020)]
    snap = mini_snapshot(snapshot, loans=loans, collateral=collateral, securities=securities, borrowers=borrowers)
    book = build_book(snap, build_market(snap))
    assert dict(zip(book.borrower_ids, book.signs.tolist(), strict=True)) == {"B1": 1.0, "B2": -1.0}
