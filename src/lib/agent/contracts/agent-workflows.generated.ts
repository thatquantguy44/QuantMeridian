/* eslint-disable */
/**
 * GENERATED from contracts/agent/agent-workflows.schema.json by scripts/generate-agent-contracts.mjs.
 * Do not edit by hand; run `npm run generate:agent-contracts`.
 */

/**
 * settings/agent_workflows.json: which module panels exist, which workflows each offers, and queue limits (agent-workflows/1).
 */
export interface AgentWorkflowsConfig {
  schema_version: "agent-workflows/1";
  limits: Limits;
  workflows: {
    "chart.build": Workflow;
    "analysis.answer": Workflow;
    "secfin.carry": Workflow;
    "story.build": Workflow;
    "brief.draft": Workflow;
  };
  modules: {
    [k: string]: Module;
  };
}
/**
 * This interface was referenced by `AgentWorkflowsConfig`'s JSON-Schema
 * via the `definition` "Limits".
 */
export interface Limits {
  max_queued_per_requester: number;
  max_running_per_requester: number;
  queue_ttl_hours: number;
  max_attempts: number;
  lease_seconds: number;
  heartbeat_seconds: number;
  max_context_bytes: number;
  max_message_chars: number;
}
/**
 * This interface was referenced by `AgentWorkflowsConfig`'s JSON-Schema
 * via the `definition` "Workflow".
 */
export interface Workflow {
  version: string;
  llm: "none" | "optional" | "required";
  uses: ("copilot" | "interpreter" | "narrator" | "drafter")[];
  timeout_seconds: number;
  /**
   * @minItems 1
   */
  data_classes: [
    "public_market_data" | "module_context" | "desk_simulated",
    ...("public_market_data" | "module_context" | "desk_simulated")[]
  ];
  enabled: boolean;
  requires_capabilities: string[];
  plan_capabilities?: {
    non_additive_or_multi_period?: string[];
    desk_metric?: string[];
  };
  kinds?: {
    macro_backdrop?: {
      requires_capabilities: string[];
    };
    funding_conditions?: {
      requires_capabilities: string[];
    };
    desk_review?: {
      requires_capabilities: string[];
    };
  };
}
/**
 * This interface was referenced by `AgentWorkflowsConfig`'s JSON-Schema
 * via the `definition` "Module".
 */
export interface Module {
  enabled: boolean;
  workflows: ("chart.build" | "analysis.answer" | "secfin.carry" | "story.build" | "brief.draft")[];
  default_profile: string | null;
  profile_override: boolean;
  domains: string[];
  desk_datasets?: string[];
  context_fields: ("series" | "range" | "transform" | "chartType" | "asOfDate" | "tenors" | "components" | "metric")[];
}
