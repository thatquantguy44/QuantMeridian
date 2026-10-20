"""The cash collateral reinvestment pool (spec020 IND-015, IND-016, AC-009).

Each case sets the exact liabilities, spread path and issuer draws, so every loss is a number
computed by hand.
"""

import math

import numpy as np
import pytest
from conftest import loan, mini_snapshot, pool_of, pool_position

from indemnification_api.grid import build_grid
from indemnification_api.market import Paths, build_market
from indemnification_api.pool import build_pool, run_pool

N = 3


def setup(snapshot, positions, *, edit=None, horizon=21, step="daily"):
    snap = mini_snapshot(snapshot, loans=[loan()], pool=pool_of(*positions))
    snap["run"] = {**snap["run"], "horizon_days": horizon, "step": step}
    snap["closeout_profile"]["defaults"]["impact_k"] = 0.0  # only the pool's floors price a sale
    if edit:
        edit(snap)
    market = build_market(snap)
    return snap, market, build_pool(snap, market), build_grid(snap["run"])


def paths_with_spread(market, grid, spread_by_day=None, days=40):
    p = Paths(
        factors=np.zeros((N, days + 1, 4)),
        log_price=np.zeros((N, days + 1, len(market.security_ids))),
        jump_counts=np.zeros((N, 0), dtype=int),
    )
    for day, level in (spread_by_day or {}).items():
        p.factors[:, day:, 2] = level  # credit spread widened by `level` from `day`
    return p


def liabilities(grid, values, borrowers=1):
    """(N, B, K + 1) cash owed: `values` maps first-day -> total, held until the next entry."""
    out = np.zeros((N, borrowers, len(grid.event_days)))
    current = None
    for k, day in enumerate(grid.event_days):
        current = values.get(int(day), current)
        out[:, :, k] = current
    return out


def no_default(grid, j):
    return np.full((N, len(grid.event_days) - 1, j), 0.999999)


def test_a_pool_held_overnight_loses_nothing_however_the_loans_come_back(snapshot):
    """AC-009: an all-overnight pool has zero reinvestment loss."""
    snap, market, model, grid = setup(snapshot, [pool_position(bucket="T+0", credit="HQLA")])
    paths = paths_with_spread(market, grid, {5: 0.05})  # a 500 bp widening does nothing to HQLA
    liabs = liabilities(grid, {0: 1e6, 3: 4e5, 9: 9e5})  # a wave out, then a partial return
    run = run_pool(model, market, paths, grid, liabs, no_default(grid, 1))
    assert run.loss.max() == 0.0
    assert run.realization.min() == 1.0


def test_a_single_term_asset_matches_the_hand_calculated_forced_sale_loss(snapshot):
    """AC-009: spread shock, then 30% of the cash owed leaves, paid from the only asset (TERM
    bank)."""
    snap, market, model, grid = setup(snapshot, [pool_position(wam_days=70.0)])
    paths = paths_with_spread(market, grid, {2: 0.01})  # +100 bp from day 2
    liabs = liabilities(grid, {0: 1e6, 2: 7e5})
    run = run_pool(model, market, paths, grid, liabs, no_default(grid, 1))
    price = math.exp(-(70.0 / 252.0) * 1.0 * 0.01)  # BANK credit beta 1.0
    gross = 1e6 * price
    cost = 0.0025  # TERM forced-sale floor, 25 bp
    sold = 3e5 / (1 - cost)
    nav = gross - sold
    assert run.loss[0] == pytest.approx(7e5 - nav, rel=1e-12)
    assert run.nav[0, 2] == pytest.approx(nav, rel=1e-12)
    assert run.loss[0] == run.loss[1] == run.loss[2]


def test_an_issuer_default_costs_the_unrecovered_share(snapshot):
    snap, market, model, grid = setup(snapshot, [pool_position()])
    u = no_default(grid, 1)
    u[:, 0, :] = 0.0  # the issuer defaults in the first step
    run = run_pool(
        model, market, paths_with_spread(market, grid), grid, liabilities(grid, {0: 1e6}), u
    )
    assert run.loss[0] == pytest.approx(1e6 * (1 - 0.4))  # recovery 40%


def test_a_default_that_does_not_happen_for_a_rated_hqla_position_even_with_a_zero_draw(snapshot):
    snap, market, model, grid = setup(snapshot, [pool_position(bucket="T+1", credit="HQLA")])
    u = np.zeros((N, len(grid.event_days) - 1, 1))  # every draw is a "default" draw
    run = run_pool(
        model, market, paths_with_spread(market, grid), grid, liabilities(grid, {0: 1e6}), u
    )
    assert run.loss.max() == 0.0  # hazard is zero for HQLA


def test_cash_coming_in_is_held_in_the_most_liquid_position_and_costs_nothing(snapshot):
    snap, market, model, grid = setup(
        snapshot,
        [
            pool_position("P1", bucket="T+0", credit="HQLA", allocation=4e5),
            pool_position("P2", bucket="TERM", credit="BANK", allocation=6e5),
        ],
    )
    run = run_pool(
        model,
        market,
        paths_with_spread(market, grid),
        grid,
        liabilities(grid, {0: 1e6, 3: 1.2e6}),
        no_default(grid, 2),
    )
    assert run.loss.max() == 0.0 and run.nav[0, 3] == pytest.approx(1.2e6)


def test_outflows_are_paid_from_the_most_liquid_assets_first(snapshot):
    snap, market, model, grid = setup(
        snapshot,
        [
            pool_position("P1", bucket="T+0", credit="HQLA", allocation=4e5),
            pool_position("P2", bucket="TERM", credit="BANK", allocation=6e5),
        ],
    )
    paths = paths_with_spread(market, grid, {3: 0.01})
    run = run_pool(
        model, market, paths, grid, liabilities(grid, {0: 1e6, 3: 8e5}), no_default(grid, 2)
    )
    # 2e5 leaves: paid entirely from the overnight position, so no forced sale and only the spread
    # move
    term_value = 6e5 * math.exp(-(70.0 / 252.0) * 0.01)
    assert run.nav[0, 3] == pytest.approx(2e5 + term_value)
    assert run.loss[0] == pytest.approx(8e5 - (2e5 + term_value))


def test_the_loss_is_the_peak_deficiency_over_the_horizon_not_the_final_one(snapshot):
    snap, market, model, grid = setup(snapshot, [pool_position(wam_days=252.0)])
    paths = paths_with_spread(market, grid, {5: 0.02})
    paths.factors[:, 9:, 2] = 0.0  # spreads widen for four days, then recover
    run = run_pool(model, market, paths, grid, liabilities(grid, {0: 1e6}), no_default(grid, 1))
    assert run.loss[0] == pytest.approx(1e6 * (1 - math.exp(-0.02)))


def test_a_pool_that_starts_underfunded_is_not_charged_for_its_opening_gap(snapshot):
    snap, market, model, grid = setup(
        snapshot, [pool_position(bucket="T+0", credit="HQLA", allocation=9e5)]
    )
    run = run_pool(
        model,
        market,
        paths_with_spread(market, grid),
        grid,
        liabilities(grid, {0: 1e6}),
        no_default(grid, 1),
    )
    assert run.loss.max() == 0.0


def test_cash_collateral_is_worth_par_when_the_pool_can_pay_a_defaulting_borrower(snapshot):
    snap, market, model, grid = setup(
        snapshot,
        [
            pool_position("P1", bucket="T+0", credit="HQLA", allocation=6e5),
            pool_position("P2", bucket="TERM", credit="BANK", allocation=4e5),
        ],
    )
    liabs = liabilities(grid, {0: 1e6}, borrowers=2)
    liabs[:, 0, :], liabs[:, 1, :] = 3e5, 7e5
    run = run_pool(model, market, paths_with_spread(market, grid), grid, liabs, no_default(grid, 2))
    assert run.realization.min() == pytest.approx(
        1.0
    )  # selling TERM at 25 bp is covered by the extra units sold


def test_cash_collateral_is_worth_less_than_par_when_the_pool_is_impaired(snapshot):
    snap, market, model, grid = setup(
        snapshot,
        [
            pool_position("P1", bucket="T+0", credit="HQLA", allocation=6e5),
            pool_position("P2", bucket="TERM", credit="BANK", allocation=4e5),
        ],
    )
    u = no_default(grid, 2)
    u[:, 0, 1] = 0.0  # the TERM issuer defaults at step 1
    liabs = liabilities(grid, {0: 1e6}, borrowers=2)
    liabs[:, 0, :], liabs[:, 1, :] = 2e5, 8e5
    run = run_pool(model, market, paths_with_spread(market, grid), grid, liabs, u)
    # borrower 0 (2e5) is paid from the overnight position: par. Borrower 1 (8e5): 6e5 overnight,
    # then the
    # defaulted TERM asset, worth only 1.6e5, sold at a 25 bp floor: short by the shortfall in
    # value.
    cost = 0.0025
    raised = 6e5 + 1.6e5 * (1 - cost)
    assert run.realization[0, 0, 0] == pytest.approx(1.0)
    assert run.realization[0, 1, 0] == pytest.approx(raised / 8e5, rel=1e-12)
    assert run.realization[0, 1, 0] < 1.0


def test_realization_never_exceeds_par_and_is_one_where_nothing_is_owed(snapshot):
    snap, market, model, grid = setup(
        snapshot, [pool_position(bucket="T+0", credit="HQLA", allocation=2e6)]
    )
    liabs = liabilities(grid, {0: 1e6}, borrowers=2)
    liabs[:, 1, :] = 0.0
    run = run_pool(model, market, paths_with_spread(market, grid), grid, liabs, no_default(grid, 1))
    assert run.realization.max() == 1.0 and run.realization.min() == 1.0


def test_the_stress_multiplier_raises_the_forced_sale_cost_when_spreads_widen(snapshot):
    def edit(s):
        s["closeout_profile"]["defaults"].update(stress_beta=4.0, stress_factor="credit_spread")

    snap, market, model, grid = setup(snapshot, [pool_position(wam_days=70.0)], edit=edit)
    sigma = market.factor_vol_daily[2]
    quiet = paths_with_spread(market, grid)
    wide = paths_with_spread(market, grid, {2: sigma * math.sqrt(2)})  # +1 sigma by day 2
    liabs = liabilities(grid, {0: 1e6, 2: 7e5})
    loss_quiet = run_pool(model, market, quiet, grid, liabs, no_default(grid, 1)).loss[0]
    loss_wide = run_pool(model, market, wide, grid, liabs, no_default(grid, 1)).loss[0]
    price = math.exp(-(70.0 / 252.0) * sigma * math.sqrt(2))
    cost = 0.0025 * (1 + 4.0 * 1.0)
    assert loss_wide == pytest.approx(7e5 - (1e6 * price - 3e5 / (1 - cost)), rel=1e-9)
    assert loss_wide > loss_quiet


def test_no_pool_positions_means_no_pool(snapshot):
    snap = mini_snapshot(snapshot, loans=[loan()])
    assert build_pool(snap, build_market(snap)) is None


def test_selling_a_position_down_to_zero_never_produces_nan(snapshot):
    """A position drawn to exactly nothing can carry a -1e-10 float residue; a fractional power of
    it is NaN.
    """
    snap, market, model, grid = setup(snapshot, [pool_position(wam_days=70.0)])
    liabs = liabilities(
        grid, {0: 1e6, 2: 4e5, 3: 0.0, 4: 0.0}
    )  # almost everything leaves in two steps
    run = run_pool(
        model, market, paths_with_spread(market, grid, {2: 0.003}), grid, liabs, no_default(grid, 1)
    )
    assert (
        np.isfinite(run.loss).all()
        and np.isfinite(run.nav).all()
        and np.isfinite(run.realization).all()
    )
    assert run.nav.min() >= 0.0
