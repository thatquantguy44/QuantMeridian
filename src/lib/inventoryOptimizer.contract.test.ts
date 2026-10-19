// Contract parity between the TypeScript client types and the IBAL service's /v1/runs response
// (spec013 IBAL-003). contracts/ibal/run-response.shape.json is generated from the pinned engine's
// result schema by services/inventory_optimizer_api/tests/test_ts_contract_shape.py. The field maps
// below are typed `Fields<T>`, so `tsc` fails if one omits or invents a key of its TypeScript type;
// this test then fails if those keys differ from what the service actually returns.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  DatasetEnvelope,
  IbalAllocation,
  IbalBalance,
  IbalCoefficientRange,
  IbalConstraint,
  IbalDemand,
  IbalMipProgress,
  IbalModelStatistics,
  IbalObjectiveCoefficientRange,
  IbalPhaseTimings,
  IbalResult,
  IbalRowLimitRange,
  IbalSensitivity,
  RunResponse,
} from "@/lib/inventoryOptimizer";

/** null = scalar, "*" = present but not typed in detail here, [x] = array of x, {..} = object. */
type Shape = null | "*" | Shape[] | { [key: string]: Shape };
type Fields<T> = { [K in keyof Required<T>]: Shape };

type Economics = NonNullable<IbalResult["economics"]>;

const ALLOCATION: Fields<IbalAllocation> = {
  route_id: null,
  inventory_id: null,
  demand_group_id: null,
  current_quantity_shares: null,
  post_quantity_shares: null,
  increase_shares: null,
  decrease_shares: null,
  fee_rate: null,
  demand_cap_shares: null,
  eligible: null,
  reason_codes: [null],
  explanation_evidence: "*",
};

const BALANCE: Fields<IbalBalance> = {
  inventory_id: null,
  pre_total_lendable_shares: null,
  pre_reserved_shares: null,
  pre_committed_out_shares: null,
  pre_on_loan_shares: null,
  pre_available_to_lend_shares: null,
  post_available_shares: null,
  post_on_loan_shares: null,
  utilization: null,
};

const DEMAND: Fields<IbalDemand> = {
  demand_group_id: null,
  reference_quantity_shares: null,
  raw_demand_shares: null,
  effective_cap_shares: null,
  filled_shares: null,
  unfilled_shares: null,
  fill_ratio: null,
  reason_code: null,
};

const CONSTRAINT: Fields<IbalConstraint> = {
  row: { kind: null, scope_id: null } satisfies Fields<IbalConstraint["row"]>,
  lower: null,
  upper: null,
  activity: null,
  slack: null,
  dual_value: null,
};

const RANGE: Fields<IbalCoefficientRange> = { count: null, min_abs: null, max_abs: null, ratio: null };

const MODEL_STATISTICS: Fields<IbalModelStatistics> = {
  variable_count: null,
  row_count: null,
  nonzero_count: null,
  integer_variable_count: null,
  quadratic_nonzero_count: null,
  matrix: RANGE,
  objective: RANGE,
  bounds: RANGE,
  row_limits: RANGE,
  quadratic_objective: RANGE,
  scaling_warning_ratio: null,
  scaling_warnings: [null],
};

const TIMINGS: Fields<IbalPhaseTimings> = { compile_seconds: null, solve_seconds: null, verify_seconds: null };

const OBJECTIVE_RANGE: Fields<IbalObjectiveCoefficientRange> = {
  variable: { kind: null, scope_id: null },
  value: null,
  coefficient: null,
  coefficient_lower: null,
  coefficient_upper: null,
  objective_at_lower: null,
  objective_at_upper: null,
};

const ROW_RANGE: Fields<IbalRowLimitRange> = {
  row: { kind: null, scope_id: null },
  activity: null,
  binding: null,
  limit: null,
  limit_value: null,
  limit_lower: null,
  limit_upper: null,
  objective_at_lower: null,
  objective_at_upper: null,
};

const SENSITIVITY: Fields<IbalSensitivity> = {
  available: null,
  unavailable_reason: null,
  objective_coefficients: [OBJECTIVE_RANGE],
  row_limits: [ROW_RANGE],
};

const MIP_PROGRESS: Fields<IbalMipProgress> = {
  available: null,
  unavailable_reason: null,
  points: [{ incumbent_objective: null, best_bound: null, relative_gap: null, nodes: null }],
};

const RESULT: Fields<IbalResult> = {
  request_id: null,
  run_id: null,
  status: null,
  native_status: null,
  termination_reason: null,
  strict: null,
  input_hash: null,
  config_hash: null,
  package_version: null,
  backend_version: null,
  created_at: null,
  allocations: [ALLOCATION],
  balances: [BALANCE],
  demand: [DEMAND],
  constraints: [CONSTRAINT],
  economics: {
    components: [
      {
        component_name: null,
        component_version: null,
        unscaled_value_usd: null,
        baseline_value_usd: null,
        delta_usd: null,
      } satisfies Fields<Economics["components"][number]>,
    ],
    total_value_usd: null,
    total_delta_usd: null,
  } satisfies Fields<Economics>,
  solver: {
    backend_name: null,
    backend_version: null,
    runtime_seconds: null,
    iterations: null,
    nodes: null,
    best_bound: null,
    relative_gap: null,
    termination_reason: null,
  } satisfies Fields<NonNullable<IbalResult["solver"]>>,
  formulation: {
    variant: null,
    objective_exact: null,
    optimality_basis: null,
    variable_count: null,
    row_count: null,
    integer_variable_count: null,
    stability_linearization: "*",
  } satisfies Fields<NonNullable<IbalResult["formulation"]>>,
  verification: {
    passed: null,
    has_primal: null,
    max_variable_bound_violation: null,
    max_row_violation: null,
    max_integrality_violation: null,
    objective_reconstruction_delta: null,
  } satisfies Fields<NonNullable<IbalResult["verification"]>>,
  desk: {
    problem_family: null,
    legal_entity_id: null,
    platform_tenant_id: null,
    attribution_scope: null,
    enabled_components: [null],
  } satisfies Fields<NonNullable<IbalResult["desk"]>>,
  platform: {
    request_id: null,
    correlation_id: null,
    idempotency_key: null,
    problem_family: null,
    as_of: null,
    schema_version: null,
    authorization_reference: null,
    platform_tenant_id: null,
    actor_reference: null,
  } satisfies Fields<NonNullable<IbalResult["platform"]>>,
  warnings: [null],
  pricing: "*",
  concentration: "*",
  expected_economics: "*",
  availability_buffers: "*",
  agency: "*",
  prime: "*",
  schedules: "*",
  collateral: "*",
  sources: "*",
  model_statistics: MODEL_STATISTICS,
  timings: TIMINGS,
  sensitivity: SENSITIVITY,
  mip_progress: MIP_PROGRESS,
};

const RUN_RESPONSE: Fields<RunResponse> = {
  api_schema_version: null,
  source: {
    mode: null,
    label: null,
    seed: null,
    generator_version: null,
    upload_hash: null,
    filename: null,
  } satisfies Fields<DatasetEnvelope["source"]>,
  request_hash: null,
  result: RESULT,
};

/** Every difference between the TypeScript field map and the service shape, as readable paths. */
function differences(typed: Shape, actual: Shape, path: string): string[] {
  if (typed === "*") return [];
  if (typed === null) return actual === null || actual === "*" ? [] : [`${path}: typed as a scalar, service returns structure`];
  if (Array.isArray(typed)) {
    if (!Array.isArray(actual)) return [`${path}: typed as an array, service returns ${JSON.stringify(actual)}`];
    return differences(typed[0], actual[0], `${path}[]`);
  }
  if (actual === null || actual === "*" || Array.isArray(actual)) return [`${path}: typed as an object, service returns ${JSON.stringify(actual)}`];
  const missing = Object.keys(actual).filter((key) => !(key in typed)).map((key) => `${path}.${key}: returned by the service but missing from the TypeScript type`);
  const extra = Object.keys(typed).filter((key) => !(key in actual)).map((key) => `${path}.${key}: in the TypeScript type but not returned by the service`);
  const nested = Object.keys(typed).filter((key) => key in actual).flatMap((key) => differences(typed[key], actual[key], `${path}.${key}`));
  return [...missing, ...extra, ...nested];
}

const serviceShape = JSON.parse(readFileSync(new URL("../../contracts/ibal/run-response.shape.json", import.meta.url), "utf-8")) as Shape;

describe("IBAL run response contract", () => {
  it("TypeScript types list exactly the fields the pinned service returns", () => {
    expect(differences(RUN_RESPONSE, serviceShape, "$")).toEqual([]);
  });

  it("reports a field the service adds and a field it drops", () => {
    const changed = structuredClone(serviceShape) as { result: Record<string, Shape> };
    changed.result.new_section = null;
    delete changed.result.run_id;
    expect(differences(RUN_RESPONSE, changed as Shape, "$")).toEqual([
      "$.result.new_section: returned by the service but missing from the TypeScript type",
      "$.result.run_id: in the TypeScript type but not returned by the service",
    ]);
  });
});
