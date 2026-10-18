"""Hand-computable execution and scenario contracts for spec011 MM-006/007."""

from __future__ import annotations

import copy
import unittest
from unittest.mock import patch
from uuid import uuid4

import numpy as np

from money_market_api.app import _model_binding, create_run
from money_market_api.contracts import OptimizeRequest
from money_market_api.optimizer import ModelSolveError
from money_market_api.scenarios import solve_scenario_request
from optimization_core import HighsBackend, SparseProblemBuilder, verify_solution
from optimization_core.model import LinearSolution


def book() -> dict:
    days = ["2026-10-19", "2026-10-20", "2026-10-21"]
    def candidate(name: str, rate: str, cutoff: str) -> dict:
        return {
            "candidate_id": name, "rate_instrument_id": rate,
            "instrument_type": "treasury_bill", "currency": "USD", "issuer_id": "UST",
            "counterparty_id": None, "rating": "AAA", "settlement_date": days[0],
            "maturity_date": days[-1], "cutoff_at": cutoff,
            "minimum_ticket_amount": 30, "lot_size_amount": 10,
            "maximum_amount": None, "explicit_cost_bps": 0,
        }
    def rate(name: str, yield_pct: float) -> dict:
        return {
            "instrument_id": name, "quoted_rate_pct": yield_pct,
            "quoted_basis": "money_market", "mm_yield_pct": yield_pct,
            "observation_date": "2026-10-16", "status": "ok",
        }
    return {
        "request_id": str(uuid4()),
        "rate_snapshot": {"source": "sim", "sim_set_id": "TEST", "as_of_date": "2026-10-16",
                          "snapshot_hash": "a" * 64, "rows": [rate("FAST", 3.65), rate("LATE", 3.0)]},
        "horizon": {"start_date": days[0], "end_date": days[-1], "period_dates": days},
        "cash_forecast": [
            {"period_date": day, "legal_entity_id": "E1", "account_id": "A1",
             "currency": "USD", "opening_cash": 100, "known_net_flow": 0,
             "estimated_residual_p10": -10, "estimated_residual_p50": 0,
             "estimated_residual_p90": 10} for day in days
        ],
        "instrument_candidates": [
            candidate("FAST-BILL", "FAST", "2026-10-19T11:00:00-04:00"),
            candidate("LATE-BILL", "LATE", "2026-10-19T15:00:00-04:00"),
        ],
        "policy": {
            "policy_id": "TEST", "cash_forecast_case": "p50", "objective_currency": None,
            "daily_liquidity_floors": [{"period_date": days[0], "legal_entity_id": "E1",
                                        "currency": "USD", "minimum_cash": 35}],
            "weekly_liquidity_floors": [], "maximum_wam_days": None,
            "maximum_wal_days": None, "maximum_ticket_count": 1,
            "exposure_limits": [], "execution_mode": "ticketed_plan",
            "decision_at": "2026-10-19T09:00:00-04:00",
            "frontier_multipliers": [0.8, 1.0, 1.2],
        },
    }


def solve(data: dict) -> tuple[dict, dict]:
    result = solve_scenario_request(OptimizeRequest.model_validate(data))
    return result, result["currency_results"][0]


class ExecutionContracts(unittest.TestCase):
    def test_identical_snapshot_and_request_reproduce_non_timing_outputs(self) -> None:
        payload = book()
        first, _ = solve(payload)
        second, _ = solve(payload)
        self.assertEqual(first, second)

    def test_lp_shadow_price_rhs_sign_and_preview_disclosure(self) -> None:
        builder = SparseProblemBuilder(objective_sense="maximize")
        buy = builder.add_variable("buy", objective=2)
        cash = builder.add_variable("cash")
        builder.add_row("balance", {buy: 1, cash: 1}, lower=100, upper=100)
        builder.add_row("floor", {cash: 1}, lower=35)
        linear = HighsBackend().solve(builder.build())
        self.assertEqual(linear.primal.tolist(), [65, 35])
        self.assertEqual(linear.row_marginals[1], ("lower", -2.0))
        preview = book()
        preview["policy"]["execution_mode"] = "continuous_preview"
        preview["policy"]["frontier_multipliers"] = []
        result, currency = solve(preview)
        self.assertFalse(result["execution_ready"])
        self.assertEqual(currency["blotter"], [])
        self.assertTrue(all(price["convention"] == "LP_LOCAL" for price in currency["shadow_prices"]))

    def test_run_boundary_requires_execution_binding_and_serializes_verified_plan(self) -> None:
        import asyncio
        with patch.dict("os.environ", {"MONEY_MARKET_MODEL_BINDING": "local-mmkt-lp-v1"}):
            self.assertEqual(_model_binding(), "local-mmkt-lp-v1")
            blocked = asyncio.run(create_run(OptimizeRequest.model_validate(book()), uuid4(), "test-execution-1"))
            self.assertEqual(blocked.status_code, 501)
        with patch.dict("os.environ", {"MONEY_MARKET_MODEL_BINDING": "local-mmkt-execution-v2"}):
            accepted = asyncio.run(create_run(OptimizeRequest.model_validate(book()), uuid4(), "test-execution-2"))
            response = accepted.model_dump(mode="json")
            self.assertTrue(response["execution_ready"])
            self.assertTrue(response["currency_results"][0]["verification"]["passed"])
            self.assertEqual(response["currency_results"][0]["blotter"][0]["candidate_id"], "FAST-BILL")

    def test_ticket_lots_count_cutoff_and_frontier(self) -> None:
        result, usd = solve(book())
        self.assertEqual(result["model_family"], "ticketed_mip")
        self.assertTrue(result["execution_ready"])
        self.assertTrue(usd["verification"]["passed"])
        self.assertLessEqual(usd["verification"]["max_integrality_violation"], 1e-7)
        self.assertEqual([(line["candidate_id"], line["amount"]) for line in usd["blotter"]],
                         [("FAST-BILL", 60)])
        self.assertAlmostEqual(usd["objective_value"], 60 * 0.0365 * 2 / 365)
        self.assertEqual(usd["cutoff_timeline"][0]["status"], "planned")
        self.assertEqual(len({p["input_hash"] for p in usd["frontier"]}), 3)
        self.assertTrue(all(p["status"] == "optimal_verified" for p in usd["frontier"]))
        self.assertGreater(usd["frontier"][0]["objective_value"], usd["frontier"][2]["objective_value"])
        self.assertTrue(all(p["convention"] == "FIXED_INTEGER_LP" for p in usd["shadow_prices"]))

    def test_rate_cut_forecast_miss_and_missed_cutoff_change_plan(self) -> None:
        base = book()
        _, original = solve(base)
        rate_cut = copy.deepcopy(base)
        rate_cut["rate_snapshot"]["rows"][0]["mm_yield_pct"] = 2.0
        _, cut = solve(rate_cut)
        self.assertEqual(cut["blotter"][0]["candidate_id"], "LATE-BILL")
        self.assertLess(cut["objective_value"], original["objective_value"])

        miss = copy.deepcopy(base)
        miss["policy"]["cash_forecast_case"] = "p10"
        _, downside = solve(miss)
        self.assertEqual(downside["blotter"][0]["amount"], 50)
        self.assertLess(downside["objective_value"], original["objective_value"])

        late = copy.deepcopy(base)
        late["policy"]["decision_at"] = "2026-10-19T12:00:00-04:00"
        _, after_cutoff = solve(late)
        self.assertEqual(after_cutoff["blotter"][0]["candidate_id"], "LATE-BILL")
        self.assertEqual(after_cutoff["cutoff_timeline"][0]["status"], "missed")

    def test_infeasible_run_cannot_produce_blotter(self) -> None:
        data = book()
        data["policy"]["daily_liquidity_floors"][0]["minimum_cash"] = 150
        with self.assertRaises(ModelSolveError) as raised:
            solve(data)
        self.assertEqual(raised.exception.status, "infeasible")

    def test_shared_verifier_rejects_fractional_integer_solution(self) -> None:
        builder = SparseProblemBuilder(objective_sense="maximize")
        ticket = builder.add_variable("ticket", upper=1, integer=True)
        builder.add_row("limit", {ticket: 1}, upper=1)
        problem = builder.build()
        solution = LinearSolution(status="optimal", primal=np.array([0.5]),
                                  objective_value=0, message="tampered", backend="test",
                                  backend_version="0")
        report = verify_solution(problem, solution)
        self.assertFalse(report.passed)
        self.assertEqual(report.max_integrality_violation, 0.5)
        self.assertTrue(verify_solution(problem, HighsBackend().solve(problem)).passed)


if __name__ == "__main__":
    unittest.main()
