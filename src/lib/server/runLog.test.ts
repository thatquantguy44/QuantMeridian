import { afterEach, describe, expect, it } from "vitest";
import {
  RUN_LOG_CAPACITY,
  clearRunLog,
  collateralLogEntry,
  ibalLogEntry,
  ibalRunKind,
  listRuns,
  mmktLogEntry,
  recordRun,
} from "./runLog";

const HASH = "a".repeat(64);

describe("OPT session run log", () => {
  afterEach(() => clearRunLog());

  it("logs IBAL model runs only, not diagnostics or reads", () => {
    expect(ibalRunKind("/v1/runs")).toBe("run");
    expect(ibalRunKind("/v1/scenarios/stress-test")).toBe("stress");
    expect(ibalRunKind("/v1/showcase/runs")).toBe("showcase");
    for (const path of ["/v1/explain", "/v1/sweep", "/v1/validate", "/health", "/v1/capabilities"]) expect(ibalRunKind(path)).toBeNull();
  });

  it("takes an IBAL run's status, verification and solve time from the service and keeps no values", () => {
    const entry = ibalLogEntry("run", 200, {
      source: { mode: "synthetic", label: "Synthetic book", seed: 1701 },
      request_hash: HASH,
      result: {
        run_id: "inv-opt-1", status: "optimal", input_hash: HASH, package_version: "0.1.0",
        verification: { passed: true }, timings: { compile_seconds: 0.002, solve_seconds: 0.00145, verify_seconds: 0.0001 },
        solver: { runtime_seconds: 0.9 }, economics: { total_value_usd: 123.45 }, allocations: [{ route_id: "R" }],
      },
    }, null, 12.6);
    expect(entry).toMatchObject({
      model: "IBAL", kind: "run", http_status: 200, run_id: "inv-opt-1", status: "optimal", verified: true,
      solve_ms: 1.45, round_trip_ms: 13, source: "synthetic", input_hash: HASH, model_version: "0.1.0",
    });
    expect(JSON.stringify(entry)).not.toMatch(/123\.45|allocations|route_id/);
  });

  it("falls back to the solver runtime when an older engine reports no phase timings", () => {
    const entry = ibalLogEntry("run", 200, { result: { run_id: "r", status: "infeasible", verification: { passed: false }, solver: { runtime_seconds: 0.25 } } }, null, 1);
    expect(entry).toMatchObject({ status: "infeasible", verified: false, solve_ms: 250 });
  });

  it("summarises an IBAL stress batch and a showcase run without inventing a status", () => {
    expect(ibalLogEntry("stress", 200, {
      request_hash: HASH, baseline_run_id: "inv-opt-1", scenario_type: "recall_wave", source: { mode: "upload" },
      stress_report: { scenario_count: 3, feasible_count: 2, infeasible_count: 1, verification_failed_count: 0 },
    }, null, 5)).toMatchObject({ run_id: "inv-opt-1 · recall_wave", status: "2/3 feasible", verified: true, source: "upload" });
    expect(ibalLogEntry("showcase", 200, { data_label: "SIM", engine_commit: "a42dad3", report: { passed: true } }, { book_id: "prime" }, 5))
      .toMatchObject({ run_id: "showcase:prime", status: "passed", verified: true, source: "SIM", model_version: "a42dad3" });
    expect(ibalLogEntry("showcase", 200, {}, null, 5)).toMatchObject({ run_id: null, status: "unknown", verified: null });
  });

  it("keeps a failed run's own error code and claims no verification", () => {
    expect(ibalLogEntry("run", 422, { source: "ERR", code: "DATASET_INVALID" }, null, 3))
      .toMatchObject({ http_status: 422, status: "DATASET_INVALID", verified: null, run_id: null });
    expect(mmktLogEntry(503, "not json", 3)).toMatchObject({ status: "HTTP_503", verified: null });
  });

  it("reads MMKT and COLL runs from their own contracts", () => {
    expect(mmktLogEntry(200, {
      run: { run_id: "mm-1", status: "optimal_verified", request_hash: HASH, rate_source: "sim", sim_set_id: "SIM-MMKT-2026-10-BASE", model_family: "continuous_lp_relaxation" },
      currency_results: [{ verification: { passed: true } }, { verification: { passed: true } }],
    }, 40)).toMatchObject({ model: "MMKT", run_id: "mm-1", status: "optimal_verified", verified: true, source: "sim:SIM-MMKT-2026-10-BASE", model_version: "continuous_lp_relaxation" });
    expect(mmktLogEntry(200, { run: { run_id: "mm-2", status: "optimal_verified", rate_source: "gold" }, currency_results: [] }, 1))
      .toMatchObject({ verified: null, source: "gold" });
    expect(collateralLogEntry(200, {
      run_id: "coll-1", lifecycle_status: "SUCCEEDED_VERIFIED", adapter_verification: { passed: true }, source_mode: "SIM", input_hash: HASH, model_commit: "c0ffee",
    }, 9)).toMatchObject({ model: "COLL", status: "SUCCEEDED_VERIFIED", verified: true, source: "SIM", model_version: "c0ffee" });
  });

  it("lists newest first and keeps only the newest entries", () => {
    for (let index = 0; index < RUN_LOG_CAPACITY + 5; index += 1) {
      recordRun({ ...mmktLogEntry(200, { run: { run_id: `run-${index}`, status: "optimal_verified" } }, 1) });
    }
    const { entries, started_at } = listRuns();
    expect(entries).toHaveLength(RUN_LOG_CAPACITY);
    expect(entries[0].run_id).toBe(`run-${RUN_LOG_CAPACITY + 4}`);
    expect(entries.at(-1)!.run_id).toBe("run-5");
    expect(Number.isNaN(Date.parse(started_at))).toBe(false);
  });
});
