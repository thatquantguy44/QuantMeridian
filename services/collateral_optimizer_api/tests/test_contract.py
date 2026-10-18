"""Native parity, ingress, tamper, identity and SIM acceptance checks."""

from __future__ import annotations

import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from collateral_optimizer.demo import SCENARIOS, apply_demo_scenario, build_demo_book
from collateral_optimizer.engine import optimize
from collateral_optimizer.domain import OptimizationResult, Snapshot
from collateral_optimizer_api.adapter import check_result
from collateral_optimizer_api.app import app
from collateral_optimizer_api.identity import check_binding, manifest

TOKEN = "contract-token"
FIXTURES = Path(__file__).resolve().parents[3] / "contracts/optimization/collateral"


class Contract(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        os.environ["COLLATERAL_OPTIMIZER_API_TOKEN"] = TOKEN
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                        base_url="http://collateral.test")

    async def asyncTearDown(self):
        await self.client.aclose()

    async def post(self, route, payload):
        return await self.client.post(route, headers={"authorization": "Bearer " + TOKEN},
                                      json=payload)

    def test_reviewed_binding_and_drift(self):
        self.assertEqual(check_binding()[0], "READY")
        with open(os.environ["COLLATERAL_BINDING_ATTESTATION"], encoding="utf-8") as file:
            original = json.load(file)
        for field, value in (("commit", "0" * 40), ("package_version", "9.9.9"),
                             ("wheel_sha256", "0" * 64), ("dependency_lock_sha256", "0" * 64)):
            altered = {**original, field: value}
            with tempfile.NamedTemporaryFile(mode="w", suffix=".json") as file:
                json.dump(altered, file)
                file.flush()
                with patch.dict(os.environ, {"COLLATERAL_BINDING_ATTESTATION": file.name}):
                    self.assertEqual(check_binding()[0], "INCOMPATIBLE", field)
                self.assertEqual(check_binding()[0], "READY", "restoring the old exact pin must restore readiness")
        self.assertRegex(manifest()["commit"], r"^[0-9a-f]{40}$")

    def test_checked_native_schemas_and_service_fixture(self):
        self.assertEqual(json.loads((FIXTURES / "snapshot-1.0.schema.json").read_text()),
                         Snapshot.model_json_schema())
        self.assertEqual(json.loads((FIXTURES / "result-1.0.schema.json").read_text()),
                         OptimizationResult.model_json_schema())
        baseline = json.loads((FIXTURES / "baseline.service.json").read_text())
        infeasible = json.loads((FIXTURES / "infeasible-stress.service.json").read_text())
        self.assertEqual(baseline["result"], optimize(build_demo_book()).model_dump(mode="json"))
        self.assertEqual(infeasible["result"],
                         optimize(apply_demo_scenario(build_demo_book(), "infeasible_stress")).model_dump(mode="json"))

    async def test_native_service_parity(self):
        snapshot = build_demo_book()
        direct = optimize(snapshot)
        response = await self.post("/v1/runs", {"source_mode": "SIM", "scenario_id": "baseline"})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["input_hash"], snapshot.canonical_hash())
        self.assertEqual(body["lifecycle_status"], "SUCCEEDED_VERIFIED")
        self.assertEqual(body["result"], direct.model_dump(mode="json"))
        self.assertTrue(body["adapter_verification"]["passed"])
        self.assertTrue(body["preview_only"])
        self.assertFalse(body["recommendation_eligible"])

    async def test_all_named_scenarios_repeat_and_suppress_invalid_savings(self):
        base = build_demo_book()
        for name in SCENARIOS:
            with self.subTest(name=name):
                snapshot = apply_demo_scenario(base, name)
                one = (await self.post("/v1/runs", {"source_mode": "SIM", "scenario_id": name})).json()
                two = (await self.post("/v1/runs", {"source_mode": "SIM", "scenario_id": name})).json()
                self.assertEqual(one["result"], two["result"])
                self.assertEqual(one["input_hash"], two["input_hash"])
                self.assertEqual(one["input_hash"], snapshot.canonical_hash())
                self.assertEqual(one["source_mode"], "SIM")
                if name != "baseline":
                    self.assertEqual(one["parent_hash"], base.canonical_hash())
                if name == "margin_spike":
                    self.assertIsNone(one["result"]["cost"]["savings_usd"])
                    self.assertIsNotNone(one["result"]["cost"]["total_usd"])
                if name == "liquidity_scarcity":
                    self.assertIn("reserve:liquidity", one["result"]["diagnostics"]["binding_constraints"])
                if name == "infeasible_stress":
                    self.assertEqual(one["lifecycle_status"], "INFEASIBLE")
                    self.assertFalse(one["result"]["allocations"])
                    self.assertIsNone(one["result"]["cost"])
                if one["result"]["formulation"] == "MIP":
                    self.assertEqual(one["result"]["diagnostics"]["lp_duals_usd_per_unit"], {})

    async def test_invalid_native_snapshot_has_no_successful_run(self):
        base = build_demo_book().model_dump(mode="json")
        cases = {}
        missing_fx = copy.deepcopy(base)
        missing_fx["fx"] = [q for q in missing_fx["fx"] if q["currency"] != "EUR"]
        cases["missing FX"] = missing_fx
        stale = copy.deepcopy(base)
        stale["assets"][0]["observed_at"] = "2026-10-14T00:00:00Z"
        cases["stale"] = stale
        agreement = copy.deepcopy(base)
        agreement["agreements"][0]["legal_entity"] = "UK"
        cases["wrong agreement entity"] = agreement
        overpledge = copy.deepcopy(base)
        overpledge["current_pledges"][0]["market_value"] = 999e6
        cases["overpledge"] = overpledge
        extra = copy.deepcopy(base)
        extra["assets"][0]["unreviewed_field"] = 1
        cases["extra field"] = extra
        wrong_entity = copy.deepcopy(base)
        wrong_entity["current_pledges"].append({"asset_id": "SIM-HELD-01-A",
                                                 "call_id": "EU-CSA-1", "market_value": 1})
        cases["wrong entity"] = wrong_entity
        wrong_currency = copy.deepcopy(base)
        wrong_currency["assets"][0]["currency"] = "EUR"
        cases["wrong currency"] = wrong_currency
        for label, snapshot in cases.items():
            with self.subTest(label=label):
                request = {"source_mode": "USER_UPLOAD", "snapshot": snapshot}
                for path in ("/v1/validate", "/v1/runs"):
                    response = await self.post(path, request)
                    self.assertEqual(response.status_code, 422)
                    body = response.json()
                    self.assertEqual(body["code"], "SNAPSHOT_INVALID")
                    self.assertTrue(body["issues"])
                    self.assertIn("location", body["issues"][0])

    def test_tamper_allocation_objective_components_and_flag(self):
        snapshot = build_demo_book()
        native = optimize(snapshot)
        self.assertEqual(check_result(snapshot, native)[1], ())
        cost = native.cost
        assert cost is not None
        tampered = [
            native.model_copy(update={"allocations": (native.allocations[0].model_copy(
                update={"market_value": native.allocations[0].market_value + 10e6}),) +
                                      native.allocations[1:]}),
            native.model_copy(update={"cost": cost.model_copy(update={"total_usd": cost.total_usd + 100})}),
            native.model_copy(update={"cost": cost.model_copy(update={"fixed_activation_usd": cost.fixed_activation_usd + 100})}),
            native.model_copy(update={"verified": False}),
        ]
        for candidate in tampered:
            with self.subTest(candidate=candidate):
                self.assertTrue(check_result(snapshot, candidate)[1])

    async def test_tampered_native_response_cannot_escape_adapter(self):
        snapshot = build_demo_book()
        native = optimize(snapshot)
        bad = native.model_copy(update={"cost": native.cost.model_copy(
            update={"total_usd": native.cost.total_usd + 1000})})
        with patch("collateral_optimizer_api.app.optimize", return_value=bad):
            response = await self.post("/v1/runs", {"source_mode": "SIM", "scenario_id": "baseline"})
        body = response.json()
        self.assertEqual(body["lifecycle_status"], "SUCCEEDED_UNVERIFIED")
        self.assertFalse(body["result"]["allocations"])
        self.assertIsNone(body["result"]["cost"])
        self.assertFalse(body["adapter_verification"]["passed"])

    async def test_production_auth_and_size_gates(self):
        denied = await self.post("/v1/runs", {"source_mode": "PRODUCTION_BOOK"})
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.json()["code"], "PRODUCTION_BOOK_DISABLED")
        unauth = await self.client.get("/v1/capabilities")
        self.assertEqual(unauth.status_code, 401)
        oversized = await self.client.post("/v1/validate",
            headers={"authorization": "Bearer " + TOKEN},
            content=b"x" * (2 * 1024 * 1024 + 1))
        self.assertEqual(oversized.status_code, 413)


if __name__ == "__main__":
    unittest.main()
