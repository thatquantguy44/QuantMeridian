/* eslint-disable */
/**
 * GENERATED from contracts/agent/verification.schema.json by scripts/generate-agent-contracts.mjs.
 * Do not edit by hand; run `npm run generate:agent-contracts`.
 */

/**
 * Verifier output stored with a job (agent-verification/1). Written only by the Node verifier; workers never supply verdicts.
 */
export interface AgentVerification {
  schema_version: "agent-verification/1";
  job_id: string;
  verified_at: string;
  registry_version?: string;
  claims: {
    id: string;
    verdict: "VERIFIED" | "FLAGGED" | "DROPPED";
    reason?:
      | "value_mismatch"
      | "revised_since_job"
      | "unknown_series"
      | "unknown_dataset"
      | "DATA_CLASS_NOT_APPROVED"
      | "non_db_provenance"
      | "no_observation"
      | "dropped_input"
      | "unknown_formula"
      | "params_mismatch"
      | "assumption_mismatch"
      | "unsupported_claim"
      | "ungrounded_text"
      | "series_not_in_registry"
      | "extra_series"
      | "no_data";
    source_value?: number | null;
    source_as_of?: string | null;
  }[];
  charts: {
    block_index: number;
    verdict: "VERIFIED" | "DROPPED";
    reason?:
      | "value_mismatch"
      | "revised_since_job"
      | "unknown_series"
      | "unknown_dataset"
      | "DATA_CLASS_NOT_APPROVED"
      | "non_db_provenance"
      | "no_observation"
      | "dropped_input"
      | "unknown_formula"
      | "params_mismatch"
      | "assumption_mismatch"
      | "unsupported_claim"
      | "ungrounded_text"
      | "series_not_in_registry"
      | "extra_series"
      | "no_data";
    series?: {
      ref: SeriesRef;
      provenance: "DB" | "SIM" | "ERR";
      observations: number;
    }[];
  }[];
  text: {
    block_index: number;
    rule_passed: boolean;
    replaced_with_template: boolean;
    flags?: (
      | "value_mismatch"
      | "revised_since_job"
      | "unknown_series"
      | "unknown_dataset"
      | "DATA_CLASS_NOT_APPROVED"
      | "non_db_provenance"
      | "no_observation"
      | "dropped_input"
      | "unknown_formula"
      | "params_mismatch"
      | "assumption_mismatch"
      | "unsupported_claim"
      | "ungrounded_text"
      | "series_not_in_registry"
      | "extra_series"
      | "no_data"
    )[];
  }[];
  summary: {
    verified: number;
    flagged: number;
    dropped: number;
  };
}
/**
 * This interface was referenced by `AgentVerification`'s JSON-Schema
 * via the `definition` "SeriesRef".
 */
export interface SeriesRef {
  source: "econ" | "fred" | "market" | "lens";
  id: string;
}
