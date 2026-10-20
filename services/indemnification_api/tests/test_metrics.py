"""Risk metrics and their Monte Carlo standard errors (spec020 IND-006, IND-008, AC-005)."""

import math

import numpy as np
import pytest

from indemnification_api.grid import build_grid
from indemnification_api.metrics import (
    LEVELS,
    Metric,
    channel_metrics,
    euler_expected_shortfall,
    expected_shortfall,
    tail_count,
    value_at_risk,
)


def grid(horizon=21):
    return build_grid(
        {
            "mode": "desk",
            "seed": 1,
            "paths": 5000,
            "preview": False,
            "horizon_days": horizon,
            "step": "daily",
        }
    )


def test_value_at_risk_is_the_upper_quantile_and_expected_shortfall_the_mean_of_the_tail():
    losses = np.array([0.0] * 90 + list(range(1, 11)))
    assert value_at_risk(losses, 0.9) == 1.0  # first positive loss
    assert expected_shortfall(losses, 0.9) == pytest.approx(5.5)  # mean of the worst 10
    assert expected_shortfall(losses, 0.99) == 10.0
    assert (
        value_at_risk(np.zeros(1000), 0.999) == 0.0
        and expected_shortfall(np.zeros(1000), 0.999) == 0.0
    )


def test_tail_count_is_not_fooled_by_floating_point():
    assert (
        tail_count(100, 0.99) == 1
        and tail_count(1000, 0.999) == 1
        and tail_count(50_000, 0.999) == 50
    )
    assert tail_count(101, 0.99) == 2 and tail_count(10, 0.999) == 1


def test_expected_shortfall_is_at_least_value_at_risk():
    rng = np.random.default_rng(1)
    x = rng.exponential(size=10_000)
    for level in (0.9, 0.99, 0.999):
        assert expected_shortfall(x, level) >= value_at_risk(x, level)


def test_levels_cover_the_spec():
    assert LEVELS == {
        "pfe95": 0.95,
        "pfe99": 0.99,
        "var99": 0.99,
        "var999": 0.999,
        "es99": 0.99,
        "es999": 0.999,
    }


def test_euler_contributions_sum_to_the_expected_shortfall_exactly():
    rng = np.random.default_rng(2)
    parts = rng.exponential(size=(20_000, 4)) * (rng.random((20_000, 4)) < 0.05)
    pool = rng.exponential(size=20_000) * (rng.random(20_000) < 0.02)
    contributions, pool_part = euler_expected_shortfall(parts, pool, 0.99)
    total = parts.sum(axis=1) + pool
    assert contributions.sum() + pool_part == pytest.approx(
        expected_shortfall(total, 0.99), rel=1e-12
    )
    assert contributions.shape == (4,) and (contributions >= 0).all()


def test_euler_gives_the_whole_tail_to_the_borrower_that_causes_it():
    n = 10_000
    parts = np.zeros((n, 3))
    parts[:50, 1] = 100.0  # only borrower 1 ever loses anything
    contributions, pool_part = euler_expected_shortfall(parts, np.zeros(n), 0.99)
    assert contributions[0] == 0 and contributions[2] == 0 and pool_part == 0
    assert contributions[1] == pytest.approx(expected_shortfall(parts.sum(axis=1), 0.99))


def test_el_epe_and_pfe_of_a_constant_exposure():
    g = grid(21)
    exposure = np.full((4000, len(g.event_days)), 7.0)
    zero = np.zeros(4000)
    m = channel_metrics(cond=zero, sampled=zero, exposure=exposure, grid=g)
    assert m["epe"].value == pytest.approx(7.0) and m["epe"].std_error == pytest.approx(
        0.0, abs=1e-12
    )
    assert m["pfe95"].value == 7.0 and m["pfe99"].value == 7.0
    assert m["el"].value == 0.0 and m["var999"].value == 0.0 and m["es999"].value == 0.0


def test_pfe_is_the_peak_over_time_of_the_cross_path_quantile():
    g = grid(21)
    n = 2000
    exposure = np.zeros((n, len(g.event_days)))
    exposure[:, 10] = np.arange(n) / n  # uniform(0, 1) on day 10 only
    m = channel_metrics(cond=np.zeros(n), sampled=np.zeros(n), exposure=exposure, grid=g)
    assert m["pfe95"].value == pytest.approx(0.95, abs=2e-3) and m["pfe99"].value == pytest.approx(
        0.99, abs=2e-3
    )


def test_epe_is_the_time_average_of_expected_exposure():
    g = grid(21)
    n = 100
    exposure = np.zeros((n, len(g.event_days)))
    exposure[:, 1:] = np.linspace(0, 20, 21)  # EE(t) = t for t = 1..21 (day 0 is zero)
    m = channel_metrics(cond=np.zeros(n), sampled=np.zeros(n), exposure=exposure, grid=g)
    expected = np.trapezoid(exposure[0], g.event_days) / 21
    assert m["epe"].value == pytest.approx(expected)


def test_standard_errors_match_theory_for_a_normal_sample():
    rng = np.random.default_rng(3)
    n = 200_000
    losses = rng.normal(10, 2, n)
    g = grid(21)
    m = channel_metrics(
        cond=losses, sampled=losses, exposure=np.zeros((n, len(g.event_days))), grid=g
    )
    assert m["el"].value == pytest.approx(10, abs=4 * 2 / math.sqrt(n))
    assert m["el"].std_error == pytest.approx(2 / math.sqrt(n), rel=1e-2)
    # the 99th percentile of N(10, 2) is 10 + 2 * 2.3263; its standard error is about 0.0145 here
    assert m["var99"].value == pytest.approx(10 + 2 * 2.3263478740, abs=4 * 0.0145)
    assert 0.5 * 0.0145 < m["var99"].std_error < 2.5 * 0.0145


def test_a_metric_carries_a_value_and_a_standard_error():
    assert Metric(1.0, 0.1).as_dict() == {"value": 1.0, "std_error": 0.1}
