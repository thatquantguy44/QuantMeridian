/** Native 1.0 result carried through the adapter without UI-side economics. */
export interface CollateralSnapshot {
  schema_version: "1.0"; book_id: string; source: string; as_of: string;
  horizon_days: number; minimum_liquidity_reserve_usd: number;
  fx: { currency: string; usd_per_unit: number; observed_at: string }[];
  assets: { asset_id: string; asset_class: string; currency: string; issuer: string;
    allocatable_value: number; annual_carry_bps: number; liquidity_credit: number }[];
  calls: { call_id: string; margin_type: string; agreement_id: string; counterparty: string;
    currency: string; required_value: number; deadline_minutes: number }[];
  agreements: { agreement_id: string; legal_entity: string; classes: { asset_class: string; haircut: number }[] }[];
  current_pledges: { asset_id: string; call_id: string; market_value: number }[];
}
export interface CollateralRun {
  api_schema_version: "1.0.0"; run_id: string; correlation_id: string;
  idempotency_key: string | null; raw_payload_sha256: string;
  lifecycle_status: "SUCCEEDED_VERIFIED" | "SUCCEEDED_UNVERIFIED" | "INFEASIBLE" | "FAILED";
  preview_only: true; recommendation_eligible: false;
  source_mode: "SIM" | "USER_UPLOAD"; native_source: string; input_hash: string;
  parent_hash: string | null; scenario_id: string | null; model_commit: string;
  package_version: string; adapter_version: string; snapshot_schema_version: "1.0";
  result_schema_version: "1.0"; wheel_sha256: string; as_of: string; input_age_minutes: number;
  snapshot: CollateralSnapshot;
  result: {
    status: "optimal" | "infeasible" | "error" | "unverified"; verified: boolean;
    input_hash: string; source: string; engine_version: string;
    formulation: "LP" | "MIP";
    allocations: { asset_id: string; call_id: string; asset_class: string; currency: string;
      issuer: string; market_value: number; haircut: number; covered_usd: number;
      carry_usd: number; variable_move_usd: number; activation_fee_usd: number }[];
    movements: { asset_id: string; call_id: string; previous_value: number;
      target_value: number; delta_value: number; variable_move_usd: number }[];
    coverage: { call_id: string; required_usd: number; covered_usd: number }[];
    residual_liquidity_usd: number | null;
    cost: { carry_usd: number; variable_move_usd: number; fixed_activation_usd: number;
      total_usd: number; current_cost_usd: number | null; savings_usd: number | null } | null;
    diagnostics: { binding_constraints: string[]; call_shortfall_usd: Record<string, number>;
      incumbent_violations: string[]; verification_errors: string[];
      lp_duals_usd_per_unit: Record<string, number>; solver_status: string; message: string };
  };
  adapter_verification: { passed: boolean; errors: string[]; reconstructed_cost_usd: number | null };
}
export function isCollateralRun(value: unknown): value is CollateralRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Partial<CollateralRun>;
  if (run.api_schema_version !== "1.0.0" || run.preview_only !== true ||
      run.recommendation_eligible !== false ||
      !["SUCCEEDED_VERIFIED", "SUCCEEDED_UNVERIFIED", "INFEASIBLE", "FAILED"].includes(run.lifecycle_status ?? "") ||
      !["SIM", "USER_UPLOAD"].includes(run.source_mode ?? "") ||
      typeof run.run_id !== "string" || typeof run.correlation_id !== "string" ||
      typeof run.raw_payload_sha256 !== "string" ||
      !(run.idempotency_key === null || typeof run.idempotency_key === "string") ||
      typeof run.model_commit !== "string" || typeof run.input_hash !== "string" ||
      typeof run.package_version !== "string" || typeof run.adapter_version !== "string" ||
      typeof run.wheel_sha256 !== "string" || typeof run.as_of !== "string" ||
      typeof run.input_age_minutes !== "number" || !Number.isFinite(run.input_age_minutes) ||
      !(run.parent_hash === null || typeof run.parent_hash === "string") ||
      !(run.scenario_id === null || typeof run.scenario_id === "string") ||
      run.snapshot_schema_version !== "1.0" ||
      !run.snapshot || run.snapshot.schema_version !== "1.0" ||
      !run.result || !run.adapter_verification || run.result_schema_version !== "1.0") return false;
  const result = run.result;
  if (result.input_hash !== run.input_hash || result.source !== run.native_source ||
      result.engine_version !== run.package_version ||
      !["LP", "MIP"].includes(result.formulation)) return false;
  if (!Array.isArray(result.allocations) || !Array.isArray(result.coverage) ||
      !Array.isArray(result.movements) || !result.diagnostics ||
      !Array.isArray(result.diagnostics.binding_constraints) ||
      !Array.isArray(result.diagnostics.incumbent_violations) ||
      !result.diagnostics.call_shortfall_usd || !result.diagnostics.lp_duals_usd_per_unit ||
      !Array.isArray(run.adapter_verification.errors) ||
      !Array.isArray(run.snapshot.assets) || !Array.isArray(run.snapshot.calls) ||
      !Array.isArray(run.snapshot.current_pledges) || !Array.isArray(run.snapshot.fx)) return false;
  if (run.lifecycle_status === "SUCCEEDED_VERIFIED") {
    return result.status === "optimal" && result.verified === true &&
      run.adapter_verification.passed === true && run.adapter_verification.errors.length === 0 &&
      result.cost !== null && typeof result.cost?.total_usd === "number" &&
      typeof result.residual_liquidity_usd === "number";
  }
  return result.verified === false && run.adapter_verification.passed === false &&
    result.cost === null && result.allocations.length === 0 &&
    result.movements.length === 0 && result.coverage.length === 0;
}
export function changedSnapshotFields(a: CollateralSnapshot, b: CollateralSnapshot): string[] {
  const changes: string[] = [];
  for (const name of ["book_id", "as_of", "horizon_days", "minimum_liquidity_reserve_usd",
                      "fx", "assets", "calls", "agreements", "current_pledges"] as const) {
    if (JSON.stringify(a[name]) !== JSON.stringify(b[name])) changes.push(name);
  }
  return changes;
}
export function comparableCollateralRuns(a: CollateralRun, b: CollateralRun): boolean {
  return a.input_hash === b.input_hash && a.model_commit === b.model_commit &&
    a.result_schema_version === b.result_schema_version &&
    a.snapshot.horizon_days === b.snapshot.horizon_days &&
    a.lifecycle_status === "SUCCEEDED_VERIFIED" && b.lifecycle_status === "SUCCEEDED_VERIFIED";
}

/** Portable local preview. All values and financial components remain the service's output. */
export function buildCollateralRunExport(run: CollateralRun) {
  if (!isCollateralRun(run)) throw Error("Collateral result contract failed; export blocked.");
  return {
    export_schema_version: "1.0.0" as const,
    classification: "LOCAL_MODEL_PREVIEW" as const,
    preview_only: true as const,
    recommendation_eligible: false as const,
    notice: "Local model preview only. No governed inventory, live recommendation, booked movement, or settlement instruction.",
    units: { cost_currency: "USD" as const, horizon_days: run.snapshot.horizon_days,
      snapshot_values: "native currency per asset or call" as const },
    provenance: {
      run_id: run.run_id, correlation_id: run.correlation_id,
      idempotency_key: run.idempotency_key, raw_payload_sha256: run.raw_payload_sha256,
      source_mode: run.source_mode, native_source: run.native_source,
      as_of: run.as_of, input_age_minutes: run.input_age_minutes,
      input_hash: run.input_hash, parent_hash: run.parent_hash,
      scenario_id: run.scenario_id, model_commit: run.model_commit,
      package_version: run.package_version, wheel_sha256: run.wheel_sha256,
      adapter_version: run.adapter_version,
      snapshot_schema_version: run.snapshot_schema_version,
      result_schema_version: run.result_schema_version,
      lifecycle_status: run.lifecycle_status,
      adapter_verified: run.adapter_verification.passed
    },
    run
  };
}

export function downloadCollateralRun(run: CollateralRun): void {
  const data = buildCollateralRunExport(run);
  const clean = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "-");
  const name = `quantmeridian-collateral-${clean(run.source_mode.toLowerCase())}-${clean(run.scenario_id ?? "upload")}-${clean(run.run_id)}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + "\n"],
    { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
