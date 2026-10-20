"""End-to-end properties of a run (spec020 AC-001 to AC-004, IND-004 to IND-007, IND-019)."""

import copy
import math

import numpy as np
import pytest
from conftest import loan, mini_snapshot
from scipy.stats import norm

from indemnification_api.contracts import seal
from indemnification_api.engine import (
    GAUSSIAN_NO_WW,
    GAUSSIAN_WW,
    STUDENT_T_WW,
    simulate,
)
from indemnification_api.metrics import channel_metrics


def make(base, loans, *, collateral=None, paths=20_000, seed=1, horizon=21, edit=None, **kw):
    snap = mini_snapshot(base, loans=loans, collateral=collateral, **kw)
    snap["run"] = {
        **snap["run"],
        "mode": "desk",
        "seed": seed,
        "paths": paths,
        "horizon_days": horizon,
        "step": "daily",
    }
    snap["closeout_profile"]["defaults"]["impact_k"] = 0.0
    snap["model"] = {**snap["model"], "student_t_enabled": False}
    if edit:
        edit(snap)
    return seal(snap)


def el_and_se(output, variant=GAUSSIAN_WW):
    cond = output.variants[variant].cond.sum(axis=1)
    return cond.mean(), cond.std(ddof=1) / math.sqrt(len(cond))


def test_expected_loss_matches_the_closed_form_for_one_independent_loan(snapshot):
    """AC-002: EL = PD x E[shortfall]; the lognormal gap's expectation is the Black formula."""
    spread_bps, recovery = 3000.0, 0.4  # hazard = 0.3 / 0.6 = 0.5 per year
    borrowers = [
        {
            "id": "B1",
            "name": "Alderwood Capital",
            "rating": "A",
            "spread_bps": spread_bps,
            "recovery": recovery,
            "credit_provenance": "user_input",
        }
    ]

    def edit(s):
        s["model"].update(rho_d=0.0, rho_w=0.0)

    snap = make(
        snapshot, [loan(quantity=1000, margin=102.0)], paths=200_000, borrowers=borrowers, edit=edit
    )
    out = simulate(snap)

    sigma, m_days, margin, notional = 0.02, 5, 1.02, 1000 * 100.0
    v = sigma**2 * m_days
    d1 = (math.log(1 / margin) + 0.5 * v) / math.sqrt(v)
    black = norm.cdf(d1) - margin * norm.cdf(d1 - math.sqrt(v))
    pd_horizon = 1 - math.exp(-0.5 * 21 / 252)
    expected = pd_horizon * notional * black

    cond_mean, cond_se = el_and_se(out)
    assert abs(cond_mean - expected) < 3 * cond_se
    sampled = out.variants[GAUSSIAN_WW].sampled.sum(axis=1)
    assert abs(sampled.mean() - expected) < 3 * sampled.std(ddof=1) / math.sqrt(len(sampled))
    assert cond_se < 0.25 * sampled.std(ddof=1) / math.sqrt(
        len(sampled)
    )  # the point of the estimator


def test_the_same_seed_reproduces_a_run_and_a_new_seed_changes_it_by_about_a_standard_error(
    snapshot,
):
    def weekly(s):
        s["closeout_profile"]["defaults"]["margin_call_every_days"] = (
            5  # so exposure is not always zero
        )

    a = simulate(make(snapshot, [loan()], seed=5, paths=10_000, edit=weekly))
    b = simulate(make(snapshot, [loan()], seed=5, paths=10_000, edit=weekly))
    c = simulate(make(snapshot, [loan()], seed=6, paths=10_000, edit=weekly))
    assert a.exposure.max() > 0
    assert np.array_equal(a.variants[GAUSSIAN_WW].cond, b.variants[GAUSSIAN_WW].cond)
    assert np.array_equal(a.exposure, b.exposure)
    assert not np.array_equal(a.exposure, c.exposure)
    (ma, sa), (mc, sc) = el_and_se(a), el_and_se(c)
    assert abs(ma - mc) < 4 * math.hypot(sa, sc)  # AC-001: different seed, same answer within error


def test_the_conditional_and_sampled_expected_loss_estimators_agree(snapshot):
    borrowers = [
        {
            "id": "B1",
            "name": "Alderwood Capital",
            "rating": "CCC",
            "spread_bps": None,
            "recovery": None,
            "credit_provenance": "sim",
        }
    ]
    out = simulate(
        make(
            snapshot,
            [loan(quantity=1000)],
            paths=100_000,
            borrowers=borrowers,
            edit=lambda s: s["model"].update(rho_d=0.4, rho_w=0.5),
        )
    )
    for variant in (GAUSSIAN_WW, GAUSSIAN_NO_WW):
        cond = out.variants[variant].cond.sum(axis=1)
        samp = out.variants[variant].sampled.sum(axis=1)
        se = math.hypot(cond.std(ddof=1), samp.std(ddof=1)) / math.sqrt(len(cond))
        assert abs(cond.mean() - samp.mean()) < 4 * se, variant


def test_zero_default_probability_gives_zero_expected_loss_and_no_sampled_defaults(snapshot):
    out = simulate(make(snapshot, [loan()], paths=5000), hazards=np.zeros(1))
    assert (
        out.variants[GAUSSIAN_WW].cond.max() == 0.0
        and out.variants[GAUSSIAN_WW].sampled.max() == 0.0
    )


def test_a_fully_collateralized_book_with_tiny_volatility_has_no_loss(snapshot):
    securities = [
        {
            "id": "EQ",
            "label": "Test equity",
            "asset_class": "EQUITY",
            "liquidity_class": "liquid",
            "hard_to_borrow": False,
            "currency": "USD",
            "price": 100.0,
            "adv_units": 1e6,
            "daily_vol": 1e-9,
            "equity_beta": 0.0,
            "rate_duration": 0.0,
            "spread_duration": 0.0,
        }
    ]
    borrowers = [
        {
            "id": "B1",
            "name": "Alderwood Capital",
            "rating": "CCC",
            "spread_bps": None,
            "recovery": None,
            "credit_provenance": "sim",
        }
    ]
    out = simulate(
        make(snapshot, [loan(margin=105.0)], securities=securities, borrowers=borrowers, paths=5000)
    )
    assert out.variants[GAUSSIAN_WW].cond.max() < 1e-6 and out.exposure.max() < 1e-6


def monotone(values, increasing=True):
    return all(
        (b >= a) if increasing else (b <= a) for a, b in zip(values, values[1:], strict=False)
    )


def test_expected_loss_rises_with_wrong_way_correlation_and_close_out_period_and_falls_with_margin(
    snapshot,
):
    borrowers = [
        {
            "id": "B1",
            "name": "Alderwood Capital",
            "rating": "B",
            "spread_bps": None,
            "recovery": None,
            "credit_provenance": "sim",
        }
    ]
    equity = [
        {
            "id": "EQ",
            "label": "Test equity",
            "asset_class": "EQUITY",
            "liquidity_class": "liquid",
            "hard_to_borrow": False,
            "currency": "USD",
            "price": 100.0,
            "adv_units": 1e6,
            "daily_vol": 0.02,
            "equity_beta": 1.0,
            "rate_duration": 0.0,
            "spread_duration": 0.0,
        }
    ]

    def el(**changes):
        def edit(s):
            s["model"].update(rho_d=changes.get("rho_d", 0.4), rho_w=changes.get("rho_w", 0.3))
            s["closeout_profile"]["defaults"]["mpor_liquid_days"] = changes.get("mpor", 5)

        out = simulate(
            make(
                snapshot,
                [loan(quantity=1000, margin=changes.get("margin", 102.0))],
                securities=equity,
                borrowers=borrowers,
                paths=100_000,
                edit=edit,
                horizon=63,
            )
        )
        return el_and_se(out)[0]

    assert monotone(
        [el(rho_w=w) for w in (0.0, 0.3, 0.55, 0.63)]
    )  # a long-equity-delta borrower defaults into rallies
    assert monotone([el(mpor=m) for m in (2, 5, 10, 20)])
    assert monotone([el(margin=m) for m in (102.0, 105.0, 110.0)], increasing=False)


def test_variants_share_draws_so_with_and_without_wrong_way_differ_only_through_the_link(snapshot):
    snap = make(
        snapshot, [loan()], paths=10_000, edit=lambda s: s["model"].update(student_t_enabled=True)
    )
    out = simulate(snap)
    assert set(out.variants) == {GAUSSIAN_WW, GAUSSIAN_NO_WW, STUDENT_T_WW}
    assert out.variants[GAUSSIAN_WW].cond.shape == (10_000, 1)
    # the market paths are common to every variant, so exposures are one array
    assert out.exposure.shape == (10_000, 1, 22)


def test_exposure_starts_at_zero_and_the_program_reports_the_requested_metrics(snapshot):
    out = simulate(
        make(
            snapshot,
            [loan(quantity=1000)],
            paths=10_000,
            edit=lambda s: s["closeout_profile"]["defaults"].update(margin_call_every_days=5),
        )
    )
    assert out.exposure[:, :, 0].max() == 0.0
    cond = out.variants[GAUSSIAN_WW].cond.sum(axis=1)
    sampled = out.variants[GAUSSIAN_WW].sampled.sum(axis=1)
    m = channel_metrics(
        cond=cond, sampled=sampled, exposure=out.exposure.sum(axis=1), grid=out.grid
    )
    assert m["pfe99"].value >= m["pfe95"].value > 0 and m["epe"].value > 0


def test_a_run_that_would_not_fit_in_memory_is_refused(snapshot):
    snap = make(snapshot, [loan()], paths=10_000)
    snap["run"] = {**snap["run"], "paths": 500_000, "horizon_days": 1260}
    snap["run"]["step"] = "daily"
    with pytest.raises(ValueError, match="GB for exposures"):
        simulate(seal(snap), validate=False)


def test_an_invalid_snapshot_is_refused_before_any_work(snapshot):
    bad = copy.deepcopy(snapshot)
    bad["run"]["paths"] = 5
    with pytest.raises(ValueError):
        simulate(bad)
