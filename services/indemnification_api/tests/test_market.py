"""Market factor paths and security prices (spec020 PLAN section 1, IND-003)."""

import copy
import math

import numpy as np
import pytest

from indemnification_api.market import FACTORS, build_market, simulate_paths


def rng(seed=7):
    return np.random.default_rng(seed)


@pytest.fixture(scope="module")
def model(snapshot):
    return build_market(snapshot)


@pytest.fixture(scope="module")
def paths(model):
    return simulate_paths(model, rng(), n_paths=20000, days=21)


def test_factor_order_and_securities(model, snapshot):
    assert FACTORS == ("equity", "rates", "credit_spread", "fx")
    assert model.security_ids == [s["id"] for s in snapshot["securities"]]


def test_loadings_follow_beta_and_durations(model):
    eq1, ust = model.index["EQ1"], model.index["UST1"]
    assert model.loadings[eq1].tolist() == [1.0, 0.0, 0.0, 0.0]
    assert model.loadings[ust].tolist() == [0.0, -4.2, 0.0, 0.0]


def test_total_daily_vol_matches_the_security_when_the_systematic_part_fits_inside_it(
    model, snapshot
):
    for sec in snapshot["securities"]:
        i = model.index[sec["id"]]
        cov = model.factor_cov_daily
        systematic = float(model.loadings[i] @ cov @ model.loadings[i])
        total = math.sqrt(systematic + model.idio_daily[i] ** 2)
        assert total == pytest.approx(sec["daily_vol"], rel=1e-12), sec["id"]


def test_idiosyncratic_vol_is_floored_when_the_factor_part_exceeds_the_security_vol(snapshot):
    s = copy.deepcopy(snapshot)
    s["securities"][0]["daily_vol"] = 0.001  # EQ1 beta 1 x 1.13% equity vol dwarfs this
    m = build_market(s)
    assert m.idio_daily[m.index["EQ1"]] == pytest.approx(0.25 * 0.001)


def test_the_same_seed_gives_identical_paths_and_a_different_seed_does_not(model):
    a = simulate_paths(model, rng(3), 200, 10)
    b = simulate_paths(model, rng(3), 200, 10)
    c = simulate_paths(model, rng(4), 200, 10)
    assert np.array_equal(a.log_price, b.log_price) and np.array_equal(a.factors, b.factors)
    assert not np.array_equal(a.log_price, c.log_price)


def test_paths_start_at_zero_and_have_the_requested_shape(paths, model):
    assert paths.log_price.shape == (20000, 22, len(model.security_ids))
    assert paths.factors.shape == (20000, 22, 4)
    assert not paths.log_price[:, 0, :].any() and not paths.factors[:, 0, :].any()


def test_factor_volatilities_scale_with_the_square_root_of_time(paths, model):
    n = paths.factors.shape[0]
    for d in (5, 21):
        for f in range(4):
            expected = model.factor_vol_daily[f] * math.sqrt(d)
            sample = paths.factors[:, d, f].std(ddof=1)
            se = expected / math.sqrt(2 * (n - 1))
            assert abs(sample - expected) < 4 * se, (FACTORS[f], d)


def test_factor_correlations_match_the_matrix(paths, snapshot):
    target = np.array(snapshot["model"]["market"]["factor_corr"])
    sample = np.corrcoef(paths.factors[:, 21, :].T)
    se = 1 / math.sqrt(paths.factors.shape[0])
    assert np.abs(sample - target).max() < 5 * se


def test_every_security_price_is_a_martingale(paths, model):
    # E[P_T / P_0] = 1, jump securities included (the drift carries a compensator)
    n = paths.log_price.shape[0]
    for sid, i in model.index.items():
        ratio = np.exp(paths.log_price[:, 21, i])
        assert abs(ratio.mean() - 1) < 4 * ratio.std(ddof=1) / math.sqrt(n), sid


def test_log_price_volatility_matches_the_security_for_a_non_jump_name(paths, model, snapshot):
    i = model.index["EQ1"]
    daily = next(s["daily_vol"] for s in snapshot["securities"] if s["id"] == "EQ1")
    expected = daily * math.sqrt(21)
    sample = paths.log_price[:, 21, i].std(ddof=1)
    assert abs(sample - expected) < 4 * expected / math.sqrt(2 * (paths.log_price.shape[0] - 1))


def test_only_hard_to_borrow_securities_jump_and_at_the_stated_rate(model):
    big = simulate_paths(model, rng(11), n_paths=4000, days=252)
    lam = 1.0  # fixture jump_intensity_annual
    jumpers = {s for s, i in model.index.items() if model.jump_on[i]}
    assert jumpers == {"EQ2"}  # the only hard-to-borrow security
    counts = big.jump_counts[:, model.jump_columns.index(model.index["EQ2"])]
    se = math.sqrt(lam / 4000)
    assert abs(counts.mean() - lam) < 5 * se
    assert big.jump_counts.shape[1] == 1


def test_jumps_move_prices_up_on_average(model):
    # squeeze jumps have a positive mean, so conditional on a jump the log price is higher
    big = simulate_paths(model, rng(12), n_paths=4000, days=252)
    col = model.jump_columns.index(model.index["EQ2"])
    jumped = big.jump_counts[:, col] >= 1
    final = big.log_price[:, 252, model.index["EQ2"]]
    assert final[jumped].mean() > final[~jumped].mean()


def test_standardized_equity_is_standard_normal(paths, model):
    z = paths.standardized_equity(21, model)
    n = z.size
    assert abs(z.mean()) < 4 / math.sqrt(n)
    assert abs(z.std(ddof=1) - 1) < 4 / math.sqrt(2 * (n - 1))
