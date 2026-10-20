// INDEM service envelopes and result types (spec020 IND-T13/T14). The JSON Schemas in
// contracts/indemnification/ are the source of truth; src/lib/indemnificationApi.test.ts keeps these types
// and the schemas in step. `isRunResponse` validates a service response against the full contract.
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import closeoutProfileSchema from "../../contracts/indemnification/closeout-profile-1.0.schema.json";
import errorSchema from "../../contracts/indemnification/error-1.0.schema.json";
import modelCardSchema from "../../contracts/indemnification/model-card-1.0.schema.json";
import ratingTableSchema from "../../contracts/indemnification/rating-pd-table-1.0.schema.json";
import resultSchema from "../../contracts/indemnification/result-1.0.schema.json";
import runResponseSchema from "../../contracts/indemnification/run-response-1.0.schema.json";
import snapshotSchema from "../../contracts/indemnification/snapshot-1.0.schema.json";
import type { CloseoutSettings, DataLabel, IndemnificationSnapshot, RunSettings, StepSize } from "./indemnificationContract";

export interface Metric { value: number; std_error: number | null }
export interface Metrics {
  el: Metric; epe: Metric; pfe95: Metric; pfe99: Metric; var99: Metric; var999: Metric; es99: Metric; es999: Metric;
}
export interface ChannelMetrics { total: Metrics; default_shortfall: Metrics; reinvestment: Metrics }
export interface WrongWayMetrics { with_wrong_way: ChannelMetrics; without_wrong_way: ChannelMetrics }
export interface ProgramMetrics { gaussian: WrongWayMetrics; student_t: ChannelMetrics | null }
export interface ExposureProfile { times_days: number[]; ee: number[]; pfe95: number[]; pfe99: number[] }

export type SettingLevel = "position" | "borrower" | "asset_class" | "pool_bucket" | "default";
export interface EffectiveSettings {
  position_id: string;
  kind: "loan" | "collateral" | "pool_position";
  mpor_days: number;
  settings: CloseoutSettings;
  source_levels: Record<string, SettingLevel>;
}

export interface BorrowerPricing {
  average_loan_value: number;
  fee_bps: number;
  expected_loss_bps: number;
  economic_capital: number;
  economic_capital_cost_bps: number;
  indemnification_cost_bps: number;
  regulatory_proxy_cost_bps: number;
  flagged: boolean;
}
export interface BorrowerResult {
  borrower_id: string;
  credit_source: "RATING_TABLE" | "USER_SPREAD";
  pd_1y: number;
  hazard: number;
  metrics: WrongWayMetrics;
  euler_es99: Metric;
  exposure_profile: ExposureProfile;
  pricing: BorrowerPricing | null;
}
export interface OwnerResult { owner_id: string; el: { total: Metric; default_shortfall: Metric; reinvestment: Metric } }
export interface CrossCheckRow { borrower_id: string; exposure: number; collateral: number; e_star: number; mc_pfe99: number }
export interface CrossCheck { label: string; borrowers: CrossCheckRow[] }
export interface Sensitivity {
  parameter: string;
  values: number[];
  el: Metric[];
  el_default_shortfall: Metric[];
  el_reinvestment: Metric[];
  pfe99: Metric[];
}
export type StressId = "largest_borrower_default" | "squeeze" | "rates_shock" | "fx_shock" | "reinvestment_run";
export interface StressLoss { default_shortfall: number; reinvestment: number }
export interface Stress {
  id: StressId;
  label: string;
  by_borrower: ({ borrower_id: string } & StressLoss)[];
  by_owner: ({ owner_id: string } & StressLoss)[];
}
export interface ModelCard {
  model_card_schema_version: "1.0";
  model_version: string;
  snapshot_hash: string;
  profile_name: string;
  profile_hash: string;
  mode: "desk" | "annual";
  seed: number;
  paths: number;
  preview: boolean;
  horizon_days: number;
  step: StepSize;
  convergence: { checked: boolean; max_shift_in_standard_errors: number | null; passed: boolean | null };
  validation: { check: string; passed: boolean | null; note: string | null }[];
  data_label: DataLabel;
  limitations: string;
}
export interface IndemnificationResult {
  api_schema_version: "1.0";
  run_id: string;
  snapshot_hash: string;
  created_at: string;
  source: DataLabel;
  run: RunSettings;
  model_card: ModelCard;
  effective_settings: EffectiveSettings[];
  program: ProgramMetrics;
  exposure_profile: ExposureProfile;
  borrowers: BorrowerResult[];
  owners: OwnerResult[];
  cross_check: CrossCheck;
  sensitivities: Sensitivity[];
  stresses: Stress[];
}

export interface RunOptions {
  /** Paths per sweep point; null skips the sensitivities. */
  sensitivity_paths: number | null;
  stresses: boolean;
  stress_profile_overrides: Partial<CloseoutSettings> | null;
}
export interface RunRequest { api_schema_version: "1.0"; snapshot: IndemnificationSnapshot; options: RunOptions }
export interface RunRecord {
  run_id: string;
  received_at: string;
  snapshot_hash: string;
  request_hash: string;
  status: "complete";
  model_version: string;
  duration_ms: number;
}
export interface RunResponse { api_schema_version: "1.0"; correlation_id: string; run: RunRecord; result: IndemnificationResult }

export type ServiceErrorCode =
  | "REQUEST_CONTRACT_INVALID" | "SNAPSHOT_INVALID" | "RUN_TOO_LARGE" | "BODY_TOO_LARGE"
  | "SERVICE_BUSY" | "IDEMPOTENCY_CONFLICT" | "RUN_NOT_FOUND" | "MODEL_ERROR";
export interface ServiceError {
  api_schema_version: "1.0";
  code: ServiceErrorCode;
  category: "validation" | "capacity" | "conflict" | "not_found" | "internal";
  message: string;
  issues?: string[];
}

let validators: { response: ValidateFunction; error: ValidateFunction; snapshot: ValidateFunction } | undefined;
function compiled() {
  if (!validators) {
    const ajv = new Ajv2020({ strict: true, allErrors: false });
    addFormats(ajv);
    const schemas = [closeoutProfileSchema, ratingTableSchema, modelCardSchema, resultSchema, runResponseSchema, errorSchema, snapshotSchema];
    for (const schema of schemas) ajv.addSchema(schema);
    validators = {
      response: ajv.getSchema(runResponseSchema.$id)!,
      error: ajv.getSchema(errorSchema.$id)!,
      snapshot: ajv.getSchema(snapshotSchema.$id)!,
    };
  }
  return validators;
}

/** True when the value is a complete `run-response-1.0` document (the whole result included). */
export function isRunResponse(value: unknown): value is RunResponse {
  return compiled().response(value) as boolean;
}
export function isServiceError(value: unknown): value is ServiceError {
  return compiled().error(value) as boolean;
}
/** Why a value is not a run response, for logs and tests. */
export function runResponseProblem(value: unknown): string | null {
  const validate = compiled().response;
  if (validate(value)) return null;
  const first = validate.errors?.[0];
  return first ? `${first.instancePath || "<root>"} ${first.message}` : "invalid";
}

/** Schema errors for a snapshot (one message per problem, with its path); empty when it conforms. */
export function snapshotSchemaIssues(snapshot: unknown): string[] {
  const validate = compiled().snapshot;
  if (validate(snapshot)) return [];
  return (validate.errors ?? []).map((e) => `${e.instancePath || "<root>"}: ${e.message}`);
}

/** Failures of the terminal's own hop to the service, as opposed to errors the service reports. */
export type TransportErrorCode =
  | "BINDING_UNCONFIGURED" | "BINDING_INCOMPATIBLE" | "PRODUCTION_DISABLED" | "REQUEST_TOO_LARGE"
  | "REQUEST_INVALID" | "SERVICE_UNAVAILABLE" | "SERVICE_TIMEOUT" | "RESPONSE_INVALID"
  | "RESPONSE_INCOMPATIBLE" | "RESPONSE_TOO_LARGE";
export interface TransportError {
  api_schema_version: "1.0";
  code: TransportErrorCode;
  category: "transport";
  message: string;
}
export function isTransportError(value: unknown): value is TransportError {
  const v = value as Partial<TransportError> | null;
  return typeof v === "object" && v !== null && v.category === "transport" && typeof v.code === "string" && typeof v.message === "string";
}
