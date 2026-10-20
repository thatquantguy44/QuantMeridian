"""Result and model-card assembly (spec020 IND-006, IND-008, IND-014, AC-005, AC-008)."""

import json
import math

import pytest
from conftest import CONTRACTS, cash_holding, loan, mini_snapshot

from indemnification_api import MODEL_VERSION
from indemnification_api.contracts import profile_hash, seal
from indemnification_api.engine import simulate
from indemnification_api.profile import resolve_all
from indemnification_api.results import build_result

CREATED = "2026-10-20T12:00:00Z"


@pytest.fixture(scope="module")
def sim_book():
    return json.loads((CONTRACTS / "fixtures" / "sim-book.example.json").read_text("utf-8"))


def run_book(book, **run):
    snap = seal({**book, "run": {**book["run"], **run}})
    return snap, build_result(snap, simulate(snap), created_at=CREATED)


@pytest.fixture(scope="module")
def desk(sim_book):
    return run_book(sim_book, paths=1000, preview=False)


def errors(validator, value):
    return [f"{'/'.join(map(str, e.path))}: {e.message}" for e in validator.iter_errors(value)]


def test_the_result_validates_against_the_schema(desk, validator_for):
    _, result = desk
    assert errors(validator_for("result-1.0.schema.json"), result) == []
    assert errors(validator_for("model-card-1.0.schema.json"), result["model_card"]) == []


def test_the_result_echoes_the_run_and_carries_the_model_card_facts(desk):
    snap, result = desk
    assert result["snapshot_hash"] == snap["snapshot_hash"] and result["created_at"] == CREATED
    assert result["run"] == {
        k: snap["run"][k] for k in ("mode", "seed", "paths", "preview", "horizon_days", "step")
    }
    card = result["model_card"]
    assert card["model_version"] == MODEL_VERSION and card["snapshot_hash"] == snap["snapshot_hash"]
    assert (
        card["profile_hash"] == profile_hash(snap["closeout_profile"])
        and card["profile_name"] == "default"
    )
    assert card["data_label"] == "SIM" == result["source"]
    assert "synthetic" in card["limitations"].lower()
    assert "not modelled" not in card["limitations"]  # the SIM book has a pool
    assert all(item["passed"] for item in card["validation"])
    assert {item["check"] for item in card["validation"]} >= {
        "snapshot schema, cross-field rules and hash",
        "conditional and sampled expected loss agree",
        "borrower Euler contributions sum to program expected shortfall",
    }


def test_the_run_id_is_deterministic_but_depends_on_the_run(sim_book):
    _, a = run_book(sim_book, paths=1000)
    _, b = run_book(sim_book, paths=1000)
    _, c = run_book(sim_book, paths=1000, seed=99)
    assert a == b and a["run_id"] == b["run_id"] != c["run_id"]


def test_every_position_has_effective_settings_with_sources(desk):
    snap, result = desk
    assert len(result["effective_settings"]) == len(resolve_all(snap))
    ids = {row["position_id"] for row in result["effective_settings"]}
    assert ids == {x["id"] for x in snap["loans"]} | {x["id"] for x in snap["collateral"]} | {
        x["id"] for x in snap["pool"]["positions"]
    }


def test_program_metrics_are_ordered_and_channels_add_up(desk):
    _, result = desk
    for variant in ("with_wrong_way", "without_wrong_way"):
        channels = result["program"]["gaussian"][variant]
        for metrics in channels.values():
            assert metrics["var999"]["value"] >= metrics["var99"]["value"] >= 0
            assert metrics["es99"]["value"] >= metrics["var99"]["value"]
            assert metrics["pfe99"]["value"] >= metrics["pfe95"]["value"] >= 0
        total, default, reinvestment = (
            channels[k]["el"]["value"] for k in ("total", "default_shortfall", "reinvestment")
        )
        assert total == pytest.approx(default + reinvestment)
        assert reinvestment > 0.0  # the SIM book has a pool and loans that come back
    assert result["program"]["student_t"] is not None


def test_borrower_euler_contributions_sum_to_the_program_total_expected_shortfall(desk):
    _, result = desk
    program_es = result["program"]["gaussian"]["with_wrong_way"]["total"]["es99"]["value"]
    parts = sum(b["euler_es99"]["value"] for b in result["borrowers"])
    assert parts == pytest.approx(program_es, rel=1e-9, abs=1e-9)


def test_borrower_channels_add_up_to_the_program_channels(desk):
    """AC-010: default plus reinvestment is the total, for the program and for every borrower."""
    _, result = desk
    channels = result["program"]["gaussian"]["with_wrong_way"]
    for name in ("el",):
        for part in ("default_shortfall", "reinvestment"):
            assert sum(
                b["metrics"]["with_wrong_way"][part][name]["value"] for b in result["borrowers"]
            ) == pytest.approx(channels[part][name]["value"], rel=1e-9)
    for b in result["borrowers"]:
        m = b["metrics"]["with_wrong_way"]
        assert m["total"]["el"]["value"] == pytest.approx(
            m["default_shortfall"]["el"]["value"] + m["reinvestment"]["el"]["value"]
        )
    assert result["owners"] and sum(
        o["el"]["reinvestment"]["value"] for o in result["owners"]
    ) == pytest.approx(channels["reinvestment"]["el"]["value"], rel=1e-9)


def test_a_snapshot_without_a_pool_says_the_reinvestment_channel_is_not_modelled(snapshot):
    snap = mini_snapshot(
        snapshot, loans=[loan(quantity=1000)], collateral=[cash_holding(amount=102_000.0)]
    )
    snap["run"] = {**snap["run"], "paths": 1000}
    snap = seal(snap)
    result = build_result(snap, simulate(snap), created_at=CREATED)
    assert "reinvestment channel is not modelled" in result["model_card"]["limitations"]
    assert result["program"]["gaussian"]["with_wrong_way"]["reinvestment"]["el"]["value"] == 0.0


def test_owner_losses_add_up_to_the_program_default_loss(desk):
    snap, result = desk
    assert {o["owner_id"] for o in result["owners"]} == {o["id"] for o in snap["owners"]}
    program_el = result["program"]["gaussian"]["with_wrong_way"]["default_shortfall"]["el"]["value"]
    assert sum(o["el"]["default_shortfall"]["value"] for o in result["owners"]) == pytest.approx(
        program_el, rel=1e-9
    )
    for o in result["owners"]:
        assert o["el"]["total"]["value"] == pytest.approx(
            o["el"]["default_shortfall"]["value"] + o["el"]["reinvestment"]["value"]
        )


def test_borrowers_report_their_credit_source_and_probabilities(desk):
    snap, result = desk
    assert [b["borrower_id"] for b in result["borrowers"]] == sorted(
        b["id"] for b in snap["borrowers"]
    )
    for b in result["borrowers"]:
        assert b["credit_source"] == "RATING_TABLE" and 0 < b["pd_1y"] < 1 and b["hazard"] > 0
        assert b["pd_1y"] == pytest.approx(-math.expm1(-b["hazard"]))
        assert b["pricing"] is None  # pricing is IND-T12


def test_a_user_spread_is_labelled_in_the_result(sim_book):
    book = json.loads(json.dumps(sim_book))
    book["borrowers"][0].update(spread_bps=240.0, recovery=0.4, credit_provenance="user_input")
    snap = seal({**book, "run": {**book["run"], "paths": 1000}})
    result = build_result(snap, simulate(snap), created_at=CREATED)
    by_id = {b["borrower_id"]: b for b in result["borrowers"]}
    first = book["borrowers"][0]["id"]
    assert by_id[first]["credit_source"] == "USER_SPREAD" and by_id[first][
        "hazard"
    ] == pytest.approx(0.04)


def test_the_exposure_profile_starts_at_zero_and_is_ordered(desk):
    _, result = desk
    p = result["exposure_profile"]
    assert (
        p["times_days"] == list(range(22)) and p["ee"][0] == p["pfe95"][0] == p["pfe99"][0] == 0.0
    )
    assert all(b >= a - 1e-9 for a, b in zip(p["pfe95"], p["pfe99"], strict=True))
    assert max(p["pfe99"]) > 0


def test_a_run_without_the_student_t_variant_reports_null(sim_book):
    book = json.loads(json.dumps(sim_book))
    book["model"]["student_t_enabled"] = False
    snap = seal({**book, "run": {**book["run"], "paths": 1000}})
    assert build_result(snap, simulate(snap), created_at=CREATED)["program"]["student_t"] is None


def test_convergence_is_checked_when_there_are_at_least_two_chunks(sim_book):
    _, one = run_book(sim_book, paths=3000)
    assert one["model_card"]["convergence"] == {
        "checked": False,
        "max_shift_in_standard_errors": None,
        "passed": None,
    }
    _, many = run_book(sim_book, paths=10_000)
    c = many["model_card"]["convergence"]
    assert (
        c["checked"] is True
        and c["max_shift_in_standard_errors"] >= 0
        and c["passed"] is (c["max_shift_in_standard_errors"] < 2)
    )


def test_a_preview_run_says_so_and_is_not_presented_as_a_reported_figure(sim_book):
    _, preview = run_book(sim_book, paths=1000, preview=True)
    _, reported = run_book(sim_book, paths=1000, preview=False)
    assert "preview" in preview["model_card"]["limitations"].lower()
    assert "preview" not in reported["model_card"]["limitations"].lower()
    assert preview["model_card"]["preview"] is True and reported["model_card"]["preview"] is False


def test_the_placeholders_for_later_tasks_are_present_and_valid(desk):
    _, result = desk
    assert result["sensitivities"] == [] and result["stresses"] == []
    assert result["cross_check"]["label"]


def test_a_failed_estimator_agreement_check_is_reported_not_hidden(snapshot):
    # A CCC borrower defaults often enough for the check to have power (the SIM book's one-month
    # investment-grade defaults are too rare for the sampled estimator to say anything).
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
    snap = mini_snapshot(
        snapshot,
        loans=[loan(quantity=1000)],
        collateral=[cash_holding(amount=102_000.0)],
        borrowers=borrowers,
    )
    snap["run"] = {**snap["run"], "paths": 20_000}
    snap = seal(snap)
    out = simulate(snap)
    honest = build_result(snap, out, created_at=CREATED)["model_card"]["validation"]
    assert next(i for i in honest if i["check"] == "conditional and sampled expected loss agree")[
        "passed"
    ]
    out.variants["gaussian_ww"].cond[:] *= 100.0  # corrupt the conditional estimator
    corrupted = build_result(snap, out, created_at=CREATED)["model_card"]["validation"]
    assert not next(
        i for i in corrupted if i["check"] == "conditional and sampled expected loss agree"
    )["passed"]


def test_a_mini_book_with_a_cash_loan_also_builds(snapshot, validator_for):
    snap = mini_snapshot(
        snapshot, loans=[loan(quantity=1000)], collateral=[cash_holding(amount=102_000.0)]
    )
    snap["run"] = {**snap["run"], "paths": 1000}
    snap = seal(snap)
    result = build_result(snap, simulate(snap), created_at=CREATED)
    assert errors(validator_for("result-1.0.schema.json"), result) == []


def test_the_basel_cross_check_sits_beside_each_borrowers_monte_carlo_pfe(desk):
    snap, result = desk
    rows = result["cross_check"]["borrowers"]
    assert [r["borrower_id"] for r in rows] == [b["borrower_id"] for b in result["borrowers"]]
    by_id = {b["borrower_id"]: b for b in result["borrowers"]}
    for r in rows:
        assert r["e_star"] >= 0 and r["exposure"] > 0 and r["collateral"] > 0
        mc = by_id[r["borrower_id"]]["metrics"]["with_wrong_way"]["default_shortfall"]["pfe99"][
            "value"
        ]
        assert r["mc_pfe99"] == mc
    assert "illustrative" in result["cross_check"]["label"].lower()
    assert "not regulatory capital" in result["cross_check"]["label"]
