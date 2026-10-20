// INDEM envelopes and result types against their schemas (spec020 IND-T13/T14).
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  isRunResponse, isServiceError, runResponseProblem,
  type BorrowerPricing, type BorrowerResult, type CrossCheckRow, type IndemnificationResult, type ModelCard,
  type RunOptions, type RunRecord, type RunRequest, type RunResponse, type Sensitivity, type ServiceError,
} from "./indemnificationApi";

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../contracts/indemnification/${path}`, import.meta.url), "utf-8"));
const RESULT: IndemnificationResult = read("fixtures/result.example.json");
const REQUEST_SCHEMA = read("run-request-1.0.schema.json");
const RESPONSE_SCHEMA = read("run-response-1.0.schema.json");
const ERROR_SCHEMA = read("error-1.0.schema.json");
const RESULT_SCHEMA = read("result-1.0.schema.json");
const CARD_SCHEMA = read("model-card-1.0.schema.json");

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
type Fields<T> = { [K in keyof Required<T>]: true };
const keys = (fields: object) => Object.keys(fields).sort();
const schemaKeys = (definition: { properties: object }) => Object.keys(definition.properties).sort();

const envelope = (): RunResponse => ({
  api_schema_version: "1.0",
  correlation_id: "6f0d3a52-8d0b-4a7e-9d5e-7b1d6a7c1e00",
  run: {
    run_id: RESULT.run_id, received_at: "2026-10-20T12:00:00Z", snapshot_hash: RESULT.snapshot_hash,
    request_hash: "a".repeat(64), status: "complete", model_version: "indem-0.1.0", duration_ms: 1200,
  },
  result: RESULT,
});

const REQUEST: Fields<RunRequest> = { api_schema_version: true, snapshot: true, options: true };
const OPTIONS: Fields<RunOptions> = { sensitivity_paths: true, stresses: true, stress_profile_overrides: true };
const RECORD: Fields<RunRecord> = { run_id: true, received_at: true, snapshot_hash: true, request_hash: true, status: true, model_version: true, duration_ms: true };
const RESPONSE: Fields<RunResponse> = { api_schema_version: true, correlation_id: true, run: true, result: true };
const ERROR: Fields<ServiceError> = { api_schema_version: true, code: true, category: true, message: true, issues: true };
const RESULT_FIELDS: Fields<IndemnificationResult> = {
  api_schema_version: true, run_id: true, snapshot_hash: true, created_at: true, source: true, run: true, model_card: true,
  effective_settings: true, program: true, exposure_profile: true, borrowers: true, owners: true, cross_check: true,
  sensitivities: true, stresses: true,
};
const BORROWER: Fields<BorrowerResult> = { borrower_id: true, credit_source: true, pd_1y: true, hazard: true, metrics: true, euler_es99: true, exposure_profile: true, pricing: true };
const PRICING: Fields<BorrowerPricing> = {
  average_loan_value: true, fee_bps: true, expected_loss_bps: true, economic_capital: true, economic_capital_cost_bps: true,
  indemnification_cost_bps: true, regulatory_proxy_cost_bps: true, flagged: true,
};
const SENSITIVITY: Fields<Sensitivity> = { parameter: true, values: true, el: true, el_default_shortfall: true, el_reinvestment: true, pfe99: true };
const CROSS: Fields<CrossCheckRow> = { borrower_id: true, exposure: true, collateral: true, e_star: true, mc_pfe99: true };
const CARD: Fields<ModelCard> = {
  model_card_schema_version: true, model_version: true, snapshot_hash: true, profile_name: true, profile_hash: true, mode: true,
  seed: true, paths: true, preview: true, horizon_days: true, step: true, convergence: true, validation: true, data_label: true, limitations: true,
};

describe("TypeScript types match the schemas", () => {
  test("envelopes and result records have exactly the schema's fields", () => {
    expect(keys(REQUEST)).toEqual(schemaKeys(REQUEST_SCHEMA));
    expect(keys(OPTIONS)).toEqual(schemaKeys(REQUEST_SCHEMA.properties.options));
    expect(keys(RECORD)).toEqual(schemaKeys(RESPONSE_SCHEMA.properties.run));
    expect(keys(RESPONSE)).toEqual(schemaKeys(RESPONSE_SCHEMA));
    expect(keys(ERROR)).toEqual(schemaKeys(ERROR_SCHEMA));
    expect(keys(RESULT_FIELDS)).toEqual(schemaKeys(RESULT_SCHEMA));
    expect(keys(BORROWER)).toEqual(schemaKeys(RESULT_SCHEMA.$defs.BorrowerResult));
    expect(keys(PRICING)).toEqual(schemaKeys(RESULT_SCHEMA.$defs.BorrowerPricing));
    expect(keys(SENSITIVITY)).toEqual(schemaKeys(RESULT_SCHEMA.$defs.Sensitivity));
    expect(keys(CROSS)).toEqual(schemaKeys(RESULT_SCHEMA.$defs.CrossCheck.properties.borrowers.items));
    expect(keys(CARD)).toEqual(schemaKeys(CARD_SCHEMA));
  });
});

describe("response validation", () => {
  test("a complete response is accepted", () => {
    expect(runResponseProblem(envelope())).toBeNull();
    expect(isRunResponse(envelope())).toBe(true);
  });

  const bad = (name: string, mutate: (r: RunResponse) => void) =>
    test(`rejects ${name}`, () => {
      const response = clone(envelope());
      mutate(response);
      expect(isRunResponse(response), name).toBe(false);
      expect(runResponseProblem(response)).not.toBeNull();
    });
  bad("a missing result", (r) => { delete (r as Partial<RunResponse>).result; });
  bad("a wrong schema version", (r) => { (r as unknown as Record<string, unknown>).api_schema_version = "2.0"; });
  bad("a correlation id that is not a UUID", (r) => { r.correlation_id = "nope"; });
  bad("a malformed run id", (r) => { r.run.run_id = "xyz"; });
  bad("an unknown top-level field", (r) => { (r as unknown as Record<string, unknown>).extra = 1; });
  bad("a result with a missing channel", (r) => { delete (r.result.program.gaussian.with_wrong_way as Partial<typeof r.result.program.gaussian.with_wrong_way>).total; });
  bad("a metric with a missing standard error", (r) => { delete (r.result.program.gaussian.with_wrong_way.total.el as Partial<{ std_error: number }>).std_error; });
  bad("an unknown stress id", (r) => { (r.result.stresses[0] as unknown as Record<string, unknown>).id = "meteor"; });
  bad("a model card with a bad hash", (r) => { r.result.model_card.snapshot_hash = "abc"; });
  bad("non-JSON values", (r) => { (r as unknown as Record<string, unknown>).result = "text"; });

  test("a service error envelope is recognised", () => {
    expect(isServiceError({ api_schema_version: "1.0", code: "RUN_NOT_FOUND", category: "not_found", message: "none" })).toBe(true);
    expect(isServiceError({ api_schema_version: "1.0", code: "WHATEVER", category: "x", message: "m" })).toBe(false);
    expect(isServiceError(envelope())).toBe(false);
  });
});
