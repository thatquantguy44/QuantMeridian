export type IbalTone = "LIVE" | "ERR" | "SIM" | "NONE";

export interface LocatedIssue {
  code: string;
  message: string;
  location: string;
  severity?: "error" | "warning";
}

export interface ValidationReport {
  valid: boolean;
  issues: LocatedIssue[];
}

export interface DatasetSummary {
  row_counts: Record<string, number>;
  total_lendable_shares: number;
  total_available_shares: number;
  total_current_on_loan_shares: number;
  total_demand_shares: number;
  borrower_count: number;
  security_count: number;
  as_of: string;
  effective_date: string;
}

export interface IbalInventoryRow {
  inventory_id: string;
  inventory_pool_id: string;
  security_id: string;
  as_of: string;
  settlement_date: string;
  total_lendable_shares: number;
  on_loan_shares: number;
  reserved_shares: number;
  committed_out_shares: number;
  available_to_lend_shares: number;
  price_usd: number;
  currency: string;
  eligible: boolean;
  source_version: string;
}

export interface IbalRouteRow {
  route_id: string;
  inventory_id: string;
  security_id: string;
  borrower_id: string;
  demand_group_id: string;
  current_quantity_shares: number;
  hard_minimum_quantity_shares: number;
  minimum_active_quantity_shares: number | null;
  maximum_quantity_shares: number;
  fee_rate: number;
  revenue_share: number;
  reinvestment_rate: number | null;
  collateral_factor: number | null;
  variable_cost_rate: number;
  increase_cost_usd_per_share: number;
  decrease_cost_usd_per_share: number;
  recall_notice_days: number;
  term_end_date: string | null;
  eligible: boolean;
  all_or_none: boolean;
  lot_size_shares: number | null;
  priority_class: string | null;
}

export interface IbalDemandRow {
  demand_group_id: string;
  security_id: string;
  borrower_id: string;
  as_of: string;
  reference_quantity_shares: number;
  reference_fee_rate: number;
  elasticity: number;
  forecast_std_shares: number | null;
  hard_max_quantity_shares: number | null;
  source_model: string;
  source_version: string;
  candidate_fee_rates: number[];
}

export interface IbalCounterpartyLimitRow {
  limit_id: string;
  borrower_id: string;
  legal_entity_id: string | null;
  ultimate_parent_id: string | null;
  effective_from: string;
  effective_to: string | null;
  security_id: string | null;
  inventory_pool_id: string | null;
  maximum_notional_usd: number | null;
  maximum_quantity_shares: number | null;
  hard: boolean;
  risk_class: string | null;
  source: string;
  source_version: string;
}

export interface IbalUtilizationPolicyRow {
  policy_id: string;
  inventory_pool_id: string | null;
  security_id: string | null;
  effective_from: string;
  effective_to: string | null;
  minimum_utilization: number | null;
  target_utilization: number | null;
  maximum_utilization: number | null;
  reserve_buffer_shares: number;
  reserve_buffer_fraction: number;
  target_hard: boolean;
  target_penalty_usd_per_share: number | null;
  target_priority: number | null;
  maximum_active_routes: number | null;
  source: string;
  source_version: string;
}

export interface IbalEntityRelationshipRow {
  value: {
    entity_id: string;
    legal_entity_id: string;
    ultimate_parent_id: string;
    relationship_type: string;
    ownership_confidence: number;
  };
  observed_at: string;
  effective_from: string;
  effective_to: string | null;
  source: string;
  source_version: string;
  field_mapping_version: string;
  quality: string;
}

export interface IbalRequest {
  request_id: string;
  as_of: string;
  effective_date: string;
  problem_family: string;
  inventory: IbalInventoryRow[];
  routes: IbalRouteRow[];
  demand: IbalDemandRow[];
  counterparty_limits: IbalCounterpartyLimitRow[];
  utilization_policies: IbalUtilizationPolicyRow[];
  entity_relationships: IbalEntityRelationshipRow[];
  [key: string]: unknown;
}

export interface DatasetEnvelope {
  api_schema_version: string;
  template_schema_version: string;
  source: {
    mode: "synthetic" | "upload";
    label: string;
    seed?: number | null;
    generator_version?: string | null;
    upload_hash?: string | null;
    filename?: string | null;
  };
  request: IbalRequest;
  request_hash: string;
  summary: DatasetSummary;
  validation: ValidationReport;
  resolved_config?: Record<string, unknown> | null;
}

export interface SyntheticConfig {
  profile: "balanced" | "scarce" | "concentrated" | "specials";
  scale: "small" | "medium" | "large" | "custom";
  seed: number;
  security_count: number;
  inventory_pool_count: number;
  borrower_count: number;
  parent_group_count: number;
  routes_per_security: number;
  starting_utilization: number;
  utilization_cap: number;
  borrower_concentration: number;
  fee_rate_mean: number;
  fee_rate_dispersion: number;
  elasticity_mean: number;
  reserve_fraction: number;
  ineligible_fraction: number;
  discrete_route_fraction: number;
}

export interface RunConfig {
  solver_time_limit_seconds: number;
  relative_gap: number;
  threads: number;
  solver_seed: number;
  max_staleness_hours: number;
  minimum_entity_confidence: number;
  allocation_stability_penalty: number;
}

export interface IbalAllocation {
  route_id: string;
  inventory_id: string;
  demand_group_id: string;
  current_quantity_shares: number;
  post_quantity_shares: number;
  increase_shares: number;
  decrease_shares: number;
  fee_rate: number;
  demand_cap_shares: number | null;
  eligible: boolean;
  reason_codes: string[];
  /** Per-allocation drill-down evidence (e.g. allocation_delta_shares, net_fee_coefficient) --
   * scalar values only, keys vary by allocation. */
  explanation_evidence: Record<string, number | string>;
}

export interface IbalBalance {
  inventory_id: string;
  pre_total_lendable_shares: number;
  pre_reserved_shares: number;
  pre_committed_out_shares: number;
  pre_on_loan_shares: number;
  pre_available_to_lend_shares: number;
  post_available_shares: number;
  post_on_loan_shares: number;
  utilization: number;
}

export interface IbalDemand {
  demand_group_id: string;
  reference_quantity_shares: number;
  raw_demand_shares: number;
  effective_cap_shares: number;
  filled_shares: number;
  unfilled_shares: number;
  fill_ratio: number;
  reason_code: string | null;
}

export interface IbalConstraint {
  row: { kind: string; scope_id: string };
  lower: number | null;
  upper: number | null;
  activity: number;
  slack: number;
  dual_value: number;
}

export interface IbalResult {
  request_id: string;
  run_id: string;
  status: string;
  native_status: string | null;
  termination_reason: string | null;
  strict: boolean;
  input_hash: string;
  config_hash: string;
  package_version: string;
  backend_version: string | null;
  created_at: string;
  allocations: IbalAllocation[];
  balances: IbalBalance[];
  demand: IbalDemand[];
  constraints: IbalConstraint[];
  economics?: {
    components: { component_name: string; component_version: string; unscaled_value_usd: number; baseline_value_usd: number; delta_usd: number }[];
    total_value_usd: number;
    total_delta_usd: number;
  };
  solver?: {
    backend_name: string;
    backend_version: string;
    runtime_seconds: number;
    iterations: number;
    nodes?: number | null;
    best_bound?: number | null;
    relative_gap?: number | null;
    termination_reason: string;
  };
  verification?: {
    passed: boolean;
    has_primal: boolean;
    max_variable_bound_violation: number;
    max_row_violation: number;
    max_integrality_violation: number;
    objective_reconstruction_delta: number;
  };
  desk?: {
    problem_family: string;
    legal_entity_id: string | null;
    platform_tenant_id: string | null;
    attribution_scope: string | null;
    enabled_components: string[];
  } | null;
  platform?: {
    request_id: string;
    correlation_id: string;
    idempotency_key: string;
    problem_family: string;
    schema_version: string;
    authorization_reference: string;
    platform_tenant_id: string | null;
    actor_reference: string | null;
  } | null;
  warnings?: string[];
}

export interface IbalScenarioCatalogItem {
  scenario_type: string;
  version: string;
  description: string;
  applicable_families: string[];
  parameters_schema: Record<string, unknown>;
}

export interface IbalScenarioDriverDelta {
  dimension: "security" | "borrower" | "parent" | "inventory_pool" | "route";
  entity_id: string;
  presence: "matched" | "unmatched" | "new";
  baseline_quantity_shares: number;
  scenario_quantity_shares: number;
  delta_shares: number;
}

export interface IbalDriverDeltaReconciliation {
  dimension: IbalScenarioDriverDelta["dimension"];
  total_delta_shares: number;
  attributed_delta_shares: number;
  residual_shares: number;
}

export interface IbalStressOutcome {
  scenario_id: string;
  scenario_name: string;
  status: string;
  verification_passed: boolean;
  objective_delta_usd: number | null;
  baseline_objective_usd: number | null;
  scenario_objective_usd: number | null;
  rank: number | null;
  driver_deltas: IbalScenarioDriverDelta[];
  driver_reconciliations: IbalDriverDeltaReconciliation[];
}

export interface IbalScenarioStressResponse {
  api_schema_version: string;
  source: DatasetEnvelope["source"];
  request_hash: string;
  baseline_run_id: string;
  baseline_config_hash: string;
  scenario_type: string;
  generated_scenarios: Record<string, unknown>[];
  stress_report: {
    scenario_count: number;
    feasible_count: number;
    infeasible_count: number;
    verification_failed_count: number;
    worst_case_scenario_id: string | null;
    worst_case_objective_delta_usd: number | null;
    outcomes: IbalStressOutcome[];
  };
}

export interface RunResponse {
  api_schema_version: string;
  source: DatasetEnvelope["source"];
  request_hash: string;
  result: IbalResult;
}

export interface IbalCapabilities {
  engine_compatible: boolean;
  engine_commit: string;
  engine_fingerprint: string;
  engine_package_version: string;
  engine_source: string;
  backend: { name: string | null; version: string | null; ready: boolean };
  formulations: string[];
  input_features: Record<string, boolean>;
  output_sections: string[];
  upload_formats: string[];
  limits: Record<string, number>;
}

export interface IbalHealth {
  status?: string;
  ready?: boolean;
  engine_package_version?: string | null;
  engine_commit?: string | null;
  engine_source?: string;
  engine_mismatches?: string[];
  formulations?: string[];
  error_category?: string | null;
  backend?: { name: string | null; version: string | null; ready: boolean };
  error?: string;
  code?: string;
  config?: Record<string, unknown>;
}

export const DEFAULT_SYNTHETIC_CONFIG: SyntheticConfig = {
  profile: "balanced",
  scale: "small",
  seed: 1701,
  security_count: 8,
  inventory_pool_count: 2,
  borrower_count: 6,
  parent_group_count: 3,
  routes_per_security: 3,
  starting_utilization: 0.35,
  utilization_cap: 0.9,
  borrower_concentration: 0.35,
  fee_rate_mean: 0.025,
  fee_rate_dispersion: 0.012,
  elasticity_mean: 0.1,
  reserve_fraction: 0.05,
  ineligible_fraction: 0.03,
  discrete_route_fraction: 0,
};

export const DEFAULT_RUN_CONFIG: RunConfig = {
  solver_time_limit_seconds: 30,
  relative_gap: 0.0001,
  threads: 1,
  solver_seed: 1701,
  max_staleness_hours: 24,
  minimum_entity_confidence: 0.8,
  allocation_stability_penalty: 0,
};

/** Preserves the service's located-issue list (if any) alongside the error message, so callers
 * can render exactly what was rejected instead of just a flattened string. */
export class IbalRequestError extends Error {
  code?: string;
  issues: LocatedIssue[];
  constructor(message: string, opts?: { code?: string; issues?: LocatedIssue[] }) {
    super(message);
    this.name = "IbalRequestError";
    this.code = opts?.code;
    this.issues = opts?.issues ?? [];
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error ?? body?.message ?? `Request failed with ${response.status}`;
    throw new IbalRequestError(message, { code: body?.code, issues: body?.issues });
  }
  return body as T;
}

export async function getIbalHealth(): Promise<IbalHealth> {
  const response = await fetch("/api/inventory-optimizer/health", { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  return { ...body, ready: response.ok && Boolean(body.ready), status: response.ok ? body.status : "unavailable" } as IbalHealth;
}

export async function getIbalCapabilities(): Promise<IbalCapabilities> {
  return parseJson<IbalCapabilities>(await fetch("/api/inventory-optimizer/capabilities", { cache: "no-store" }));
}

export async function generateSyntheticDataset(config: SyntheticConfig): Promise<DatasetEnvelope> {
  return parseJson<DatasetEnvelope>(
    await fetch("/api/inventory-optimizer/datasets/synthetic", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    })
  );
}

export async function uploadIbalDataset(file: File): Promise<DatasetEnvelope> {
  const data = new FormData();
  data.set("file", file);
  return parseJson<DatasetEnvelope>(
    await fetch("/api/inventory-optimizer/datasets/upload", {
      method: "POST",
      body: data,
    })
  );
}

export async function validateIbalDataset(dataset: DatasetEnvelope): Promise<ValidationReport> {
  return parseJson<ValidationReport>(
    await fetch("/api/inventory-optimizer/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(dataset),
    })
  );
}

export async function runIbal(dataset: DatasetEnvelope, run_config: RunConfig): Promise<RunResponse> {
  return parseJson<RunResponse>(
    await fetch("/api/inventory-optimizer/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset, run_config }),
    })
  );
}

export async function getIbalScenarioCatalog(): Promise<{ scenarios: IbalScenarioCatalogItem[] }> {
  return parseJson<{ scenarios: IbalScenarioCatalogItem[] }>(
    await fetch("/api/inventory-optimizer/scenarios/catalog", { cache: "no-store" })
  );
}

export async function runIbalScenarioStress(
  dataset: DatasetEnvelope,
  run_config: RunConfig,
  baseline_result: IbalResult,
  scenario_type: string,
  parameters: Record<string, unknown>
): Promise<IbalScenarioStressResponse> {
  return parseJson<IbalScenarioStressResponse>(
    await fetch("/api/inventory-optimizer/scenarios/stress-test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset, run_config, baseline_result, scenario_type, parameters }),
    })
  );
}

export async function exportIbalBundle(dataset: DatasetEnvelope, result: IbalResult): Promise<Blob> {
  const response = await fetch("/api/inventory-optimizer/exports/result-tables", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dataset, result }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new IbalRequestError(body?.error ?? body?.message ?? `Export failed with ${response.status}`, {
      code: body?.code,
      issues: body?.issues,
    });
  }
  return response.blob();
}
