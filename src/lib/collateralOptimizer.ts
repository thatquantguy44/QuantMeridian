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
  api_schema_version: "1.0.0"; run_id: string;
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
      typeof run.model_commit !== "string" || typeof run.input_hash !== "string" ||
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
