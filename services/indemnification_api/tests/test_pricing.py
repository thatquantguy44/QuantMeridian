"""Indemnification cost against fee, with economic capital (spec020 decision 6, IND-012, AC-015).

cost (bps a year) = (EL + cost of capital x economic capital) / average loan value economic capital
= annual VaR99.9 - EL of the program, split by Euler expected-shortfall share.
"""

import json

import numpy as np
import pytest
from conftest import CONTRACTS, cash_holding, loan, mini_snapshot

from indemnification_api.contracts import seal
from indemnification_api.engine import simulate
from indemnification_api.pricing import allocate_capital, price_borrower, risk_weight
from indemnification_api.results import build_result

WEIGHTS = {
    "aaa_to_aa_minus": 0.2,
    "a_plus_to_a_minus": 0.5,
    "bbb_plus_to_bb_minus": 1.0,
    "below_bb_minus": 1.5,
    "unrated": 1.0,
}
PRICING = {"cost_of_capital": 0.10, "flag_threshold": 0.5, "risk_weights": WEIGHTS}


@pytest.mark.parametrize(
    "rating, expected",
    [
        ("AAA", 0.2),
        ("AA-", 0.2),
        ("A+", 0.5),
        ("A-", 0.5),
        ("BBB+", 1.0),
        ("BB-", 1.0),
        ("B+", 1.5),
        ("CCC", 1.5),
        ("NR", 1.0),
    ],
)
def test_risk_weights_follow_the_rating_bands(rating, expected):
    assert risk_weight(rating, WEIGHTS) == expected


def test_economic_capital_is_unexpected_loss_split_by_euler_share():
    capital = allocate_capital(
        var999=24_000.0,
        program_el=4_000.0,
        euler=np.array([3_000.0, 7_000.0]),
        el=np.array([1_000.0, 3_000.0]),
    )
    assert capital.tolist() == pytest.approx([6_000.0, 14_000.0])  # UL = 20,000, shares 30% and 70%
    assert capital.sum() == pytest.approx(20_000.0)


def test_capital_falls_back_to_expected_loss_shares_when_no_tail_loss_is_sampled():
    capital = allocate_capital(
        var999=24_000.0, program_el=4_000.0, euler=np.zeros(2), el=np.array([1_000.0, 3_000.0])
    )
    assert capital.tolist() == pytest.approx([5_000.0, 15_000.0])  # 25% and 75%
    assert allocate_capital(
        var999=3_000.0, program_el=4_000.0, euler=np.array([1.0, 1.0]), el=np.array([1.0, 1.0])
    ).tolist() == [0.0, 0.0]  # VaR below EL: no unexpected loss


def test_a_borrowers_cost_in_basis_points_matches_a_hand_calculation():
    a = price_borrower(
        el=1_000.0,
        capital=6_000.0,
        avg_loan_value=100_000_000.0,
        fee_bps=30.0,
        proxy_exposure=2_000_000.0,
        rating="A",
        pricing=PRICING,
    )
    assert a["expected_loss_bps"] == pytest.approx(0.1)  # 1,000 / 100M x 10,000
    assert a["economic_capital_cost_bps"] == pytest.approx(0.06)  # 10% x 6,000 / 100M x 10,000
    assert a["indemnification_cost_bps"] == pytest.approx(0.16)  # (1,000 + 600) / 100M x 10,000
    assert a["regulatory_proxy_cost_bps"] == pytest.approx(
        0.9
    )  # (1,000 + 10% x 80,000) / 100M x 10,000
    assert a["economic_capital"] == 6_000.0 and a["average_loan_value"] == 100_000_000.0
    assert a["fee_bps"] == 30.0 and a["flagged"] is False  # 0.16 < 0.5 x 30


def test_a_borrower_whose_cost_exceeds_half_its_fee_is_flagged_and_the_proxy_never_decides():
    b = price_borrower(
        el=3_000.0,
        capital=14_000.0,
        avg_loan_value=50_000_000.0,
        fee_bps=1.0,
        proxy_exposure=1_000_000.0,
        rating="BBB",
        pricing=PRICING,
    )
    assert b["indemnification_cost_bps"] == pytest.approx(0.88)  # (3,000 + 1,400) / 50M x 10,000
    assert b["flagged"] is True  # 0.88 > 0.5 x 1.0
    assert b["regulatory_proxy_cost_bps"] == pytest.approx(
        2.2
    )  # (3,000 + 10% x 80,000) / 50M x 10,000
    # a proxy above the fee does not flag a borrower the economic cost clears
    c = price_borrower(
        el=0.0,
        capital=0.0,
        avg_loan_value=1_000_000.0,
        fee_bps=10.0,
        proxy_exposure=1e9,
        rating="CCC",
        pricing=PRICING,
    )
    assert c["regulatory_proxy_cost_bps"] > c["fee_bps"] and c["flagged"] is False


def test_the_flag_threshold_and_cost_of_capital_are_configurable():
    base = dict(
        el=1_000.0,
        capital=6_000.0,
        avg_loan_value=100_000_000.0,
        fee_bps=0.3,
        proxy_exposure=0.0,
        rating="A",
    )
    assert price_borrower(**base, pricing=PRICING)["flagged"] is True  # 0.16 > 0.15
    assert (
        price_borrower(**base, pricing={**PRICING, "flag_threshold": 0.6})["flagged"] is False
    )  # 0.16 < 0.18
    dearer = price_borrower(**base, pricing={**PRICING, "cost_of_capital": 0.30})
    assert dearer["indemnification_cost_bps"] == pytest.approx((1_000 + 0.3 * 6_000) / 1e8 * 1e4)
    assert dearer["indemnification_cost_bps"] == pytest.approx(0.28)


def test_a_zero_fee_is_flagged_if_there_is_any_cost():
    free = price_borrower(
        el=10.0,
        capital=0.0,
        avg_loan_value=1e6,
        fee_bps=0.0,
        proxy_exposure=0.0,
        rating="A",
        pricing=PRICING,
    )
    assert free["flagged"] is True
    nothing = price_borrower(
        el=0.0,
        capital=0.0,
        avg_loan_value=1e6,
        fee_bps=0.0,
        proxy_exposure=0.0,
        rating="A",
        pricing=PRICING,
    )
    assert nothing["flagged"] is False


CCC = [
    {
        "id": "B1",
        "name": "Alderwood Capital",
        "rating": "CCC",
        "spread_bps": None,
        "recovery": None,
        "credit_provenance": "sim",
    }
]


def annual_snapshot(snapshot, *, mode="annual", horizon=252, rate_bps=30.0, paths=5000):
    loans = [loan(quantity=1000)]
    loans[0]["rate_bps"] = rate_bps
    snap = mini_snapshot(
        snapshot, loans=loans, collateral=[cash_holding(amount=102_000.0)], borrowers=CCC
    )
    snap["run"] = {
        **snap["run"],
        "mode": mode,
        "horizon_days": horizon,
        "step": "weekly",
        "paths": paths,
    }
    snap["closeout_profile"]["defaults"]["impact_k"] = 0.0
    snap["model"]["returns"]["open_loan_hazard_annual"] = 0.0
    snap["model"]["student_t_enabled"] = False
    return seal(snap)


def borrower_pricing(snap):
    result = build_result(snap, simulate(snap), created_at="2026-10-20T12:00:00Z")
    return result, result["borrowers"][0]["pricing"]


def test_the_annual_view_prices_every_borrower_and_matches_the_formula(snapshot, validator_for):
    result, p = borrower_pricing(annual_snapshot(snapshot))
    assert [e.message for e in validator_for("result-1.0.schema.json").iter_errors(result)] == []
    assert p["average_loan_value"] == pytest.approx(100_000.0) and p["fee_bps"] == 30.0
    assert p["expected_loss_bps"] > 0 and p["economic_capital"] >= 0
    recomputed = (
        p["expected_loss_bps"] + 0.10 * p["economic_capital"] / p["average_loan_value"] * 1e4
    )
    assert p["indemnification_cost_bps"] == pytest.approx(recomputed)
    program = result["program"]["gaussian"]["with_wrong_way"]["total"]
    unexpected = max(0.0, program["var999"]["value"] - program["el"]["value"])
    assert p["economic_capital"] == pytest.approx(
        unexpected
    )  # one borrower carries it all (AC-015)


def test_a_small_fee_is_flagged_and_a_large_one_is_not(snapshot):
    _, cheap = borrower_pricing(annual_snapshot(snapshot, rate_bps=1.0))
    _, rich = borrower_pricing(annual_snapshot(snapshot, rate_bps=100_000.0))
    assert cheap["flagged"] is True and rich["flagged"] is False


def test_the_desk_view_and_other_horizons_are_not_priced_and_the_card_says_why(snapshot):
    for kwargs in ({"mode": "desk", "horizon": 21}, {"horizon": 126}):
        result, pricing = borrower_pricing(annual_snapshot(snapshot, **kwargs))
        assert pricing is None
        assert "pricing" in result["model_card"]["limitations"].lower()


def test_capital_sums_to_the_programs_unexpected_loss_on_the_sim_book():
    book = json.loads((CONTRACTS / "fixtures" / "sim-book.example.json").read_text("utf-8"))
    snap = seal(
        {
            **book,
            "run": {
                **book["run"],
                "mode": "annual",
                "horizon_days": 252,
                "step": "monthly",
                "paths": 2000,
            },
        }
    )
    result = build_result(snap, simulate(snap), created_at="2026-10-20T12:00:00Z")
    total = result["program"]["gaussian"]["with_wrong_way"]["total"]
    unexpected = max(0.0, total["var999"]["value"] - total["el"]["value"])
    priced = [b["pricing"] for b in result["borrowers"]]
    assert all(p is not None for p in priced)
    assert sum(p["economic_capital"] for p in priced) == pytest.approx(unexpected)
    assert all(p["indemnification_cost_bps"] >= p["expected_loss_bps"] for p in priced)
