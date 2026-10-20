"""Default times: one-factor copula with a wrong-way link and a Student-t sensitivity (spec020
decision 3, IND-004, IND-007, IND-019, AC-012).
"""

import math

import numpy as np
import pytest
from scipy.stats import multivariate_normal, norm

from indemnification_api.defaults import (
    conditional_step_probs,
    default_steps,
    default_times_years,
    draw_default_noise,
    latent_mean,
)
from indemnification_api.grid import build_grid

N = 400_000
RHO_D, RHO_W, NU = 0.25, 0.30, 5


def run_grid(horizon=252, step="monthly"):
    return build_grid(
        {
            "mode": "annual",
            "seed": 1,
            "paths": 5000,
            "preview": False,
            "horizon_days": horizon,
            "step": step,
        }
    )


def pd_to_hazard(pd):
    return -np.log1p(-np.asarray(pd, dtype=float))


@pytest.fixture(scope="module")
def draws():
    rng = np.random.default_rng(2026)
    z_eq = rng.standard_normal(N)
    noise = draw_default_noise(rng, N, 3, NU)
    return z_eq, noise


HAZARDS = pd_to_hazard([0.04, 0.04, 0.0006])
SIGNS = np.array([1.0, -1.0, 1.0])


def tau(draws, kind="gaussian", rho_w=RHO_W, hazards=HAZARDS, signs=SIGNS):
    z_eq, noise = draws
    a = latent_mean(z_eq, noise, signs, RHO_D, rho_w)
    return default_times_years(hazards, a, noise, RHO_D, kind=kind, nu=NU)


def test_marginal_default_probability_by_one_year_is_recovered(draws):
    for kind in ("gaussian", "student_t"):
        t = tau(draws, kind)
        for b, pd in enumerate([0.04, 0.04, 0.0006]):
            hit = (t[:, b] <= 1.0).mean()
            se = math.sqrt(pd * (1 - pd) / N)
            assert abs(hit - pd) < 4 * se, (kind, b)


def test_marginal_default_probability_by_half_a_year(draws):
    t = tau(draws)
    pd_half = 1 - math.exp(-HAZARDS[0] * 0.5)
    assert abs((t[:, 0] <= 0.5).mean() - pd_half) < 4 * math.sqrt(pd_half * (1 - pd_half) / N)


def test_wrong_way_sign_sets_the_direction_of_the_equity_link(draws):
    z_eq = draws[0]
    t = tau(draws)
    d0 = (t[:, 0] <= 1.0).astype(
        float
    )  # sign +1: exposure rises with equity -> defaults when equity is high
    d1 = (t[:, 1] <= 1.0).astype(float)  # sign -1: defaults when equity is low
    se = 1 / math.sqrt(N)
    assert np.corrcoef(d0, z_eq)[0, 1] > 8 * se
    assert np.corrcoef(d1, z_eq)[0, 1] < -8 * se


def test_no_wrong_way_run_has_no_equity_link_and_reuses_the_same_noise(draws):
    z_eq, noise = draws
    t_off = tau(draws, rho_w=0.0)
    d = (t_off[:, 0] <= 1.0).astype(float)
    assert abs(np.corrcoef(d, z_eq)[0, 1]) < 4 / math.sqrt(N)
    # Turning the link off moves its weight onto the shared credit factor, so the latent variance
    # and the
    # same-sign borrower correlation are unchanged. With the equity factor at zero the runs differ
    # only by
    # that reweighting of the shared factor, on identical draws.
    zero = np.zeros(N)
    on = latent_mean(zero, noise, SIGNS, RHO_D, RHO_W)
    off = latent_mean(zero, noise, SIGNS, RHO_D, 0.0)
    shift = math.sqrt(RHO_D) - math.sqrt(RHO_D - RHO_W**2)
    assert np.allclose(off - on, shift * noise.z_sys[:, None])


def test_switching_the_link_off_keeps_latent_variance_and_borrower_correlation(draws):
    z_eq, noise = draws
    c = math.sqrt(1 - RHO_D)
    for rho_w in (RHO_W, 0.0):
        x = latent_mean(z_eq, noise, np.ones(3), RHO_D, rho_w) + c * noise.eps
        assert abs(x[:, 0].var() - 1) < 0.01
        assert abs(np.corrcoef(x[:, 0], x[:, 2])[0, 1] - RHO_D) < 0.01


def test_joint_default_probability_matches_the_bivariate_normal_copula(draws):
    # borrowers 0 and 2 share a sign, so their latent correlation is rho_d; use the same PD for both
    z_eq, noise = draws
    hazards = pd_to_hazard([0.04, 0.04, 0.04])
    t = tau(draws, hazards=hazards, signs=np.array([1.0, 1.0, 1.0]))
    both = ((t[:, 0] <= 1.0) & (t[:, 2] <= 1.0)).mean()
    x = norm.ppf(0.04)
    expected = multivariate_normal(mean=[0, 0], cov=[[1, RHO_D], [RHO_D, 1]]).cdf([x, x])
    se = math.sqrt(expected * (1 - expected) / N)
    assert abs(both - expected) < 4 * se


def test_opposite_wrong_way_signs_lower_the_latent_correlation(draws):
    hazards = pd_to_hazard([0.04, 0.04, 0.04])
    same = tau(draws, hazards=hazards, signs=np.array([1.0, 1.0, 1.0]))
    opposite = tau(draws, hazards=hazards, signs=np.array([1.0, -1.0, 1.0]))
    j_same = ((same[:, 0] <= 1) & (same[:, 1] <= 1)).mean()
    j_opposite = ((opposite[:, 0] <= 1) & (opposite[:, 1] <= 1)).mean()
    assert j_opposite < j_same
    # latent correlation is rho_d - rho_w^2 * (1 - s_i s_j) = 0.25 - 0.09 * 2 = 0.07
    x = norm.ppf(0.04)
    expected = multivariate_normal(
        mean=[0, 0], cov=[[1, RHO_D - 2 * RHO_W**2], [RHO_D - 2 * RHO_W**2, 1]]
    ).cdf([x, x])
    assert abs(j_opposite - expected) < 4 * math.sqrt(expected / N)


def test_student_t_has_heavier_joint_default_tails_than_gaussian(draws):
    hazards = pd_to_hazard([0.01, 0.01, 0.01])
    signs = np.array([1.0, 1.0, 1.0])
    g = tau(draws, "gaussian", hazards=hazards, signs=signs)
    s = tau(draws, "student_t", hazards=hazards, signs=signs)
    joint_g = ((g[:, 0] <= 1) & (g[:, 2] <= 1)).mean()
    joint_t = ((s[:, 0] <= 1) & (s[:, 2] <= 1)).mean()
    assert joint_t > joint_g * 1.3


def test_student_t_converges_to_gaussian_as_nu_grows():
    rng = np.random.default_rng(5)
    z_eq = rng.standard_normal(N)
    noise = draw_default_noise(rng, N, 3, 4000)
    hazards = pd_to_hazard([0.04, 0.04, 0.04])
    a = latent_mean(z_eq, noise, np.ones(3), RHO_D, RHO_W)
    g = default_times_years(hazards, a, noise, RHO_D, kind="gaussian", nu=4000)
    s = default_times_years(hazards, a, noise, RHO_D, kind="student_t", nu=4000)
    assert abs((g[:, 0] <= 1).mean() - (s[:, 0] <= 1).mean()) < 0.003
    assert ((g[:, 0] <= 1) != (s[:, 0] <= 1)).mean() < 0.01


def test_rho_w_squared_above_rho_d_is_rejected(draws):
    z_eq, noise = draws
    with pytest.raises(ValueError, match="rho_w"):
        latent_mean(z_eq, noise, SIGNS, 0.25, 0.6)


def test_default_steps_map_times_to_the_grid():
    grid = run_grid(horizon=252, step="monthly")  # 0, 21, 42, ... 252
    years = np.array([[0.0001, 21 / 252, 21.5 / 252, 1.0, 1.0001, 5.0]])
    assert default_steps(years, grid).tolist() == [[1, 1, 2, 12, 0, 0]]


def test_conditional_probabilities_average_to_the_marginal_and_to_the_sampled_defaults(draws):
    z_eq, noise = draws
    grid = run_grid(horizon=252, step="monthly")
    for kind in ("gaussian", "student_t"):
        a = latent_mean(z_eq, noise, SIGNS, RHO_D, RHO_W)
        probs = conditional_step_probs(HAZARDS, a, noise, RHO_D, grid, kind=kind, nu=NU)
        assert probs.shape == (N, 3, 12)
        assert probs.min() >= 0 and probs.max() <= 1 + 1e-12
        cumulative = probs.sum(axis=2)  # P(default by horizon | factors)
        for b, pd in enumerate([0.04, 0.04, 0.0006]):
            se = cumulative[:, b].std(ddof=1) / math.sqrt(N)
            assert abs(cumulative[:, b].mean() - pd) < 4 * se, (kind, b)
        t = default_times_years(HAZARDS, a, noise, RHO_D, kind=kind, nu=NU)
        steps = default_steps(t, grid)
        for k in (1, 6, 12):
            sampled = (steps[:, 0] == k).mean()
            se = math.sqrt(max(sampled, 1e-6) / N)
            assert abs(probs[:, 0, k - 1].mean() - sampled) < 5 * se, (kind, k)
