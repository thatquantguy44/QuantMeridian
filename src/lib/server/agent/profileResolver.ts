/**
 * ECOIQ's view of the LLM profile layer (src/lib/server/llm). Resolution and the provider clients live
 * there; this keeps the small surface the attended executor and the job route use.
 */
import { callLlm, type LlmRequest } from "@/lib/server/llm/client";
import { localOptIn, resolveProfile, type ProfileErrorCode, type ResolvedCall } from "@/lib/server/llm/profiles";

type Env = Record<string, string | undefined>;

export type ResolvedProfile = {
  id: string;
  apiStyle: "none" | "openai_chat_completions" | "anthropic_messages";
  model: string | null;
  baseUrl: string | null;
  available: boolean;
  reason?: ProfileErrorCode;
  detail?: string;
  call?: ResolvedCall;
};

// ECOIQ sends governed Gold evidence and UI state only: public market data plus module context.
const ECOIQ_CLASSES = ["public_market_data", "module_context"] as const;

export function resolveLlmProfile(requested?: string | null, env: Env = process.env): ResolvedProfile {
  const resolved = resolveProfile({ requested: requested || undefined, use: "interpreter", dataClasses: ECOIQ_CLASSES }, { env, assumeEnabled: localOptIn(env) });
  if (!resolved.ok) return { id: resolved.profile_id, apiStyle: "none", model: null, baseUrl: null, available: false, reason: resolved.code, detail: resolved.detail };
  return { id: resolved.profile_id, apiStyle: resolved.api_style, model: resolved.model, baseUrl: resolved.base_url, available: true, call: resolved };
}

async function complete(profile: ResolvedProfile, system: string, user: string, json: boolean): Promise<string | null> {
  if (!profile.available || !profile.call || profile.apiStyle !== "openai_chat_completions") return null;
  const timeoutMs = Math.max(1000, Number(process.env.ECOIQ_STAGE_TIMEOUT_MS ?? 15000));
  const request: LlmRequest = {
    workflow_id: "economics", run_id: "attended", task_type: "interpretation", prompt_id: json ? "ecoiq.stage.json" : "ecoiq.text",
    system, user, temperature: 0.1, max_output_tokens: json ? 900 : 1200, data_classes: ECOIQ_CLASSES, correlation_id: "ecoiq",
    response_format: json ? { type: "json" } : null,
    // Local servers (Ollama): skip reasoning traces and ask for JSON natively.
    extra_body: { think: false, ...(json ? { format: "json" } : {}) },
  };
  const response = await callLlm({ ...profile.call, limits: { ...profile.call.limits, timeout_ms: timeoutMs } }, request);
  if (response.status === "failed") throw new Error(`${response.error_code}:${response.error_message_redacted ?? ""}`);
  return response.output_text;
}

export const completeWithProfile = (profile: ResolvedProfile, system: string, user: string) => complete(profile, system, user, false);
export const completeJsonWithProfile = (profile: ResolvedProfile, system: string, user: string) => complete(profile, system, user, true);
