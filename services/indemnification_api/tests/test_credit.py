"""Borrower credit inputs (spec020 decision 2, IND-018, AC-011)."""

import copy
import math

import pytest
from conftest import load

from indemnification_api.credit import (
    default_probability,
    hazard_from_pd,
    hazard_from_spread,
    resolve_borrower_credit,
    resolve_credit,
)

TABLE = load("rating-pd-table.default.json")


def borrower(**overrides):
    base = {
        "id": "B1",
        "name": "Alderwood Capital",
        "rating": "A",
        "spread_bps": None,
        "recovery": None,
        "credit_provenance": "sim",
    }
    return {**base, **overrides}


def test_hazard_from_pd_round_trips_to_the_one_year_pd():
    for pd in (0.0001, 0.0006, 0.0085, 0.25):
        assert default_probability(hazard_from_pd(pd), 1.0) == pytest.approx(pd, rel=1e-12)


def test_hazard_from_pd_matches_a_hand_calculation():
    assert hazard_from_pd(0.0006) == pytest.approx(-math.log(1 - 0.0006), rel=1e-15)
    assert hazard_from_pd(0.0006) == pytest.approx(0.00060018, abs=1e-9)


def test_constant_hazard_gives_the_half_year_pd_from_the_one_year_pd():
    h = hazard_from_pd(0.04)
    assert default_probability(h, 0.5) == pytest.approx(1 - math.sqrt(1 - 0.04), rel=1e-12)
    assert default_probability(h, 0.0) == 0.0


def test_spread_to_hazard_is_spread_over_one_minus_recovery():
    # 240 bps, 40% recovery: hazard = 0.024 / 0.6 = 0.04, one-year PD = 1 - exp(-0.04) = 0.039211
    assert hazard_from_spread(240, 0.4) == pytest.approx(0.04, rel=1e-15)
    assert default_probability(hazard_from_spread(240, 0.4), 1.0) == pytest.approx(
        0.0392106, abs=1e-7
    )


def test_table_borrower_uses_the_rating_table():
    credit = resolve_borrower_credit(borrower(), TABLE, default_recovery=0.4)
    assert credit.source == "RATING_TABLE"
    assert credit.pd_1y == pytest.approx(TABLE["pd_1y"]["A"], rel=1e-12)
    assert credit.hazard == pytest.approx(hazard_from_pd(TABLE["pd_1y"]["A"]), rel=1e-15)
    assert credit.recovery is None
    assert credit.rating == "A"


def test_spread_overrides_the_table_and_uses_the_default_recovery_when_none_is_entered():
    credit = resolve_borrower_credit(
        borrower(rating="BBB", spread_bps=240), TABLE, default_recovery=0.4
    )
    assert credit.source == "USER_SPREAD"
    assert credit.hazard == pytest.approx(0.04, rel=1e-15)
    assert credit.recovery == 0.4
    assert credit.pd_1y != pytest.approx(TABLE["pd_1y"]["BBB"])


def test_an_entered_recovery_beats_the_default():
    credit = resolve_borrower_credit(
        borrower(spread_bps=300, recovery=0.25), TABLE, default_recovery=0.4
    )
    assert credit.hazard == pytest.approx(0.03 / 0.75, rel=1e-15)
    assert credit.recovery == 0.25


def test_removing_the_spread_falls_back_to_the_table_and_the_label_changes():
    with_spread = resolve_borrower_credit(borrower(rating="BBB", spread_bps=240), TABLE, 0.4)
    without = resolve_borrower_credit(borrower(rating="BBB", spread_bps=None), TABLE, 0.4)
    assert (with_spread.source, without.source) == ("USER_SPREAD", "RATING_TABLE")
    assert without.pd_1y == pytest.approx(TABLE["pd_1y"]["BBB"], rel=1e-12)


def test_an_entered_recovery_without_a_spread_is_ignored():
    credit = resolve_borrower_credit(borrower(recovery=0.9), TABLE, 0.4)
    assert credit.source == "RATING_TABLE"
    assert credit.recovery is None


def test_unrated_borrowers_use_the_NR_row():
    credit = resolve_borrower_credit(borrower(rating="NR"), TABLE, 0.4)
    assert credit.pd_1y == pytest.approx(TABLE["pd_1y"]["NR"], rel=1e-12)


@pytest.mark.parametrize("spread, recovery", [(0, 0.4), (-5, 0.4), (100, 1.0), (100, -0.1)])
def test_invalid_spread_or_recovery_is_rejected(spread, recovery):
    with pytest.raises(ValueError):
        resolve_borrower_credit(borrower(spread_bps=spread, recovery=recovery), TABLE, 0.4)


def test_a_rating_missing_from_the_table_is_rejected():
    table = copy.deepcopy(TABLE)
    del table["pd_1y"]["A"]
    with pytest.raises(ValueError, match="no PD for rating A"):
        resolve_borrower_credit(borrower(), table, 0.4)


def test_hazard_from_pd_rejects_probabilities_outside_zero_one():
    for pd in (0, 1, -0.1, 1.5):
        with pytest.raises(ValueError):
            hazard_from_pd(pd)


def test_resolve_credit_covers_every_snapshot_borrower(snapshot):
    credits = resolve_credit(snapshot)
    assert set(credits) == {b["id"] for b in snapshot["borrowers"]}
    assert credits["B1"].source == "RATING_TABLE"
    assert credits["B2"].source == "USER_SPREAD"
    assert credits["B2"].hazard == pytest.approx(0.04, rel=1e-15)
