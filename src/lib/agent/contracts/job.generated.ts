/* eslint-disable */
/**
 * GENERATED from contracts/agent/job.schema.json by scripts/generate-agent-contracts.mjs.
 * Do not edit by hand; run `npm run generate:agent-contracts`.
 */

/**
 * POST /api/agent/jobs body (agent-job/1). The workflow is always explicit. Structured `inputs` are the verifier's source for assumption claims.
 */
export type AgentJobCreateRequest = {
  schema_version: "agent-job/1";
  module: string;
  thread_id: string;
  workflow:
    | "chart.build"
    | "analysis.answer"
    | "secfin.carry"
    | "story.build"
    | "brief.draft"
    | "economics.explain"
    | "economics.transmission"
    | "economics.scenario";
  kind?: ("macro_backdrop" | "funding_conditions" | "desk_review") | null;
  message?: string;
  inputs?: CarryInputs | null;
  context: ContextSnapshot;
  profile?: string | null;
  parent_job_id?: string | null;
};
export type CarryInputs = {
  side: "long" | "short";
  notional: number;
  start: string;
  end?: string;
  tenor?: string;
  benchmark: string;
  spread_bps?: number;
  borrow_fee_bps?: number;
  use_desk_borrow_fee?: boolean;
  rebate_bps?: number;
  margin_bps?: number;
  /**
   * @maxItems 5
   */
  shocks_bps?:
    | []
    | [number]
    | [number, number]
    | [number, number, number]
    | [number, number, number, number]
    | [number, number, number, number, number];
} & CarryInputs1;
export type CarryInputs1 = {
  [k: string]: unknown;
};
export type JobStatus =
  "queued" | "running" | "verifying" | "succeeded" | "needs_clarification" | "failed" | "cancelled" | "expired";
export type ErrorCode =
  | "AGENT_DISABLED"
  | "AGENT_PRODUCTION_DISABLED"
  | "AGENT_TRUSTED_BOUNDARY_MISSING"
  | "AGENT_QUEUE_NOT_CONFIGURED"
  | "AGENT_MODULE_DISABLED"
  | "AGENT_CONTEXT_INVALID"
  | "AGENT_INPUTS_INVALID"
  | "AGENT_QUEUE_LIMIT"
  | "AGENT_IDEMPOTENCY_CONFLICT"
  | "WORKFLOW_UNKNOWN"
  | "WORKFLOW_NOT_READY"
  | "LLM_PROFILE_UNKNOWN"
  | "LLM_PROFILE_NOT_ALLOWED"
  | "LLM_PROFILE_UNAVAILABLE"
  | "DATA_CLASS_NOT_APPROVED"
  | "AGENT_WORKER_UNAUTHORIZED"
  | "LLM_BUDGET_EXCEEDED"
  | "LLM_PROVIDER_ERROR"
  | "LLM_OUTPUT_INVALID"
  | "JOB_TIMEOUT"
  | "WORKER_LOST"
  | "QUEUE_TTL_EXPIRED"
  | "DATA_UNAVAILABLE"
  | "UNSUPPORTED_CHART"
  | "UNSUPPORTED_METRIC"
  | "RESULT_SCHEMA_INCOMPATIBLE"
  | "VERIFICATION_ERROR";

export interface ContextSnapshot {
  /**
   * @maxItems 8
   */
  series?:
    | []
    | [SeriesRef]
    | [SeriesRef, SeriesRef]
    | [SeriesRef, SeriesRef, SeriesRef]
    | [SeriesRef, SeriesRef, SeriesRef, SeriesRef]
    | [SeriesRef, SeriesRef, SeriesRef, SeriesRef, SeriesRef]
    | [SeriesRef, SeriesRef, SeriesRef, SeriesRef, SeriesRef, SeriesRef]
    | [SeriesRef, SeriesRef, SeriesRef, SeriesRef, SeriesRef, SeriesRef, SeriesRef]
    | [SeriesRef, SeriesRef, SeriesRef, SeriesRef, SeriesRef, SeriesRef, SeriesRef, SeriesRef];
  range?: "1M" | "3M" | "6M" | "1Y" | "2Y" | "5Y" | "MAX";
  transform?: "none" | "index100" | "pct_change" | "yoy" | "mom" | "zscore" | "log";
  chartType?: "line" | "area";
  asOfDate?: string;
  /**
   * @maxItems 16
   */
  tenors?:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ];
  /**
   * @maxItems 16
   */
  components?:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ];
  metric?: string;
}
export interface SeriesRef {
  source: "econ" | "fred" | "market" | "lens";
  id: string;
}
