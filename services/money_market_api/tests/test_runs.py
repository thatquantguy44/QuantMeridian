"""Service-level checks for the MMKT continuous LP (run with pytest from the service dir)."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from money_market_api.app import app

HASH = "a" * 64


def headers(*, idempotency: bool = False) -> dict[str, str]:
    out = {"Authorization": "Bearer test-token", "X-Correlation-ID": str(uuid4())}
    if idempotency:
        out["Idempotency-Key"] = str(uuid4())
    return out


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("MONEY_MARKET_API_TOKEN", "test-token")
    monkeypatch.setenv("MONEY_MARKET_MODEL_BINDING", "local-mmkt-lp-v1")
    return TestClient(app)


def candidate(candidate_id: str, *, maximum: float | None, settle: str = "2026-10-19",
              mature: str = "2026-10-21", rating: str | None = "AAA") -> dict[str, Any]:
    return {
        "candidate_id": candidate_id,
        "rate_instrument_id": "R1",
        "instrument_type": "treasury_bill",
        "currency": "USD",
        "issuer_id": "UST",
        "counterparty_id": None,
        "rating": rating,
        "settlement_date": settle,
        "maturity_date": mature,
        "cutoff_at": None,
        "minimum_ticket_amount": 0,
        "lot_size_amount": 1,
        "maximum_amount": maximum,
        "explicit_cost_bps": 0,
    }


def request(candidates: list[dict[str, Any]], *, floor: float = 0.0) -> dict[str, Any]:
    days = ["2026-10-19", "2026-10-20", "2026-10-21"]
    return {
        "request_id": str(uuid4()),
        "rate_snapshot": {
            "source": "sim",
            "sim_set_id": "TEST",
            "as_of_date": "2026-10-16",
            "snapshot_hash": HASH,
            "rows": [{
                "instrument_id": "R1", "quoted_rate_pct": 3.65, "quoted_basis": "bond_equivalent",
                "mm_yield_pct": 3.65, "observation_date": "2026-10-16", "staleness_days": 0,
                "status": "ok", "status_detail": None,
            }],
        },
        "horizon": {"start_date": days[0], "end_date": days[-1], "period_dates": days},
        "cash_forecast": [
            {
                "period_date": day, "legal_entity_id": "E1", "account_id": "A1", "currency": "USD",
                "opening_cash": 100.0, "known_net_flow": 0.0, "estimated_residual_p10": -5.0,
                "estimated_residual_p50": 0.0, "estimated_residual_p90": 5.0,
            }
            for day in days
        ],
        "instrument_candidates": candidates,
        "policy": {
            "policy_id": "TEST",
            "cash_forecast_case": "p50",
            "objective_currency": None,
            "daily_liquidity_floors": [
                {"period_date": days[0], "legal_entity_id": "E1", "currency": "USD", "minimum_cash": floor}
            ] if floor else [],
            "weekly_liquidity_floors": [],
            "maximum_wam_days": None,
            "maximum_wal_days": None,
            "maximum_ticket_count": None,
            "exposure_limits": [],
        },
    }


def test_capabilities_resolve_manifest_when_run_from_source(client: TestClient) -> None:
    response = client.get("/v1/capabilities", headers=headers())
    assert response.status_code == 200
    assert response.json()["binding_id"] == "local-mmkt-lp-v1"


def test_null_maximum_amount_means_uncapped(client: TestClient) -> None:
    response = client.post("/v1/runs", json=request([candidate("BILL", maximum=None)]), headers=headers(idempotency=True))
    assert response.status_code == 200, response.text
    allocations = response.json()["currency_results"][0]["allocations"]
    assert sum(line["amount"] for line in allocations) == pytest.approx(100.0, abs=1e-6)


def test_hand_computable_floor_and_return(client: TestClient) -> None:
    # 100 of cash, a 30 floor on day 1 only, one bill maturing on day 3 at 3.65% (ACT/365):
    # 70 is invested on day 1 (2 days) and the other 30 on day 2 once the floor lapses (1 day):
    # (70 x 2 + 30 x 1) x 3.65% / 365 = 0.017.
    response = client.post(
        "/v1/runs", json=request([candidate("BILL", maximum=None)], floor=30.0), headers=headers(idempotency=True)
    )
    assert response.status_code == 200, response.text
    result = response.json()["currency_results"][0]
    assert result["objective_value"] == pytest.approx((70 * 2 + 30 * 1) * 0.0365 / 365, rel=1e-9)
    day_one = [line for line in result["allocations"] if line["purchase_date"] == "2026-10-19"]
    assert sum(line["amount"] for line in day_one) == pytest.approx(70.0, abs=1e-6)
    day_two = [line for line in result["allocations"] if line["purchase_date"] == "2026-10-20"]
    assert sum(line["amount"] for line in day_two) == pytest.approx(30.0, abs=1e-6)
    assert result["verification"]["passed"] is True


def test_rating_floor_excludes_candidate(client: TestClient) -> None:
    body = request([candidate("LOW", maximum=None, rating="BBB")])
    body["policy"]["exposure_limits"] = [{
        "dimension": "rating", "key": "portfolio", "currency": "USD",
        "maximum_amount": None, "maximum_portfolio_fraction": None, "minimum_rating": "A-",
    }]
    response = client.post("/v1/runs", json=body, headers=headers(idempotency=True))
    assert response.status_code == 200, response.text
    assert response.json()["currency_results"][0]["allocations"] == []
