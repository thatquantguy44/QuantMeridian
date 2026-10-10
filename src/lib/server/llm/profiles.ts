/**
 * Profile resolution (spec009 REQ-019, REQ-020): precedence, fail-closed checks, and the exact
 * call a profile would make (endpoint, auth header name, extra header names, model, limits).
 * Pure: takes the registry and an environment map. The worker's agent_worker/llm/profiles.py
 * resolves the same fixtures (contracts/agent/fixtures/llm-profiles/).
 */
import registry from "../../../../settings/llm_profiles.json";
import type { LlmProfilesConfig, Profile, ProfileLimits } from "@/lib/agent/contracts/llm-profiles.generated";

type Env = Record<string, string | undefined>;
export type LlmUse = "copilot" | "interpreter" | "narrator" | "drafter";
export type DataClass = "public_market_data" | "module_context" | "desk_simulated";
export type ProfileErrorCode = "LLM_PROFILE_UNKNOWN" | "LLM_PROFILE_NOT_ALLOWED" | "LLM_PROFILE_UNAVAILABLE";

export const DEFAULT_LIMITS: ProfileLimits = { max_output_tokens: 1500, timeout_ms: 60000, max_retries: 2, per_job_token_cap: 20000, daily_token_budget: null };
const PROVIDER_BASE = { anthropic_messages: "https://api.anthropic.com", openai_chat_completions: "https://api.openai.com/v1" } as const;

export interface ResolveInput {
  /** The profile the user picked (honored only when the caller has checked the module allows it). */
  requested?: string | null;
  moduleDefault?: string | null;
  use: LlmUse;
  dataClasses: readonly DataClass[];
  /** Optional workflows degrade a non-user-picked failure to `deterministic`; required ones fail. */
  optional?: boolean;
}

export interface ResolveOptions {
  env?: Env;
  config?: LlmProfilesConfig;
  /** Profiles treated as enabled regardless of the registry flag (the documented local-model opt-in). */
  assumeEnabled?: readonly string[];
}

export interface ResolvedCall {
  ok: true;
  profile_id: string;
  api_style: Profile["api_style"];
  model: string | null;
  /** Full request URL, or null for `none`. Never serialized to browsers. */
  endpoint_url: string | null;
  base_url: string | null;
  /** Header that carries the credential (lower case), or null. */
  auth_header: string | null;
  /** Names only; the values come from the environment at call time. */
  extra_header_names: string[];
  limits: ProfileLimits;
  fallback_profile: string | null;
  /** Set when an optional workflow degraded to `deterministic`: the code that caused it. */
  degraded_from?: { profile_id: string; code: ProfileErrorCode };
}
export interface ResolveFailure { ok: false; profile_id: string; code: ProfileErrorCode; detail?: string }
export type Resolution = ResolvedCall | ResolveFailure;

const config = () => registry as unknown as LlmProfilesConfig;
const present = (env: Env, name: string | undefined) => Boolean(name && env[name]?.trim());

export function candidateId(input: Pick<ResolveInput, "requested" | "moduleDefault">, options: ResolveOptions = {}): string {
  const cfg = options.config ?? config();
  const env = options.env ?? process.env;
  const fromEnv = cfg.default_profile_env ? env[cfg.default_profile_env]?.trim() : undefined;
  return input.requested || input.moduleDefault || fromEnv || cfg.default_profile;
}

function resolveOne(id: string, input: ResolveInput, options: ResolveOptions): Resolution {
  const cfg = options.config ?? config();
  const env = options.env ?? process.env;
  const profile = cfg.profiles[id];
  if (!profile) return { ok: false, profile_id: id, code: "LLM_PROFILE_UNKNOWN" };
  const enabled = profile.enabled || options.assumeEnabled?.includes(id);
  if (!enabled) return { ok: false, profile_id: id, code: "LLM_PROFILE_NOT_ALLOWED", detail: "profile is disabled" };
  if (!profile.uses.includes(input.use)) return { ok: false, profile_id: id, code: "LLM_PROFILE_NOT_ALLOWED", detail: `profile does not allow ${input.use}` };
  const missingClass = input.dataClasses.find((c) => !profile.data_classes.includes(c));
  if (missingClass) return { ok: false, profile_id: id, code: "LLM_PROFILE_NOT_ALLOWED", detail: `profile is not approved for ${missingClass}` };

  const limits = profile.limits ?? DEFAULT_LIMITS;
  if (profile.api_style === "none") {
    return { ok: true, profile_id: id, api_style: "none", model: null, endpoint_url: null, base_url: null, auth_header: null, extra_header_names: [], limits, fallback_profile: profile.fallback_profile ?? null };
  }

  const model = (profile.model_env && env[profile.model_env]?.trim()) || profile.model || null;
  if (!model) return { ok: false, profile_id: id, code: "LLM_PROFILE_UNAVAILABLE", detail: "no model configured" };
  if (profile.base_url_env && !present(env, profile.base_url_env)) return { ok: false, profile_id: id, code: "LLM_PROFILE_UNAVAILABLE", detail: `${profile.base_url_env} is not set` };
  const auth = profile.auth ?? { scheme: "provider_default" as const };
  if (auth.scheme !== "none" && !present(env, auth.credential_env)) return { ok: false, profile_id: id, code: "LLM_PROFILE_UNAVAILABLE", detail: `${auth.credential_env ?? "credential"} is not set` };
  const headerEnvs = Object.entries(profile.header_envs ?? {});
  const missingHeader = headerEnvs.find(([, name]) => !present(env, name));
  if (missingHeader) return { ok: false, profile_id: id, code: "LLM_PROFILE_UNAVAILABLE", detail: `${missingHeader[1]} is not set` };

  const base = (profile.base_url_env ? env[profile.base_url_env]!.trim() : PROVIDER_BASE[profile.api_style]).replace(/\/+$/, "");
  const endpoint = profile.api_style === "anthropic_messages" ? `${base.replace(/\/v1$/, "")}/v1/messages` : `${base}/chat/completions`;
  let authHeader: string | null = null;
  if (auth.scheme === "header") authHeader = (auth.header_name ?? "").toLowerCase() || null;
  else if (auth.scheme === "bearer") authHeader = "authorization";
  else if (auth.scheme === "provider_default") authHeader = profile.api_style === "anthropic_messages" ? "x-api-key" : "authorization";
  return {
    ok: true, profile_id: id, api_style: profile.api_style, model, endpoint_url: endpoint, base_url: base, auth_header: authHeader,
    extra_header_names: headerEnvs.map(([header]) => header.toLowerCase()).sort(), limits, fallback_profile: profile.fallback_profile ?? null,
  };
}

/**
 * Precedence: user-picked → module default → env default → registry default. A user-picked profile
 * never degrades silently. An optional workflow whose *default* profile fails falls back to
 * `deterministic` and records why; a required workflow fails with the code.
 */
export function resolveProfile(input: ResolveInput, options: ResolveOptions = {}): Resolution {
  const id = candidateId(input, options);
  const first = resolveOne(id, input, options);
  if (first.ok || !input.optional || input.requested) return first;
  const deterministic = resolveOne("deterministic", { ...input, use: input.use }, options);
  return deterministic.ok ? { ...deterministic, degraded_from: { profile_id: id, code: first.code } } : first;
}

/** Each registry profile's state for a use and data classes: what a dry run reports (no network). */
export function profileStates(use: LlmUse, dataClasses: readonly DataClass[], options: ResolveOptions = {}) {
  const cfg = options.config ?? config();
  return Object.entries(cfg.profiles).map(([id, profile]) => {
    const resolved = resolveOne(id, { use, dataClasses }, options);
    return { id, label: profile.label, api_style: profile.api_style, enabled: profile.enabled, state: resolved.ok ? ("ready" as const) : resolved.code, detail: resolved.ok ? null : resolved.detail ?? null, model: resolved.ok ? resolved.model : null };
  });
}

/**
 * ECOIQ.md documents selecting the local model by setting LOCAL_LLM_BASE_URL and LOCAL_LLM_MODEL, without
 * editing the registry. Callers pass this as `assumeEnabled`.
 */
export function localOptIn(env: Env = process.env): readonly string[] {
  return env.LOCAL_LLM_BASE_URL?.trim() && env.LOCAL_LLM_MODEL?.trim() ? ["local-openai"] : [];
}
