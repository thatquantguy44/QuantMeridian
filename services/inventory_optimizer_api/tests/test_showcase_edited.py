"""Spec013 decision 3: a user-edited continuation of the guided showcase.

The principal book, SIM-AAA: 100 shares at USD 10, route ALPHA at 2.50% (cap 80) and route BETA at
1.50% (cap 60); the base optimum lends ALPHA 80 and BETA 20. Raise BETA's fee to 3.00% and BETA
outranks ALPHA: BETA takes its 60-share cap and ALPHA the other 40. Nothing else in the book
changes, so the objective moves by 10 x (60 x 0.03 + 40 x 0.025 - 20 x 0.015 - 80 x 0.025) / 360
= 10 x 0.5 / 360 USD.
"""

from __future__ import annotations

import copy

import pytest
from conftest import auth_headers

from inventory_optimizer_api.showcase import run_book

PATH = "/v1/showcase/edited-runs"


@pytest.fixture(scope="module")
def principal() -> dict:
    return run_book("principal")["artifacts"]


def _post(api_client, payload: dict):
    return api_client.post(PATH, json=payload, headers=auth_headers(idempotency=True))


def _with_route(request: dict, route_id: str, **fields) -> dict:
    edited = copy.deepcopy(request)
    for route in edited["routes"]:
        if route["route_id"] == route_id:
            route.update(fields)
    return edited


def test_the_guided_run_returns_the_requests_to_edit(principal) -> None:
    assert principal["base_request"]["request_id"]
    assert principal["repair_request"]["request_id"]
    repaired, base = principal["repair_request"], principal["base_request"]
    assert len(repaired["inventory"]) > len(base["inventory"])


def test_an_edit_is_solved_labelled_and_compared_like_the_repair(api_client, principal) -> None:
    edited = _with_route(principal["base_request"], "RT-AAA-BETA", fee_rate=0.03)
    response = _post(api_client, {"book_id": "principal", "request": edited})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["label"] == "user-edited" and body["data_label"] == "SIM"
    assert body["governance_gates_granted"] == []
    result = body["edited_result"]
    assert result["status"] == "optimal" and result["verification"]["passed"] is True
    shares = {item["route_id"]: item["post_quantity_shares"] for item in result["allocations"]}
    assert shares["RT-AAA-ALPHA"] == pytest.approx(40.0)
    assert shares["RT-AAA-BETA"] == pytest.approx(60.0)
    comparison = body["comparison"]
    assert comparison["scenario_id"] == "user-edited"
    assert comparison["objective_delta_usd"] == pytest.approx(10 * 0.5 / 360)
    assert body["comparison_skipped_reason"] is None


def test_an_edit_that_does_not_solve_is_shown_but_never_compared(api_client, principal) -> None:
    # Floors of 80 (ALPHA) and 30 (BETA) on a 100-share position cannot both be met.
    edited = _with_route(principal["base_request"], "RT-AAA-ALPHA", hard_minimum_quantity_shares=80)
    edited = _with_route(edited, "RT-AAA-BETA", hard_minimum_quantity_shares=30)
    response = _post(api_client, {"book_id": "principal", "request": edited})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["edited_result"]["status"] == "infeasible"
    assert body["comparison"] is None
    assert "only an optimal, verified run is compared" in body["comparison_skipped_reason"]


def test_a_request_the_engine_rejects_is_a_named_422(api_client, principal) -> None:
    edited = copy.deepcopy(principal["base_request"])
    del edited["routes"]
    response = _post(api_client, {"book_id": "principal", "request": edited})
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "SHOWCASE_EDIT_REJECTED"
    assert any("routes" in issue["message"] for issue in body["issues"])


@pytest.mark.parametrize(
    "payload, code",
    [
        ({"book_id": "main", "request": {}}, "SHOWCASE_BOOK_UNKNOWN"),
        ({"book_id": "principal"}, "SHOWCASE_EDIT_INVALID"),
        ({"book_id": "principal", "request": [], "extra": 1}, "SHOWCASE_EDIT_INVALID"),
    ],
)
def test_malformed_edits_are_refused(api_client, payload, code) -> None:
    response = _post(api_client, payload)
    assert response.status_code == 422
    assert response.json()["code"] == code


def test_an_unknown_book_is_refused(api_client, principal) -> None:
    response = _post(api_client, {"book_id": "main", "request": principal["base_request"]})
    assert response.status_code == 422
    assert response.json()["code"] == "SHOWCASE_BOOK_UNKNOWN"


def test_edited_runs_require_auth(api_client) -> None:
    assert api_client.post(PATH, json={}).status_code == 401
