"""Run modes and time grid (spec020 decision 5, IND-021, AC-014)."""

import numpy as np
import pytest
from indemnification_api.grid import STEP_DAYS, YEAR_DAYS, build_grid


def run(**overrides):
    base = {"mode": "desk", "seed": 1, "paths": 5000, "preview": False, "horizon_days": 21, "step": "daily"}
    return {**base, **overrides}


def test_the_desk_default_is_one_month_of_daily_steps():
    grid = build_grid(run())
    assert grid.event_days.tolist() == list(range(22))
    assert grid.step_days == 1 and grid.horizon_days == 21 and grid.mode == "desk"


def test_the_annual_view_with_weekly_steps_ends_on_the_horizon():
    grid = build_grid(run(mode="annual", horizon_days=252, step="weekly"))
    assert grid.event_days[0] == 0 and grid.event_days[-1] == 252
    assert np.all(np.diff(grid.event_days[:-1]) == 5)
    assert 252 - grid.event_days[-2] == 2          # 250 -> 252 is a short final step
    assert len(grid.event_days) == 52


def test_a_horizon_that_is_a_multiple_of_the_step_adds_no_extra_point():
    assert build_grid(run(mode="annual", horizon_days=252, step="monthly")).event_days.tolist() == list(range(0, 253, 21))
    assert build_grid(run(horizon_days=20 + 1, step="weekly")).event_days.tolist() == [0, 5, 10, 15, 20, 21]


def test_year_and_step_conventions():
    assert YEAR_DAYS == 252
    assert STEP_DAYS == {"daily": 1, "weekly": 5, "monthly": 21}


@pytest.mark.parametrize("horizon", [20, 1261])
def test_horizons_outside_the_limits_are_rejected(horizon):
    with pytest.raises(ValueError, match="horizon"):
        build_grid(run(horizon_days=horizon))


def test_year_fractions_are_in_business_days_over_252():
    grid = build_grid(run(mode="annual", horizon_days=252, step="monthly"))
    assert grid.years[-1] == 1.0 and grid.years[1] == pytest.approx(21 / 252)
