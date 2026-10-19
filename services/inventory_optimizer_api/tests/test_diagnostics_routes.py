"""Engine spec0020 diagnostics through the IBAL service (spec013 IBAL-004).

The dataset is the pinned engine's own principal showcase book (SIM), so every expected figure is
known by hand. SIM-AAA: 100 shares at USD 10, route ALPHA at 2.50% (cap 80) and route BETA at
1.50% (cap 60); the optimum lends ALPHA 80 and BETA 20.

* **Ranging.** BETA's fee can fall to 0 (below that lending on BETA loses money) and rise to
  ALPHA's 2.50% before the allocation changes: a local fee range of ``[0, 0.025]``.
* **Explain.** Add an 80% utilization cap on the pool and floors of 80 (ALPHA) and 10 (BETA):
  SIM-AAA must lend 90 but may lend 80, so the cap must move 10 shares, from 0.8 to 0.9.
"""

from __future__ import annotations

import pytest
from conftest import auth_headers
from inventory_optimizer.demo.manifest import load_book_request, load_manifest
from inventory_optimizer.domain.policies import UtilizationPolicy

from inventory_optimizer_api.contracts import SourceDisclosure
from inventory_optimizer_api.datasets import envelope_from_request

SOURCE = SourceDisclosure(mode="synthetic", label="SIM principal showcase book")


def _principal():
    book = next(item for item in load_manifest().books if item.book_id == "principal")
    return load_book_request(book)


def _dataset(request) -> dict:
    return envelope_from_request(request, source=SOURCE).model_dump(mode="json")


def _over_the_cap(request):
    policy = UtilizationPolicy(
        policy_id="UP-CORE",
        inventory_pool_id="POOL-CORE",
        effective_from=request.as_of,
        maximum_utilization=0.8,
        source="SIM-showcase",
        source_version="showcase-v1",
    )
    floors = {"RT-AAA-ALPHA": 80.0, "RT-AAA-BETA": 10.0}
    routes = tuple(
        route.model_copy(update={"hard_minimum_quantity_shares": floors.get(route.route_id, 0.0)})
        for route in request.routes
    )
    return request.model_copy(update={"utilization_policies": (policy,), "routes": routes})


def _run(api_client, run_config: dict) -> dict:
    response = api_client.post(
        "/v1/runs",
        json={"dataset": _dataset(_principal()), "run_config": run_config},
        headers=auth_headers(idempotency=True),
    )
    assert response.status_code == 200, response.text
    return response.json()["result"]


def test_ranging_is_opt_in_on_runs(api_client) -> None:
    plain = _run(api_client, {})
    assert plain["sensitivity"] is None and plain["mip_progress"] is None
    assert plain["model_statistics"]["integer_variable_count"] == 0
    assert set(plain["timings"]) == {"compile_seconds", "solve_seconds", "verify_seconds"}

    ranged = _run(api_client, {"ranging": True, "mip_progress": True})
    assert ranged["sensitivity"]["available"] is True
    beta = next(
        item
        for item in ranged["sensitivity"]["objective_coefficients"]
        if item["variable"] == {"kind": "q", "scope_id": "RT-AAA-BETA"}
    )
    assert beta["value"] == pytest.approx(20.0)
    assert beta["coefficient_lower"] == pytest.approx(0.0, abs=1e-12)
    assert beta["coefficient_upper"] == pytest.approx(10 * 0.025 / 360)
    # An LP has no MIP trace; the engine says why rather than returning an empty list.
    assert ranged["mip_progress"] == {
        "available": False,
        "unavailable_reason": "formulation_has_no_integer_variables",
        "points": [],
    }


def test_explain_names_the_limit_to_move(api_client) -> None:
    response = api_client.post(
        "/v1/explain",
        json={"dataset": _dataset(_over_the_cap(_principal()))},
        headers=auth_headers(),
    )
    assert response.status_code == 200, response.text
    explanation = response.json()["explanation"]
    assert explanation["original_status"] == "infeasible"
    assert explanation["outcome"] == "restorable"
    (relaxation,) = explanation["relaxations"]
    assert relaxation["inventory_id"] == "INV-AAA"
    assert relaxation["slack_shares"] == pytest.approx(10.0)
    assert relaxation["original_utilization"] == pytest.approx(0.8)
    assert relaxation["required_utilization"] == pytest.approx(0.9)
    assert explanation["relaxed_model_status"] == "optimal"


def test_explain_on_a_feasible_book_has_nothing_to_explain(api_client) -> None:
    response = api_client.post(
        "/v1/explain", json={"dataset": _dataset(_principal())}, headers=auth_headers()
    )
    assert response.status_code == 200
    assert response.json()["explanation"]["outcome"] == "original_is_feasible"


def test_sweep_local_range_matches_the_hand_derivation(api_client) -> None:
    response = api_client.post(
        "/v1/sweep",
        json={
            "dataset": _dataset(_principal()),
            "sweep": {"parameter": "route_fee_rate", "target_id": "RT-AAA-BETA", "mode": "local"},
        },
        headers=auth_headers(),
    )
    assert response.status_code == 200, response.text
    local = response.json()["sweep"]["local"]
    assert local["parameter_lower"] == pytest.approx(0.0, abs=1e-12)
    assert local["parameter_upper"] == pytest.approx(0.025)


def test_sweep_scenario_points_are_each_verified(api_client) -> None:
    response = api_client.post(
        "/v1/sweep",
        json={
            "dataset": _dataset(_principal()),
            "sweep": {
                "parameter": "route_fee_rate",
                "target_id": "RT-AAA-BETA",
                "values": [0.005, 0.03],
                "max_solves": 3,
            },
        },
        headers=auth_headers(),
    )
    assert response.status_code == 200, response.text
    sweep = response.json()["sweep"]
    assert sweep["solve_count"] == 3  # two values and the 1.5% baseline
    assert [round(point["value"], 6) for point in sweep["points"]] == [0.005, 0.015, 0.03]
    assert all(point["verification_passed"] for point in sweep["points"])
    # At 3% BETA beats ALPHA: it takes its 60-share cap and ALPHA keeps the other 40.
    top = {
        change["route_id"]: change["shares"] for change in sweep["points"][-1]["allocation_changes"]
    }
    assert top == {"RT-AAA-ALPHA": pytest.approx(40.0), "RT-AAA-BETA": pytest.approx(60.0)}


def test_a_sweep_the_engine_will_not_run_is_a_named_rejection(api_client) -> None:
    response = api_client.post(
        "/v1/sweep",
        json={
            "dataset": _dataset(_principal()),
            "sweep": {"parameter": "route_fee_rate", "target_id": "RT-AAA-BETA", "values": [2.0]},
        },
        headers=auth_headers(),
    )
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "SWEEP_REJECTED"
    assert "outside its domain" in body["issues"][0]["message"]


def test_the_contract_caps_a_sweep_before_the_engine_sees_it(api_client) -> None:
    response = api_client.post(
        "/v1/sweep",
        json={
            "dataset": _dataset(_principal()),
            "sweep": {"parameter": "route_fee_rate", "target_id": "RT-AAA-BETA", "max_solves": 26},
        },
        headers=auth_headers(),
    )
    assert response.status_code == 422


@pytest.mark.parametrize("path", ["/v1/explain", "/v1/sweep"])
def test_diagnostic_routes_require_auth(api_client, path) -> None:
    response = api_client.post(path, json={})
    assert response.status_code == 401
