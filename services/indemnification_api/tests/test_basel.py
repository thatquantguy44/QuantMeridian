"""Basel comprehensive approach cross-check (spec020 IND-009, AC-006).

E* = max(0, E x (1 + He) - C x (1 - Hc - Hfx)) per borrower, with supervisory haircuts scaled by
sqrt(MPOR / base MPOR). Every case is computed by hand.
"""

import math

import pytest
from conftest import cash_holding, loan, mini_snapshot, security_holding

from indemnification_api.basel import comprehensive_approach, supervisory_haircut

TABLE = {
    "label": "ILLUSTRATIVE",
    "base_mpor_days": 10,
    "equity_main_index": 0.15,
    "equity_other": 0.25,
    "sovereign": {"le_1y": 0.005, "1y_to_5y": 0.02, "gt_5y": 0.04},
    "corporate": {"le_1y": 0.02, "1y_to_5y": 0.06, "gt_5y": 0.12},
    "fx_mismatch": 0.08,
}


def run(snapshot, loans, collateral, *, mpor=10, securities=None, edit=None, **kw):
    snap = mini_snapshot(snapshot, loans=loans, collateral=collateral, securities=securities, **kw)
    snap["closeout_profile"]["defaults"].update(mpor_liquid_days=mpor, mpor_other_days=mpor)
    snap["basel_haircuts"] = TABLE
    if edit:
        edit(snap)
    return {row["borrower_id"]: row for row in comprehensive_approach(snap)}


def test_liquid_equity_lent_against_cash_at_the_base_horizon(snapshot):
    row = run(snapshot, [loan(quantity=1000)], [cash_holding(amount=102_000.0)])["B1"]
    assert row["exposure"] == 100_000 and row["collateral"] == 102_000
    assert row["e_star"] == pytest.approx(100_000 * 1.15 - 102_000)  # 13,000


def test_haircuts_scale_with_the_square_root_of_the_close_out_period(snapshot):
    for mpor in (5, 10, 20):
        row = run(snapshot, [loan(quantity=1000)], [cash_holding(amount=102_000.0)], mpor=mpor)[
            "B1"
        ]
        assert row["e_star"] == pytest.approx(100_000 * (1 + 0.15 * math.sqrt(mpor / 10)) - 102_000)


def test_e_star_rises_with_the_close_out_period_and_falls_with_collateral(snapshot):
    values = [
        run(snapshot, [loan(quantity=1000)], [cash_holding(amount=102_000.0)], mpor=m)["B1"][
            "e_star"
        ]
        for m in (3, 5, 10, 20)
    ]
    assert values == sorted(values)
    more = run(snapshot, [loan(quantity=1000)], [cash_holding(amount=110_000.0)])["B1"]["e_star"]
    assert more < values[2]


def test_an_overcollateralized_borrower_has_no_exposure_not_a_negative_one(snapshot):
    assert (
        run(snapshot, [loan(quantity=1000)], [cash_holding(amount=150_000.0)])["B1"]["e_star"]
        == 0.0
    )


def test_collateral_in_another_currency_takes_the_fx_mismatch_haircut(snapshot):
    securities = [
        {
            "id": "EQ",
            "label": "Equity",
            "asset_class": "EQUITY",
            "liquidity_class": "liquid",
            "hard_to_borrow": False,
            "currency": "USD",
            "price": 100.0,
            "adv_units": 1e6,
            "daily_vol": 0.02,
            "equity_beta": 0.0,
            "rate_duration": 0.0,
            "spread_duration": 0.0,
        },
        {
            "id": "GV",
            "label": "EUR government bond",
            "asset_class": "GOVT",
            "liquidity_class": "liquid",
            "hard_to_borrow": False,
            "currency": "EUR",
            "price": 100.0,
            "adv_units": 5e6,
            "daily_vol": 0.003,
            "equity_beta": 0.0,
            "rate_duration": 4.0,
            "spread_duration": 0.0,
        },
    ]
    row = run(
        snapshot,
        [loan(quantity=1000, cash=False)],
        [security_holding(quantity=1020.0)],
        securities=securities,
    )["B1"]
    # collateral 102,000 at 2% (1-5y sovereign) + 8% currency mismatch
    assert row["e_star"] == pytest.approx(100_000 * 1.15 - 102_000 * (1 - 0.02 - 0.08))  # 23,200


def test_the_haircut_depends_on_the_asset_class_liquidity_and_duration(snapshot):
    base = {"liquidity_class": "liquid", "hard_to_borrow": False, "rate_duration": 0.0}
    assert supervisory_haircut({**base, "asset_class": "EQUITY"}, TABLE) == 0.15
    assert supervisory_haircut({**base, "asset_class": "ETF"}, TABLE) == 0.15
    assert (
        supervisory_haircut({**base, "asset_class": "EQUITY", "liquidity_class": "other"}, TABLE)
        == 0.25
    )
    assert (
        supervisory_haircut({**base, "asset_class": "EQUITY", "hard_to_borrow": True}, TABLE)
        == 0.25
    )
    for duration, expected in ((0.5, 0.005), (1.0, 0.005), (3.0, 0.02), (5.0, 0.02), (7.0, 0.04)):
        assert (
            supervisory_haircut({**base, "asset_class": "GOVT", "rate_duration": duration}, TABLE)
            == expected
        )
    for duration, expected in ((0.5, 0.02), (3.0, 0.06), (7.0, 0.12)):
        assert (
            supervisory_haircut({**base, "asset_class": "CORP", "rate_duration": duration}, TABLE)
            == expected
        )
    assert (
        supervisory_haircut({**base, "asset_class": "COMMODITY"}, TABLE) == 0.25
    )  # anything else: the highest


def test_a_hard_to_borrow_loan_takes_the_higher_equity_haircut(snapshot):
    securities = [
        {
            "id": "EQ",
            "label": "Hard to borrow",
            "asset_class": "EQUITY",
            "liquidity_class": "other",
            "hard_to_borrow": True,
            "currency": "USD",
            "price": 100.0,
            "adv_units": 1e6,
            "daily_vol": 0.04,
            "equity_beta": 0.0,
            "rate_duration": 0.0,
            "spread_duration": 0.0,
        },
        {
            "id": "GV",
            "label": "Govt",
            "asset_class": "GOVT",
            "liquidity_class": "liquid",
            "hard_to_borrow": False,
            "currency": "USD",
            "price": 100.0,
            "adv_units": 5e6,
            "daily_vol": 0.003,
            "equity_beta": 0.0,
            "rate_duration": 0.0,
            "spread_duration": 0.0,
        },
    ]
    row = run(
        snapshot, [loan(quantity=1000)], [cash_holding(amount=105_000.0)], securities=securities
    )["B1"]
    assert row["e_star"] == pytest.approx(100_000 * 1.25 - 105_000)


def test_each_borrower_is_its_own_netting_set(snapshot):
    borrowers = [
        {
            "id": "B1",
            "name": "Alderwood Capital",
            "rating": "A",
            "spread_bps": None,
            "recovery": None,
            "credit_provenance": "sim",
        },
        {
            "id": "B2",
            "name": "Harrowgate Partners",
            "rating": "BBB",
            "spread_bps": None,
            "recovery": None,
            "credit_provenance": "sim",
        },
    ]
    rows = run(
        snapshot,
        [loan("L1", borrower="B1", quantity=1000), loan("L2", borrower="B2", quantity=500)],
        [
            cash_holding("C1", borrower="B1", amount=102_000.0),
            cash_holding("C2", borrower="B2", amount=60_000.0),
        ],
        borrowers=borrowers,
    )
    assert rows["B1"]["e_star"] == pytest.approx(13_000.0)
    assert rows["B2"]["e_star"] == 0.0  # 50,000 x 1.15 = 57,500 < 60,000: covered


def test_a_position_add_on_lengthens_that_borrowers_period(snapshot):
    row = run(
        snapshot,
        [loan(quantity=1000)],
        [cash_holding(amount=102_000.0)],
        mpor=5,
        edit=lambda s: s["closeout_profile"]["borrower_overrides"].update(B1={"addon_days": 5}),
    )["B1"]
    assert row["e_star"] == pytest.approx(100_000 * (1 + 0.15) - 102_000)  # 5 + 5 = 10 days


def test_the_fixture_book_produces_one_row_per_borrower(snapshot):
    rows = comprehensive_approach(snapshot)
    assert [r["borrower_id"] for r in rows] == ["B1", "B2"]
    assert all(r["e_star"] >= 0 and r["exposure"] > 0 and r["collateral"] > 0 for r in rows)
