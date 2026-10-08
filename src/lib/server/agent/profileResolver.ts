import profiles from "../../../../settings/llm_profiles.json";

export type ResolvedProfile = { id: string; apiStyle: "none" | "openai_chat_completions" | "anthropic_messages"; model: string | null; baseUrl: string | null; available: boolean; reason?: string };

export function resolveLlmProfile(requested?: string | null, env: Record<string, string | undefined> = process.env): ResolvedProfile {
  const id = requested || env.LLM_PROFILE_DEFAULT || profiles.default_profile;
  const raw = profiles.profiles[id as keyof typeof profiles.profiles] as any;
  if (!raw) return { id, apiStyle: "none", model: null, baseUrl: null, available: false, reason: "LLM_PROFILE_UNKNOWN" };
  const localOptIn = id === "local-openai" && Boolean(env.LOCAL_LLM_BASE_URL && env.LOCAL_LLM_MODEL);
  if (!raw.enabled && !localOptIn) return { id, apiStyle: raw.api_style, model: null, baseUrl: null, available: false, reason: "LLM_PROFILE_UNAVAILABLE" };
  const model = raw.model ?? (raw.model_env ? env[raw.model_env] : null) ?? null;
  const baseUrl = raw.base_url_env ? env[raw.base_url_env] ?? null : null;
  if (raw.api_style === "none") return { id, apiStyle: "none", model: null, baseUrl: null, available: true };
  const credential = raw.auth?.credential_env ? env[raw.auth.credential_env] : "local";
  if (!model || (raw.api_style !== "openai_chat_completions" && !credential)) return { id, apiStyle: raw.api_style, model, baseUrl, available: false, reason: "LLM_PROFILE_UNAVAILABLE" };
  if (raw.api_style === "openai_chat_completions" && !baseUrl && !credential) return { id, apiStyle: raw.api_style, model, baseUrl, available: false, reason: "LLM_PROFILE_UNAVAILABLE" };
  return { id, apiStyle: raw.api_style, model, baseUrl, available: true };
}

export async function completeWithProfile(profile: ResolvedProfile, system: string, user: string): Promise<string | null> {
  if (!profile.available || profile.apiStyle === "none" || profile.apiStyle !== "openai_chat_completions" || !profile.model) return null;
  const endpoint = `${profile.baseUrl ?? "http://127.0.0.1:11434/v1"}/chat/completions`;
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: profile.model, think: false, temperature: 0.1, max_tokens: 1200, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) });
  if (!response.ok) throw new Error(`LLM_PROVIDER_ERROR:${response.status}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content ?? null;
}
