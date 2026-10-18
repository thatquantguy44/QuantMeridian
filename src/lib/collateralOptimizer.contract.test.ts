import { describe, expect, it } from "vitest";
import { buildCollateralRunExport, changedSnapshotFields, comparableCollateralRuns, isCollateralRun,
  type CollateralRun, type CollateralSnapshot } from "./collateralOptimizer";
import baselineFixture from "../../contracts/optimization/collateral/baseline.service.json";
import infeasibleFixture from "../../contracts/optimization/collateral/infeasible-stress.service.json";

const snapshot: CollateralSnapshot = {
  schema_version: "1.0", book_id: "SIM-BOOK", source: "SIM", as_of: "2026-10-15T10:00:00Z",
  horizon_days: 30, minimum_liquidity_reserve_usd: 10,
  fx: [{ currency: "USD", usd_per_unit: 1, observed_at: "2026-10-15T09:55:00Z" }],
  assets: [], calls: [], agreements: [], current_pledges: []
};
const run: CollateralRun = {
  api_schema_version: "1.0.0", run_id: "one", correlation_id: "test-correlation",
  idempotency_key: null, raw_payload_sha256: "a".repeat(64),
  lifecycle_status: "SUCCEEDED_VERIFIED",
  preview_only: true, recommendation_eligible: false, source_mode: "SIM",
  native_source: "SIM", input_hash: "hash-a", parent_hash: null, scenario_id: "baseline",
  model_commit: "eb74850a0f972ca9e1f40558ecd7909d3e76e6b3", package_version: "0.1.0",
  adapter_version: "0.1.0", snapshot_schema_version: "1.0", result_schema_version: "1.0",
  wheel_sha256: "wheel", as_of: snapshot.as_of, input_age_minutes: 5, snapshot,
  result: { status: "optimal", verified: true, formulation: "LP", input_hash: "hash-a",
    source: "SIM", engine_version: "0.1.0", allocations: [], movements: [], coverage: [],
    residual_liquidity_usd: 10, cost: { carry_usd: 1, variable_move_usd: 0,
      fixed_activation_usd: 0, total_usd: 1, current_cost_usd: 2, savings_usd: 1 },
    diagnostics: { binding_constraints: [], call_shortfall_usd: {},
      incumbent_violations: [], verification_errors: [], lp_duals_usd_per_unit: {},
      solver_status: "optimal", message: "ok" } },
  adapter_verification: { passed: true, errors: [], reconstructed_cost_usd: 1 }
};

describe("collateral terminal result contract", () => {
  it("accepts Python service fixtures for both verified and infeasible states", () => {
    expect(isCollateralRun(baselineFixture)).toBe(true);
    expect(isCollateralRun(infeasibleFixture)).toBe(true);
    expect(baselineFixture.result.cost?.savings_usd).toBeGreaterThan(0);
    expect(infeasibleFixture.result.cost).toBeNull();
  });
  it("accepts a verified native result and rejects a forged approval", () => {
    expect(isCollateralRun(run)).toBe(true);
    expect(isCollateralRun({ ...run, adapter_verification: { ...run.adapter_verification, passed: false } })).toBe(false);
    expect(isCollateralRun({ ...run, result: { ...run.result, input_hash: "other" } })).toBe(false);
    expect(isCollateralRun({ ...run, recommendation_eligible: true })).toBe(false);
  });
  it("allows only a stripped infeasible result", () => {
    const empty = { ...run, lifecycle_status: "INFEASIBLE", result: { ...run.result,
      status: "infeasible", verified: false, cost: null },
      adapter_verification: { passed: false, errors: [], reconstructed_cost_usd: null } };
    expect(isCollateralRun(empty)).toBe(true);
    expect(isCollateralRun({ ...empty, result: { ...empty.result, allocations: [{ asset_id: "fake" }] } })).toBe(false);
  });
  it("flags snapshot and version drift before a causal savings claim", () => {
    expect(comparableCollateralRuns(run, run)).toBe(true);
    const variant = { ...run, input_hash: "hash-b",
      snapshot: { ...snapshot, minimum_liquidity_reserve_usd: 12 } };
    expect(changedSnapshotFields(snapshot, variant.snapshot)).toEqual(["minimum_liquidity_reserve_usd"]);
    expect(comparableCollateralRuns(run, variant)).toBe(false);
    expect(comparableCollateralRuns(run, { ...run, model_commit: "another" })).toBe(false);
  });
  it("exports verified and infeasible service runs with complete lineage and no invented target", () => {
    if (!isCollateralRun(baselineFixture) || !isCollateralRun(infeasibleFixture))
      throw Error("Pinned Python fixtures are incompatible with the terminal contract.");
    const baselineExport = buildCollateralRunExport(baselineFixture);
    expect(baselineExport.classification).toBe("LOCAL_MODEL_PREVIEW");
    expect(baselineExport.recommendation_eligible).toBe(false);
    expect(baselineExport.provenance).toMatchObject({
      run_id: baselineFixture.run_id,
      correlation_id: baselineFixture.correlation_id,
      raw_payload_sha256: baselineFixture.raw_payload_sha256,
      source_mode: "SIM", native_source: baselineFixture.native_source,
      input_hash: baselineFixture.input_hash, parent_hash: baselineFixture.parent_hash,
      model_commit: baselineFixture.model_commit, wheel_sha256: baselineFixture.wheel_sha256,
      result_schema_version: "1.0", adapter_verified: true
    });
    expect(baselineExport.units).toEqual({ cost_currency: "USD", horizon_days: 30,
      snapshot_values: "native currency per asset or call" });
    expect(JSON.parse(JSON.stringify(baselineExport)).run).toEqual(baselineFixture);

    const infeasibleExport = buildCollateralRunExport(infeasibleFixture);
    expect(infeasibleExport.provenance.lifecycle_status).toBe("INFEASIBLE");
    expect(infeasibleExport.provenance.adapter_verified).toBe(false);
    expect(infeasibleExport.run.result.allocations).toEqual([]);
    expect(infeasibleExport.run.result.cost).toBeNull();
    expect(() => buildCollateralRunExport({ ...run, recommendation_eligible: true } as unknown as CollateralRun))
      .toThrow("export blocked");
  });
});
