"""Spec013 golden presenter sequence against the reviewed upstream SIM books."""

from __future__ import annotations

import unittest
from unittest.mock import patch
from uuid import uuid4

from inventory_optimizer_api.app import app
from inventory_optimizer_api.auth import require_service_auth
from inventory_optimizer_api.capabilities import engine_identity, manifest
from inventory_optimizer_api.showcase import catalog, run_book


class ShowcaseContract(unittest.TestCase):
    def test_auth_and_production_gate_apply_to_showcase_routes(self) -> None:
        from fastapi import HTTPException
        self.assertTrue(any(route.path == "/v1/showcase/runs" for route in app.routes))
        with patch.dict("os.environ", {"INVENTORY_OPTIMIZER_API_TOKEN": "test-token", "IBAL_ENV": "production", "IBAL_PRODUCTION_ENABLED": "false"}):
            with self.assertRaises(HTTPException) as gated:
                require_service_auth("Bearer test-token", str(uuid4()))
            self.assertEqual(gated.exception.status_code, 503)
        with patch.dict("os.environ", {"INVENTORY_OPTIMIZER_API_TOKEN": "test-token", "IBAL_ENV": "local"}):
            with self.assertRaises(HTTPException) as denied:
                require_service_auth("Bearer wrong", str(uuid4()))
            self.assertEqual(denied.exception.status_code, 401)

    def test_pin_catalog_and_no_governance_promotion(self) -> None:
        identity = engine_identity()
        self.assertTrue(identity["ready"])
        self.assertEqual(identity["engine_fingerprint"], manifest()["engine_fingerprint"])
        self.assertEqual(manifest()["engine_commit"], "a42dad30dc3ebb80d2790fd8701e621af0a35fcb")
        info = catalog()
        self.assertEqual(info["data_label"], "SIM")
        self.assertEqual(info["governance_gates_granted"], [])
        self.assertEqual([book["book_id"] for book in info["books"]], ["principal", "agency", "prime"])

    def test_verified_shock_repair_and_entity_presence(self) -> None:
        response = run_book("principal")
        report = response["report"]
        self.assertTrue(report["passed"])
        self.assertEqual(report["governance_gates_granted"], [])
        self.assertEqual([step["step"] for step in report["steps"]],
                         ["base", "shock", "diagnose", "repair", "compare"])
        artifacts = response["artifacts"]
        base, shock, repair = (artifacts[name] for name in
                               ("base_result", "shock_result", "repair_result"))
        self.assertTrue(all(item["verification"]["passed"] for item in (base, shock, repair)))
        self.assertLess(shock["economics"]["total_value_usd"], base["economics"]["total_value_usd"])
        self.assertGreater(repair["economics"]["total_value_usd"], shock["economics"]["total_value_usd"])
        base_supply = next(row for row in base["constraints"] if row["row"] == {"kind": "inventory_balance", "scope_id": "INV-AAA"})
        shock_supply = next(row for row in shock["constraints"] if row["row"] == {"kind": "inventory_balance", "scope_id": "INV-AAA"})
        self.assertEqual(base_supply["activity"], 100)
        self.assertEqual(shock_supply["activity"], 40)
        self.assertEqual(shock_supply["slack"], 0)
        shock_delta = artifacts["shock_comparison"]["driver_deltas"]
        self.assertTrue(any(item["entity_id"] == "SIM-AAA" and item["delta_shares"] == -60 for item in shock_delta))
        repair_delta = artifacts["repair_comparison"]["driver_deltas"]
        self.assertTrue(any(item["presence"] == "new" for item in repair_delta))
        self.assertTrue(any(item["presence"] == "matched" for item in repair_delta))

    def test_prime_failure_is_planned_and_never_a_recommendation(self) -> None:
        response = run_book("prime")
        report = response["report"]
        shock_step = next(item for item in report["steps"] if item["step"] == "shock")
        self.assertEqual(shock_step["outcome"], "planned_failure")
        shock = response["artifacts"]["shock_result"]
        self.assertEqual(shock["status"], "infeasible")
        self.assertFalse(shock["verification"]["passed"])
        self.assertFalse(shock["allocations"])
        diagnosis = response["artifacts"]["diagnosis"]
        self.assertFalse(diagnosis["feasible"])
        self.assertTrue(diagnosis["coverage"])
        self.assertTrue(diagnosis["excluded_sources"])
        self.assertTrue(response["artifacts"]["repair_result"]["verification"]["passed"])
        # Engine spec0020 (DIAG-003): hard client coverage is never relaxed, and the prime book has
        # no utilization limits, so the elastic diagnostic names the cause rather than a repair.
        explanation = diagnosis["infeasibility_explanation"]
        self.assertEqual(explanation["original_status"], "infeasible")
        self.assertEqual(explanation["outcome"], "no_relaxable_rows")
        self.assertEqual(explanation["relaxations"], [])

    def test_base_sensitivity_is_the_engines_own_ranging(self) -> None:
        """The principal base book is an LP (spec0020 DIAG-002). Route ALPHA on SIM-AAA (2.50%,
        lending 80) keeps the basis down to route BETA's coefficient (1.50%), below which BETA would
        take the shares, and has no upper limit: 10 x 0.025 / 360 within [10 x 0.015 / 360, +inf)."""
        response = run_book("principal")
        base = response["artifacts"]["base_result"]
        self.assertEqual(base["formulation"]["variant"], "lp")
        self.assertEqual(base["formulation"]["integer_variable_count"], 0)
        self.assertIsNone(base["sensitivity"])  # the guided steps solve without ranging
        sensitivity = response["artifacts"]["base_sensitivity"]
        self.assertTrue(sensitivity["available"])
        alpha = next(item for item in sensitivity["objective_coefficients"]
                     if item["variable"] == {"kind": "q", "scope_id": "RT-AAA-ALPHA"})
        self.assertAlmostEqual(alpha["value"], 80.0)
        self.assertAlmostEqual(alpha["coefficient"], 10 * 0.025 / 360)
        self.assertAlmostEqual(alpha["coefficient_lower"], 10 * 0.015 / 360)
        self.assertIsNone(alpha["coefficient_upper"])
        self.assertIsNotNone(base["model_statistics"])
        self.assertEqual(base["model_statistics"]["integer_variable_count"], 0)

    def test_unknown_book_is_refused(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unknown pinned showcase book"):
            run_book("main")


if __name__ == "__main__":
    unittest.main()
