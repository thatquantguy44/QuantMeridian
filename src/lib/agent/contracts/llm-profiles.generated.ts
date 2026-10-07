/* eslint-disable */
/**
 * GENERATED from contracts/agent/llm-profiles.schema.json by scripts/generate-agent-contracts.mjs.
 * Do not edit by hand; run `npm run generate:agent-contracts`.
 */

/**
 * This interface was referenced by `LlmProfilesConfig`'s JSON-Schema
 * via the `definition` "Profile".
 */
export type Profile = {
  enabled: boolean;
  label: string;
  api_style: "anthropic_messages" | "openai_chat_completions" | "none";
  model?: string;
  model_env?: string;
  base_url_env?: string;
  auth?: Auth;
  header_envs?: {
    [k: string]: string;
  };
  limits?: ProfileLimits;
  /**
   * @minItems 1
   */
  data_classes: [
    "public_market_data" | "module_context" | "desk_simulated",
    ...("public_market_data" | "module_context" | "desk_simulated")[]
  ];
  uses: ("copilot" | "interpreter" | "narrator" | "drafter")[];
  fallback_profile?: string | null;
};

/**
 * settings/llm_profiles.json: named LLM access profiles. Only *_env fields may reference secrets or endpoints (llm-profiles/1).
 */
export interface LlmProfilesConfig {
  schema_version: "llm-profiles/1";
  default_profile: string;
  default_profile_env?: string;
  profiles: {
    [k: string]: Profile;
  };
}
/**
 * This interface was referenced by `LlmProfilesConfig`'s JSON-Schema
 * via the `definition` "Auth".
 */
export interface Auth {
  scheme: "provider_default" | "bearer" | "header" | "none";
  credential_env?: string;
  header_name?: string;
}
/**
 * This interface was referenced by `LlmProfilesConfig`'s JSON-Schema
 * via the `definition` "ProfileLimits".
 */
export interface ProfileLimits {
  max_output_tokens: number;
  timeout_ms: number;
  max_retries: number;
  per_job_token_cap: number;
  daily_token_budget: number | null;
}
