"""One-parameter sweeps on common random numbers (spec020 IND-010, AC-003)."""

import json
import math

import pytest
from conftest import CONTRACTS, cash_holding, loan, mini_snapshot, security_holding

from indemnification_api.contracts import seal
from indemnification_api.engine import simulate
from indemnification_api.sensitivity import default_sensitivities, run_sensitivity

EQUITY = {
    "id": "EQ", "label": "Test equity", "asset_class": "EQUITY", "liquidity_class": "liquid",
    "hard_to_borrow": False, "currency": "USD", "price": 100.0, "adv_units": 1_000_000.0,
    "daily_vol": 0.02, "equity_beta": 1.0, "rate_duration": 0.0, "spread_duration": 0.0,
}  # fmt: skip
ETF = {**EQUITY, "id": "ETF", "label": "Equity ETF", "asset_class": "ETF", "daily_vol": 0.01}
GOVT = {
    **EQUITY, "id": "GV", "label": "Government bond", "asset_class": "GOVT", "daily_vol": 0.003,
    "equity_beta": 0.0, "rate_duration": 4.0,
}  # fmt: skip
CCC = [
    {"id": "B1", "name": "Alderwood Capital", "rating": "CCC", "spread_bps": None, "recovery": None,
     "credit_provenance": "sim"}
]  # fmt: skip


def cash_book(snapshot, *, paths=5000):
    snap = mini_snapshot(snapshot, loans=[loan(quantity=1000, margin=102.0)],
                         collateral=[cash_holding(amount=102_000.0)], securities=[EQUITY, GOVT],
                         borrowers=CCC)  # fmt: skip
    snap["run"] = {**snap["run"], "paths": paths, "horizon_days": 63, "step": "daily"}
    snap["closeout_profile"]["defaults"]["impact_k"] = 0.0
    snap["model"]["returns"]["open_loan_hazard_annual"] = 0.0
    snap["model"]["student_t_enabled"] = False
    return seal(snap)


def non_cash_book(snapshot, *, paths=5000):
    snap = mini_snapshot(snapshot, loans=[loan(security="GV", quantity=1000, cash=False)],
                         collateral=[security_holding(security="ETF", quantity=1020.0)],
                         securities=[EQUITY, ETF, GOVT], borrowers=CCC)  # fmt: skip
    snap["run"] = {**snap["run"], "paths": paths, "horizon_days": 63, "step": "daily"}
    snap["closeout_profile"]["defaults"]["impact_k"] = 0.0
    snap["model"]["returns"]["open_loan_hazard_annual"] = 0.0
    snap["model"]["student_t_enabled"] = False
    return seal(snap)


def values(sweep, key="el"):
    return [m["value"] for m in sweep[key]]


def test_expected_loss_falls_with_margin_exactly_on_common_random_numbers(snapshot):
    sweep = run_sensitivity(cash_book(snapshot), "margin_pct", [102.0, 103.0, 105.0, 108.0, 110.0])
    el = values(sweep)
    assert sweep["parameter"] == "margin_pct" and sweep["values"] == [
        102.0,
        103.0,
        105.0,
        108.0,
        110.0,
    ]
    assert (
        all(b <= a for a, b in zip(el, el[1:], strict=False)) and el[0] > el[-1]
    )  # exact, not statistical
    assert values(sweep, "el_reinvestment") == [0.0] * 5  # no pool in this book
    assert values(sweep, "el_default_shortfall") == el
    pfe = values(sweep, "pfe99")
    assert all(b <= a for a, b in zip(pfe, pfe[1:], strict=False)) and pfe[0] > 0


def test_expected_loss_rises_with_the_close_out_period(snapshot):
    sweep = run_sensitivity(cash_book(snapshot), "mpor_days", [2, 5, 10, 20])
    el = values(sweep)
    assert all(b >= a for a, b in zip(el, el[1:], strict=False)) and el[-1] > el[0]


def test_a_close_out_sweep_on_the_sim_book_uses_the_same_paths_at_every_point():
    book = json.loads((CONTRACTS / "fixtures" / "sim-book.example.json").read_text("utf-8"))
    sweep = run_sensitivity(book, "mpor_days", [3, 5, 10, 20], paths=1000)
    default = values(sweep, "el_default_shortfall")
    # the simulated days include the longest close-out period; the paths must not change with it
    assert all(b >= a - 1e-9 for a, b in zip(default, default[1:], strict=False))


def test_a_sweep_point_equals_a_full_run_at_that_value(snapshot):
    base = cash_book(snapshot)
    sweep = run_sensitivity(base, "margin_pct", [105.0])
    changed = json.loads(json.dumps(base))
    for item in changed["loans"]:
        item["margin_pct"] = 105.0
    out = simulate(seal(changed))
    cond = out.variants["gaussian_ww"].cond.sum(axis=1) + out.pool_loss
    assert sweep["el"][0]["value"] == pytest.approx(cond.mean(), rel=1e-12)
    assert sweep["el"][0]["std_error"] == pytest.approx(
        cond.std(ddof=1) / math.sqrt(len(cond)), rel=1e-12
    )


def test_expected_loss_rises_with_wrong_way_correlation_and_a_bad_value_is_explained(snapshot):
    def edit(s):
        s["model"].update(rho_d=0.5, rho_w=0.0)
        return seal(s)

    base = edit(json.loads(json.dumps(cash_book(snapshot))))
    el = values(run_sensitivity(base, "rho_w", [0.0, 0.3, 0.6]))
    assert all(b >= a for a, b in zip(el, el[1:], strict=False)) and el[-1] > el[0]
    with pytest.raises(ValueError, match="rho_w"):
        run_sensitivity(base, "rho_w", [0.8])  # 0.64 > rho_d = 0.5


def test_replacing_equity_collateral_with_government_collateral_lowers_expected_loss(snapshot):
    sweep = run_sensitivity(non_cash_book(snapshot), "collateral_substitution", [0.0, 0.5, 1.0])
    el = values(sweep)
    base = values(run_sensitivity(non_cash_book(snapshot), "margin_pct", [102.0]))[0]
    assert el[0] == pytest.approx(base, rel=1e-12)  # nothing substituted: the baseline
    assert el[0] > el[1] > el[2]


def test_substitution_needs_security_collateral_and_a_government_security(snapshot):
    with pytest.raises(ValueError, match="no security collateral"):
        run_sensitivity(cash_book(snapshot), "collateral_substitution", [1.0])
    snap = mini_snapshot(snapshot, loans=[loan(security="EQ", quantity=1000, cash=False)],
                         collateral=[security_holding(security="ETF", quantity=1020.0)],
                         securities=[EQUITY, ETF], borrowers=CCC)  # fmt: skip
    snap["run"] = {**snap["run"], "paths": 1000}
    with pytest.raises(ValueError, match="government"):
        run_sensitivity(seal(snap), "collateral_substitution", [1.0])


def test_any_numeric_profile_setting_can_be_swept(snapshot):
    sweep = run_sensitivity(
        cash_book(snapshot), "profile:half_spread_floor_bps", [0.0, 50.0, 200.0]
    )
    el = values(sweep)
    assert all(b >= a for a, b in zip(el, el[1:], strict=False)) and el[-1] > el[0]
    with pytest.raises(ValueError):
        run_sensitivity(
            cash_book(snapshot), "profile:impact_alpha", [0.0]
        )  # outside the profile schema
    with pytest.raises(ValueError):
        run_sensitivity(cash_book(snapshot), "profile:not_a_setting", [1.0])


def test_unknown_parameters_and_empty_sweeps_are_refused(snapshot):
    with pytest.raises(ValueError, match="unknown parameter"):
        run_sensitivity(cash_book(snapshot), "volatility", [0.1])
    with pytest.raises(ValueError, match="at least one value"):
        run_sensitivity(cash_book(snapshot), "margin_pct", [])


def test_sweeps_can_use_fewer_paths_than_the_main_run(snapshot):
    sweep = run_sensitivity(
        cash_book(snapshot, paths=20_000), "margin_pct", [102.0, 105.0], paths=2000
    )
    full = run_sensitivity(cash_book(snapshot, paths=20_000), "margin_pct", [102.0, 105.0])
    assert sweep["el"][0]["std_error"] > full["el"][0]["std_error"]
    with pytest.raises(ValueError, match="1000"):
        run_sensitivity(cash_book(snapshot), "margin_pct", [102.0], paths=500)


def test_the_default_sweeps_validate_against_the_result_contract_on_the_sim_book(validator_for):
    book = json.loads((CONTRACTS / "fixtures" / "sim-book.example.json").read_text("utf-8"))
    sweeps = default_sensitivities(book, paths=1000)
    names = [s["parameter"] for s in sweeps]
    assert names == ["margin_pct", "mpor_days", "rho_w", "collateral_substitution"]
    assert all(
        v <= math.sqrt(book["model"]["rho_d"])
        for v in next(s for s in sweeps if s["parameter"] == "rho_w")["values"]
    )
    result = json.loads((CONTRACTS / "fixtures" / "result.example.json").read_text("utf-8"))
    result["sensitivities"] = sweeps
    assert [e.message for e in validator_for("result-1.0.schema.json").iter_errors(result)] == []
    margin = next(s for s in sweeps if s["parameter"] == "margin_pct")
    # default falls with margin; reinvestment rises because more cash is reinvested
    default, reinvestment = (
        values(margin, "el_default_shortfall"),
        values(margin, "el_reinvestment"),
    )
    assert all(b <= a + 1e-9 for a, b in zip(default, default[1:], strict=False))
    assert all(b >= a - 1e-9 for a, b in zip(reinvestment, reinvestment[1:], strict=False))
    assert reinvestment[-1] > reinvestment[0] > 0
    assert [t["value"] for t in margin["el"]] == pytest.approx(
        [d + r for d, r in zip(default, reinvestment, strict=True)]
    )
