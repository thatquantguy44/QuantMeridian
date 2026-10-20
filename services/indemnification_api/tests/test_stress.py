"""Named deterministic stress scenarios (spec020 IND-011, IND-020).

Each scenario is one hand-built price path: the shock lands one day after the default and the last
margin call, inside the close-out period, so collateral is not reset at shocked prices. Every
shortfall below is computed by hand.
"""

import json
import math

import pytest
from conftest import (
    CONTRACTS,
    cash_holding,
    loan,
    mini_snapshot,
    pool_of,
    pool_position,
    security_holding,
)

from indemnification_api.contracts import seal
from indemnification_api.stress import SCENARIOS, run_stresses

SECURITIES = [
    {
        "id": "EQ",
        "label": "Hard-to-borrow equity",
        "asset_class": "EQUITY",
        "liquidity_class": "other",
        "hard_to_borrow": True,
        "currency": "USD",
        "price": 100.0,
        "adv_units": 1_000_000.0,
        "daily_vol": 0.04,
        "equity_beta": 0.0,
        "rate_duration": 0.0,
        "spread_duration": 0.0,
    },
    {
        "id": "ETF",
        "label": "Equity ETF",
        "asset_class": "ETF",
        "liquidity_class": "liquid",
        "hard_to_borrow": False,
        "currency": "USD",
        "price": 100.0,
        "adv_units": 5_000_000.0,
        "daily_vol": 0.01,
        "equity_beta": 1.0,
        "rate_duration": 0.0,
        "spread_duration": 0.0,
    },
    {
        "id": "GV",
        "label": "Government bond",
        "asset_class": "GOVT",
        "liquidity_class": "liquid",
        "hard_to_borrow": False,
        "currency": "USD",
        "price": 100.0,
        "adv_units": 5_000_000.0,
        "daily_vol": 0.01,
        "equity_beta": 0.0,
        "rate_duration": 4.0,
        "spread_duration": 0.0,
    },
    {
        "id": "GVE",
        "label": "EUR government bond",
        "asset_class": "GOVT",
        "liquidity_class": "liquid",
        "hard_to_borrow": False,
        "currency": "EUR",
        "price": 100.0,
        "adv_units": 5_000_000.0,
        "daily_vol": 0.01,
        "equity_beta": 0.0,
        "rate_duration": 0.0,
        "spread_duration": 0.0,
    },
]

BORROWERS = [
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


def build(snapshot, loans, collateral, *, pool=None, edit=None, securities=None):
    snap = mini_snapshot(
        snapshot,
        loans=loans,
        collateral=collateral,
        securities=securities or SECURITIES,
        borrowers=BORROWERS,
        pool=pool,
    )
    snap["closeout_profile"]["defaults"]["impact_k"] = 0.0
    snap["owners"] = [
        {"id": "O1", "name": "Summitline Index Partners"},
        {"id": "O2", "name": "Pacific Coast Teachers Pension"},
    ]
    if edit:
        edit(snap)
    return seal(snap)


def by_id(stresses):
    return {s["id"]: s for s in stresses}


def borrower_loss(stress, borrower_id, key="default_shortfall"):
    return next(r[key] for r in stress["by_borrower"] if r["borrower_id"] == borrower_id)


def test_the_scenarios_are_the_five_named_ones_in_the_contract_order():
    assert SCENARIOS == (
        "largest_borrower_default",
        "squeeze",
        "rates_shock",
        "fx_shock",
        "reinvestment_run",
    )


def test_the_largest_borrower_defaults_with_equity_down_20_percent(snapshot):
    """Bond loans collateralized by an equity ETF: the ETF falls 20% over the close-out period."""
    snap = build(
        snapshot,
        [
            loan("L1", borrower="B1", security="GV", quantity=1000, cash=False),
            loan("L2", borrower="B2", security="GV", quantity=300, cash=False),
        ],
        [
            security_holding("C1", borrower="B1", security="ETF", quantity=1020.0),
            security_holding("C2", borrower="B2", security="ETF", quantity=306.0),
        ],
    )
    stress = by_id(run_stresses(snap))["largest_borrower_default"]
    # collateral bought at 100 and sold at 100 * exp(-0.2); the bond loan has no equity beta
    expected = 1000 * 100.0 - 1020.0 * 100.0 * math.exp(-0.2)
    assert borrower_loss(stress, "B1") == pytest.approx(expected, rel=1e-12)
    assert borrower_loss(stress, "B2") == 0.0  # only the largest borrower defaults
    assert borrower_loss(stress, "B1", "reinvestment") == 0.0


def test_a_squeeze_lifts_the_most_concentrated_hard_to_borrow_loan_60_percent(snapshot):
    snap = build(
        snapshot,
        [
            loan("L1", borrower="B1", security="EQ", quantity=1000),
            loan("L2", borrower="B2", security="EQ", quantity=50_000),
        ],
        [
            cash_holding("C1", borrower="B1", amount=102_000.0),
            cash_holding("C2", borrower="B2", amount=5_100_000.0),
        ],
    )
    stress = by_id(run_stresses(snap))["squeeze"]
    assert borrower_loss(stress, "B2") == pytest.approx(50_000 * 160.0 - 5_100_000.0)  # 2,900,000
    assert borrower_loss(stress, "B1") == 0.0  # B2's loan is the most concentrated


def test_a_rates_shock_hits_government_collateral_by_its_duration(snapshot):
    snap = build(
        snapshot,
        [loan("L1", borrower="B1", security="EQ", quantity=1000, cash=False)],
        [security_holding("C1", borrower="B1", security="GV", quantity=1020.0)],
    )
    stress = by_id(run_stresses(snap))["rates_shock"]
    collateral = 102_000.0 * math.exp(-4.0 * 0.015)  # +150 bp on a 4-year duration
    assert borrower_loss(stress, "B1") == pytest.approx(
        100_000.0 - collateral, rel=1e-12
    )  # about 3,940


def test_rates_shock_figures_are_each_borrowers_own_default_not_a_joint_event(snapshot):
    snap = build(
        snapshot,
        [
            loan("L1", borrower="B1", security="EQ", quantity=1000, cash=False),
            loan("L2", borrower="B2", security="EQ", quantity=500, cash=False),
        ],
        [
            security_holding("C1", borrower="B1", security="GV", quantity=1020.0),
            security_holding("C2", borrower="B2", security="GV", quantity=510.0),
        ],
    )
    stress = by_id(run_stresses(snap))["rates_shock"]
    assert borrower_loss(stress, "B1") > 0 and borrower_loss(stress, "B2") > 0
    assert borrower_loss(stress, "B2") == pytest.approx(borrower_loss(stress, "B1") / 2)
    assert "each" in stress["label"].lower()


def test_an_fx_shock_moves_foreign_collateral_and_does_nothing_to_a_dollar_book(snapshot):
    foreign = build(
        snapshot,
        [loan("L1", borrower="B1", security="EQ", quantity=1000, cash=False)],
        [security_holding("C1", borrower="B1", security="GVE", quantity=1020.0)],
    )
    stress = by_id(run_stresses(foreign))["fx_shock"]
    assert borrower_loss(stress, "B1") == pytest.approx(
        100_000.0 - 102_000.0 * math.exp(-0.15), rel=1e-12
    )
    dollars = build(
        snapshot,
        [loan("L1", borrower="B1", security="EQ", quantity=1000)],
        [cash_holding("C1", borrower="B1", amount=102_000.0)],
    )
    quiet = by_id(run_stresses(dollars))["fx_shock"]
    assert borrower_loss(quiet, "B1") == 0.0 and "no non-" in quiet["label"].lower()


def test_owner_losses_split_a_borrowers_loss_by_starting_loan_value(snapshot):
    snap = build(
        snapshot,
        [
            loan("L1", borrower="B1", security="EQ", quantity=1000),
            loan("L2", borrower="B1", security="EQ", quantity=3000),
        ],
        [cash_holding("C1", borrower="B1", amount=408_000.0)],
        edit=lambda s: s["loans"][1].update(owner_id="O2"),
    )
    stress = by_id(run_stresses(snap))["squeeze"]
    total = borrower_loss(stress, "B1")
    owners = {o["owner_id"]: o["default_shortfall"] for o in stress["by_owner"]}
    assert total == pytest.approx(4000 * 160.0 - 408_000.0)
    assert owners["O1"] == pytest.approx(total * 0.25) and owners["O2"] == pytest.approx(
        total * 0.75
    )


def test_a_scenario_profile_override_changes_the_scenario_alone(snapshot):
    snap = build(
        snapshot,
        [loan("L1", borrower="B1", security="EQ", quantity=1000)],
        [cash_holding("C1", borrower="B1", amount=102_000.0)],
    )
    plain = borrower_loss(by_id(run_stresses(snap))["squeeze"], "B1")
    costly = borrower_loss(
        by_id(run_stresses(snap, profile_overrides={"half_spread_floor_bps": 100.0}))["squeeze"],
        "B1",
    )
    assert plain == pytest.approx(160_000.0 - 102_000.0)
    assert costly == pytest.approx(160_000.0 * 1.01 - 102_000.0)  # a 1% buy-back cost
    assert (
        snap["closeout_profile"]["defaults"]["half_spread_floor_bps"] == 0
    )  # the snapshot is untouched


def test_a_bad_profile_override_is_rejected(snapshot):
    snap = build(snapshot, [loan("L1")], [cash_holding("C1", amount=102_000.0)])
    with pytest.raises(ValueError):
        run_stresses(snap, profile_overrides={"impact_alpha": 0.0})
    with pytest.raises(ValueError):
        run_stresses(snap, profile_overrides={"not_a_setting": 1})


def test_the_reinvestment_run_matches_a_hand_calculation(snapshot):
    """+200 bp on spreads, one BANK issuer defaults, 30% of the loans are returned within a week."""
    pool = pool_of(
        pool_position("P1", bucket="TERM", credit="BANK", allocation=102_000.0, wam_days=70.0)
    )
    snap = build(
        snapshot,
        [loan("L1", borrower="B1", security="EQ", quantity=1000)],
        [cash_holding("C1", borrower="B1", amount=102_000.0)],
        pool=pool,
    )
    stress = by_id(run_stresses(snap))["reinvestment_run"]
    price = math.exp(-(70.0 / 252.0) * 1.0 * 0.02)  # BANK credit beta 1.0
    after_default = 102_000.0 * price * 0.4  # recovery 40%
    deficiency_day_1 = 102_000.0 - after_default
    owed_after = 0.7 * 102_000.0
    cost = 0.0025  # TERM forced-sale floor
    sold = (102_000.0 - owed_after) / (1 - cost)
    deficiency_day_5 = owed_after - (after_default - sold)
    expected = max(deficiency_day_1, deficiency_day_5)
    assert borrower_loss(stress, "B1", "reinvestment") == pytest.approx(expected, rel=1e-9)
    assert borrower_loss(stress, "B1", "default_shortfall") == 0.0
    owners = {o["owner_id"]: o["reinvestment"] for o in stress["by_owner"]}
    assert (
        owners["O1"] == pytest.approx(expected, rel=1e-9) and owners["O2"] == 0.0
    )  # the pool is all O1's


def test_the_reinvestment_run_with_no_pool_reports_zero_and_says_so(snapshot):
    snap = build(
        snapshot,
        [loan("L1", borrower="B1", security="EQ", quantity=1000)],
        [cash_holding("C1", borrower="B1", amount=102_000.0)],
    )
    stress = by_id(run_stresses(snap))["reinvestment_run"]
    assert all(r["reinvestment"] == 0.0 for r in stress["by_borrower"])
    assert "no reinvestment pool" in stress["label"].lower()


def test_stresses_validate_against_the_result_contract_on_the_sim_book(validator_for):
    book = json.loads((CONTRACTS / "fixtures" / "sim-book.example.json").read_text("utf-8"))
    stresses = run_stresses(book)
    assert [s["id"] for s in stresses] == list(SCENARIOS)
    result = json.loads((CONTRACTS / "fixtures" / "result.example.json").read_text("utf-8"))
    result["stresses"] = stresses
    errors = [e.message for e in validator_for("result-1.0.schema.json").iter_errors(result)]
    assert errors == []
    for s in stresses:
        assert len(s["by_borrower"]) == 16 and len(s["by_owner"]) == 6
        assert all(r["default_shortfall"] >= 0 and r["reinvestment"] >= 0 for r in s["by_borrower"])
    squeeze = by_id(stresses)["squeeze"]
    # a borrower's collateral is pooled across its loans, so a diversified borrower's 5% buffer can
    # absorb a squeeze on one name: the loss is zero or, at most, one borrower's
    assert sum(1 for r in squeeze["by_borrower"] if r["default_shortfall"] > 0) <= 1
    assert squeeze["label"].split()[0] in {s["id"] for s in book["securities"]}
    run = by_id(stresses)["reinvestment_run"]
    assert sum(r["reinvestment"] for r in run["by_borrower"]) == pytest.approx(
        sum(o["reinvestment"] for o in run["by_owner"])
    )


def test_collateral_is_pooled_so_margin_on_other_loans_absorbs_a_squeeze_on_one(snapshot):
    """The squeezed loan (1,000 shares, 105% margin) loses 160,000 - 105,000 = 55,000. The
    borrower's 5% buffer on its other loan absorbs 50,000 of it, or all of it when that loan is
    twice as large.
    """

    def loss(etf_quantity):
        loans = [
            loan("L1", borrower="B1", security="EQ", quantity=1000, margin=105.0),
            loan("L2", borrower="B1", security="ETF", quantity=etf_quantity, margin=105.0),
        ]
        cash = [cash_holding("C1", borrower="B1", amount=105_000.0 + 1.05 * 100.0 * etf_quantity)]
        return borrower_loss(by_id(run_stresses(build(snapshot, loans, cash)))["squeeze"], "B1")

    assert loss(10_000) == pytest.approx(5_000.0)  # 55,000 - 0.05 x 1,000,000
    assert loss(20_000) == 0.0  # 55,000 < 0.05 x 2,000,000
