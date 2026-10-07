/**
 * Schema validation for the agent contracts (spec009 T-002).
 *
 * The JSON Schemas in contracts/agent/ are the single source of truth: types are generated from
 * them (src/lib/agent/contracts/) and the Python worker validates against the same files.
 */
import Ajv2019, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import agentWorkflows from "../../../contracts/agent/agent-workflows.schema.json";
import formulaVectors from "../../../contracts/agent/formula-vectors.schema.json";
import job from "../../../contracts/agent/job.schema.json";
import llmProfiles from "../../../contracts/agent/llm-profiles.schema.json";
import metricRegistry from "../../../contracts/agent/metric-registry.schema.json";
import quantsmithPin from "../../../contracts/agent/quantsmith-pin.schema.json";
import result from "../../../contracts/agent/result.schema.json";
import verification from "../../../contracts/agent/verification.schema.json";
import { checkSchemaVersion, type Compatibility, type ContractKind } from "./compat";

const SCHEMAS: Record<ContractKind, object> = {
  workflows: agentWorkflows,
  profiles: llmProfiles,
  job,
  result,
  verification,
  registry: metricRegistry,
  pin: quantsmithPin,
  vectors: formulaVectors,
};

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; compatibility?: Compatibility; issues: ValidationIssue[] };

let ajv: Ajv2019 | null = null;
const compiled = new Map<ContractKind, ValidateFunction>();

function validatorFor(kind: ContractKind): ValidateFunction {
  const cached = compiled.get(kind);
  if (cached) return cached;
  if (!ajv) {
    // Strict mode so a typo in a schema keyword fails loudly. strictRequired is off because the
    // schemas deliberately name fields that must NOT appear (for example a worker `verdict`) and
    // conditional `required` lists in if/then branches.
    ajv = new Ajv2019({ strict: true, strictRequired: false, allErrors: true, allowUnionTypes: true });
    addFormats(ajv);
  }
  const fn = ajv.compile(SCHEMAS[kind]);
  compiled.set(kind, fn);
  return fn;
}

function toIssues(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  return (errors ?? []).map((e) => ({ path: e.instancePath || "/", message: e.message ?? "invalid" }));
}

/**
 * Validate `doc` against contract `kind`. An unsupported `schema_version` is reported as an
 * incompatibility (not as a pile of structural errors), so callers can show the right state.
 */
export function validateContract(kind: ContractKind, doc: unknown): ValidationResult {
  const compatibility = checkSchemaVersion(doc, kind);
  if (!compatibility.ok) {
    return {
      ok: false,
      compatibility,
      issues: [{ path: "/schema_version", message: `incompatible schema_version (${compatibility.reason})` }],
    };
  }
  const validate = validatorFor(kind);
  return validate(doc) ? { ok: true } : { ok: false, issues: toIssues(validate.errors) };
}
