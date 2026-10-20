"""Close-out profile resolution (spec020 decision 4, IND-020, AC-013)."""

import copy

import pytest
from conftest import load
from indemnification_api.profile import effective_settings, resolve_all

DEFAULT = load("closeout-profile.default.json")


def by_id(rows):
    return {r.position_id: r for r in rows}


def snapshot_with(snapshot, **profile_changes):
    s = copy.deepcopy(snapshot)
    s["closeout_profile"] = {**s["closeout_profile"], "borrower_overrides": {}, "position_overrides": {}}
    for key, value in profile_changes.items():
        s["closeout_profile"][key] = value
    return s


def test_default_profile_reproduces_the_decision_4_periods(snapshot):
    s = snapshot_with(snapshot)
    s["closeout_profile"] = copy.deepcopy(DEFAULT)
    rows = by_id(resolve_all(s))
    assert rows["L1"].mpor_days == 5      # liquid equity at 20% of ADV, below the 25% threshold
    assert rows["L2"].mpor_days == 5      # liquid government bond
    assert rows["L3"].mpor_days == 10     # hard-to-borrow, other-liquidity equity
    assert rows["P1"].mpor_days == 5      # reinvestment pool forced-sale period
    assert rows["L1"].settings == DEFAULT["defaults"]
    assert set(rows["L1"].source_levels.values()) == {"default"}


def test_fixture_overrides_apply_where_they_should(snapshot):
    rows = by_id(resolve_all(snapshot))
    # B2 carries addon_days=2 and L3 has adv_units=400000 (75% of ADV, concentrated)
    assert rows["L3"].mpor_days == 12
    assert rows["L3"].source_levels["addon_days"] == "borrower"
    assert rows["L3"].adv_units == 400000
    assert rows["C3"].settings["addon_days"] == 2           # B2's cash collateral holding
    assert rows["L1"].settings["addon_days"] == 0           # B1 unaffected


def test_concentration_threshold_lengthens_the_period(snapshot):
    s = snapshot_with(snapshot)
    s["closeout_profile"]["defaults"]["concentration_threshold_pct_adv"] = 10   # L1 is 20% of ADV
    rows = by_id(resolve_all(s))
    assert rows["L1"].mpor_days == 10
    s["closeout_profile"]["defaults"]["concentration_threshold_pct_adv"] = 25
    assert by_id(resolve_all(s))["L1"].mpor_days == 5


def test_a_government_position_over_the_threshold_is_also_concentrated(snapshot):
    s = snapshot_with(snapshot)
    s["closeout_profile"]["defaults"]["concentration_threshold_pct_adv"] = 10
    rows = by_id(resolve_all(s))
    assert rows["L2"].mpor_days == 10


def test_htb_flag_can_be_turned_off(snapshot):
    s = snapshot_with(snapshot)
    s["closeout_profile"]["defaults"]["htb_uses_concentrated_period"] = False
    s["closeout_profile"]["position_overrides"] = {"L3": {"adv_units": 10_000_000}}   # 3% of ADV
    rows = by_id(resolve_all(s))
    assert rows["L3"].mpor_days == 10     # EQ2 has liquidity_class "other" -> 10 days anyway
    s["closeout_profile"]["defaults"]["mpor_other_days"] = 7
    assert by_id(resolve_all(s))["L3"].mpor_days == 7


def test_precedence_is_position_then_borrower_then_asset_class_then_default(snapshot):
    s = snapshot_with(snapshot)
    s["closeout_profile"]["asset_class_overrides"] = {"EQUITY": {"impact_k": 0.7}}
    s["closeout_profile"]["borrower_overrides"] = {"B1": {"impact_k": 0.8}}
    s["closeout_profile"]["position_overrides"] = {"L1": {"impact_k": 0.9}}
    rows = by_id(resolve_all(s))
    assert rows["L1"].settings["impact_k"] == 0.9 and rows["L1"].source_levels["impact_k"] == "position"
    assert rows["C2"].settings["impact_k"] == 0.8 and rows["C2"].source_levels["impact_k"] == "borrower"
    assert rows["L3"].settings["impact_k"] == 0.7 and rows["L3"].source_levels["impact_k"] == "asset_class"
    assert rows["L2"].settings["impact_k"] == 0.8      # B1 beats the GOVT default
    assert rows["P1"].settings["impact_k"] == 0.5 and rows["P1"].source_levels["impact_k"] == "default"


def test_a_pool_bucket_override_touches_only_that_bucket(snapshot):
    s = snapshot_with(snapshot)
    s["closeout_profile"]["pool_bucket_overrides"] = {"TERM": {"mpor_pool_forced_sale_days": 8}}
    rows = by_id(resolve_all(s))
    assert rows["P3"].mpor_days == 8 and rows["P3"].source_levels["mpor_pool_forced_sale_days"] == "pool_bucket"
    assert rows["P1"].mpor_days == 5 and rows["P2"].mpor_days == 5


def test_a_fixed_period_replaces_the_four_period_settings_and_still_adds_the_add_on(snapshot):
    s = snapshot_with(snapshot)
    s["closeout_profile"]["borrower_overrides"] = {"B1": {"mpor_fixed_days": 20, "addon_days": 3}}
    rows = by_id(resolve_all(s))
    assert rows["L1"].mpor_days == 23 and rows["L2"].mpor_days == 23
    assert rows["C1"].mpor_days == 23     # B1's cash collateral holding shares the borrower's period
    assert rows["L3"].mpor_days == 10     # B2 unaffected


def test_removing_an_override_restores_the_default(snapshot):
    s = snapshot_with(snapshot)
    s["closeout_profile"]["borrower_overrides"] = {"B1": {"impact_k": 0.8}}
    assert by_id(resolve_all(s))["L1"].settings["impact_k"] == 0.8
    s["closeout_profile"]["borrower_overrides"] = {}
    assert by_id(resolve_all(s))["L1"].settings["impact_k"] == 0.5


def test_position_daily_vol_override_is_reported(snapshot):
    s = snapshot_with(snapshot)
    s["closeout_profile"]["position_overrides"] = {"L1": {"daily_vol": 0.05}}
    rows = by_id(resolve_all(s))
    assert rows["L1"].daily_vol == 0.05
    assert rows["L2"].daily_vol == 0.003       # from the security


def test_every_loan_collateral_and_pool_position_gets_one_row(snapshot):
    rows = resolve_all(snapshot)
    expected = {x["id"] for x in snapshot["loans"]} | {x["id"] for x in snapshot["collateral"]} | {
        x["id"] for x in snapshot["pool"]["positions"]
    }
    assert {r.position_id for r in rows} == expected and len(rows) == len(expected)
    assert {r.kind for r in rows} == {"loan", "collateral", "pool_position"}


def test_effective_settings_serializes_to_the_result_contract(snapshot, validator_for):
    row = effective_settings(snapshot, "L1").as_dict()
    schema = validator_for("result-1.0.schema.json")
    result = load("fixtures/result.example.json")
    result["effective_settings"] = [row]
    assert [e.message for e in schema.iter_errors(result)] == []


def test_unknown_position_is_rejected(snapshot):
    with pytest.raises(KeyError):
        effective_settings(snapshot, "NOPE")
