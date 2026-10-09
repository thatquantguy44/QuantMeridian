/**
 * Provider clients (spec009 T-005). Both API styles are normalized to the shape of QuantSmith's
 * `adapters/llm_runtime` contract. No tools are ever sent, streaming is not used, and JSON output is
 * validated here, never repaired: invalid output is `LLM_OUTPUT_INVALID`.
 *
 * `anthropic_messages` uses `@anthropic-ai/sdk`. `openai_chat_completions` uses plain `fetch`, so no
 * OpenAI package is required: OpenAI, Azure OpenAI v1 endpoints, LiteLLM, OpenRouter, vLLM, Ollama,
 * and llama.cpp servers all speak the same `/chat/completions` request.
 */
import Anthropic from "@anthropic-ai/sdk";
import profilesJson from "../../../../settings/llm_profiles.json";
import type { LlmProfilesConfig } from "@/lib/agent/contracts/llm-profiles.generated";
import { redactMessage } from "./redact";
import type { DataClass, ResolvedCall } from "./profiles";

type Env = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type TaskType = "interpretation" | "narration" | "drafting" | "copilot";
export type LlmErrorCode = "LLM_PROVIDER_ERROR" | "LLM_OUTPUT_INVALID" | "LLM_PROFILE_UNAVAILABLE";

export interface LlmRequest {
  workflow_id: string;
  /** The job id. */
  run_id: string;
  task_type: TaskType;
  prompt_id: string;
  prompt_sha256?: string;
  input_artifact_hashes?: string[];
  system: string;
  user: string;
  temperature?: number;
  max_output_tokens?: number;
  /** `json` asks for a JSON object; with a schema it is sent as a JSON Schema where the style supports it. */
  response_format?: { type: "json"; schema?: Record<string, unknown> } | null;
  data_classes: readonly DataClass[];
  correlation_id: string;
  dry_run?: boolean;
  /** Provider-specific body fields (for example Ollama's `think: false`). Merged last. */
  extra_body?: Record<string, unknown>;
}

export interface LlmResponse {
  adapter_name: string;
  provider_style: ResolvedCall["api_style"];
  model: string | null;
  status: "completed" | "skipped" | "failed";
  output_text: string | null;
  usage: { input_tokens: number | null; output_tokens: number | null; cost_estimate: number | null };
  retryable: boolean;
  error_code: LlmErrorCode | null;
  error_message_redacted: string | null;
  latency_ms: number;
}

export interface ClientDeps { env?: Env; fetch?: FetchLike; now?: () => number; sleep?: (ms: number) => Promise<void>; config?: LlmProfilesConfig }

const RETRYABLE = new Set([408, 409, 429]);
const isRetryableStatus = (status: number) => RETRYABLE.has(status) || status >= 500;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function secretEnvNames(call: ResolvedCall, config: LlmProfilesConfig): string[] {
  const profile = config.profiles[call.profile_id];
  return [profile?.auth?.credential_env, ...Object.values(profile?.header_envs ?? {})].filter((name): name is string => Boolean(name));
}

function failure(call: ResolvedCall, started: number, now: () => number, code: LlmErrorCode, message: string, retryable: boolean, names: string[], env: Env): LlmResponse {
  return {
    adapter_name: `${call.api_style}`, provider_style: call.api_style, model: call.model, status: "failed", output_text: null,
    usage: { input_tokens: null, output_tokens: null, cost_estimate: null }, retryable, error_code: code,
    error_message_redacted: redactMessage(message, names, env), latency_ms: Math.max(0, now() - started),
  };
}

/** Headers for the credential and the profile's extra header values, read from the environment at call time. */
function headersFor(call: ResolvedCall, config: LlmProfilesConfig, env: Env): Record<string, string> {
  const profile = config.profiles[call.profile_id];
  const headers: Record<string, string> = {};
  const auth = profile?.auth;
  const credential = auth?.credential_env ? env[auth.credential_env]?.trim() : undefined;
  if (call.auth_header && credential) headers[call.auth_header] = call.auth_header === "authorization" ? `Bearer ${credential}` : credential;
  for (const [header, name] of Object.entries(profile?.header_envs ?? {})) {
    const value = env[name]?.trim(); if (value) headers[header.toLowerCase()] = value;
  }
  return headers;
}

async function callOpenAiStyle(call: ResolvedCall, request: LlmRequest, config: LlmProfilesConfig, deps: Required<Pick<ClientDeps, "fetch" | "now" | "sleep">> & { env: Env }): Promise<LlmResponse> {
  const started = deps.now(); const names = secretEnvNames(call, config);
  const body: Record<string, unknown> = {
    model: call.model, max_tokens: request.max_output_tokens ?? call.limits.max_output_tokens,
    messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }],
  };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.response_format) body.response_format = request.response_format.schema
    ? { type: "json_schema", json_schema: { name: "result", schema: request.response_format.schema, strict: false } }
    : { type: "json_object" };
  Object.assign(body, request.extra_body ?? {});
  const headers = { "content-type": "application/json", ...headersFor(call, config, deps.env) };

  let lastMessage = "provider call failed"; let lastRetryable = false;
  for (let attempt = 0; attempt <= call.limits.max_retries; attempt++) {
    if (attempt > 0) await deps.sleep(Math.min(8000, 500 * 2 ** (attempt - 1)));
    try {
      const response = await deps.fetch(call.endpoint_url!, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(call.limits.timeout_ms) });
      if (!response.ok) {
        lastRetryable = isRetryableStatus(response.status); lastMessage = `provider returned HTTP ${response.status}`;
        if (lastRetryable) continue;
        return failure(call, started, deps.now, "LLM_PROVIDER_ERROR", lastMessage, false, names, deps.env);
      }
      const payload = await response.json() as { model?: string; choices?: Array<{ message?: { content?: unknown } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string") return failure(call, started, deps.now, "LLM_OUTPUT_INVALID", "response had no text content", false, names, deps.env);
      return {
        adapter_name: "openai_chat_completions", provider_style: "openai_chat_completions", model: payload.model ?? call.model, status: "completed", output_text: content,
        usage: { input_tokens: payload.usage?.prompt_tokens ?? null, output_tokens: payload.usage?.completion_tokens ?? null, cost_estimate: null },
        retryable: false, error_code: null, error_message_redacted: null, latency_ms: Math.max(0, deps.now() - started),
      };
    } catch (error) {
      const name = (error as Error).name; lastRetryable = name === "TimeoutError" || name === "AbortError" || name === "TypeError";
      lastMessage = name === "TimeoutError" || name === "AbortError" ? "provider call timed out" : `provider call failed: ${(error as Error).message}`;
      if (!lastRetryable) break;
    }
  }
  return failure(call, started, deps.now, "LLM_PROVIDER_ERROR", lastMessage, lastRetryable, names, deps.env);
}

async function callAnthropicStyle(call: ResolvedCall, request: LlmRequest, config: LlmProfilesConfig, deps: Required<Pick<ClientDeps, "fetch" | "now">> & { env: Env }): Promise<LlmResponse> {
  const started = deps.now(); const names = secretEnvNames(call, config);
  const profile = config.profiles[call.profile_id]; const auth = profile.auth ?? { scheme: "provider_default" as const };
  const credential = auth.credential_env ? deps.env[auth.credential_env]?.trim() : undefined;
  const extra = headersFor(call, config, deps.env);
  delete extra["x-api-key"]; delete extra.authorization;
  const customHeader = auth.scheme === "header" && call.auth_header && credential ? { [call.auth_header]: credential } : {};
  const baseFetch = deps.fetch;
  // The SDK always sends x-api-key/Authorization; for a custom auth header, swap it in on the wire.
  const fetchImpl: FetchLike = auth.scheme === "header" && call.auth_header
    ? (input, init) => { const h = new Headers(init?.headers); h.delete("x-api-key"); h.delete("authorization"); return baseFetch(input, { ...init, headers: h }); }
    : baseFetch;
  try {
    const client = new Anthropic({
      apiKey: auth.scheme === "provider_default" || auth.scheme === "header" ? credential ?? "unused" : null,
      authToken: auth.scheme === "bearer" ? credential ?? null : null,
      baseURL: call.base_url!, defaultHeaders: { ...extra, ...customHeader }, timeout: call.limits.timeout_ms, maxRetries: call.limits.max_retries, fetch: fetchImpl as never,
    });
    const system = request.response_format ? `${request.system}\n\nRespond with a single JSON object and nothing else.` : request.system;
    const response = await client.messages.create({
      model: call.model!, max_tokens: request.max_output_tokens ?? call.limits.max_output_tokens, system,
      messages: [{ role: "user", content: request.user }], ...(request.temperature !== undefined ? { temperature: request.temperature } : {}), ...((request.extra_body ?? {}) as object),
    });
    const text = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
    if (!text) return failure(call, started, deps.now, "LLM_OUTPUT_INVALID", "response had no text content", false, names, deps.env);
    return {
      adapter_name: "anthropic_messages", provider_style: "anthropic_messages", model: response.model ?? call.model, status: "completed", output_text: text.text,
      usage: { input_tokens: response.usage?.input_tokens ?? null, output_tokens: response.usage?.output_tokens ?? null, cost_estimate: null },
      retryable: false, error_code: null, error_message_redacted: null, latency_ms: Math.max(0, deps.now() - started),
    };
  } catch (error) {
    const status = (error as { status?: number }).status; const name = (error as Error).name;
    const timeout = /Timeout/i.test(name);
    const retryable = timeout || status === undefined || isRetryableStatus(status);
    const message = timeout ? "provider call timed out" : status ? `provider returned HTTP ${status}` : `provider call failed: ${(error as Error).message}`;
    return failure(call, started, deps.now, "LLM_PROVIDER_ERROR", message, retryable, names, deps.env);
  }
}

/** One normalized completion. Never throws; failures come back as `status: "failed"` with a stable code. */
export async function callLlm(call: ResolvedCall, request: LlmRequest, deps: ClientDeps = {}): Promise<LlmResponse> {
  const env = deps.env ?? process.env; const now = deps.now ?? Date.now;
  const config = deps.config ?? (profilesJson as unknown as LlmProfilesConfig);
  const skipped = (reason: string): LlmResponse => ({
    adapter_name: call.api_style, provider_style: call.api_style, model: call.model, status: "skipped", output_text: null,
    usage: { input_tokens: null, output_tokens: null, cost_estimate: null }, retryable: false, error_code: null, error_message_redacted: reason, latency_ms: 0,
  });
  if (call.api_style === "none") return skipped("deterministic profile; no model call");
  if (request.dry_run) return skipped("dry run; no model call");
  const fetchImpl: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const shared = { env, fetch: fetchImpl, now, sleep: deps.sleep ?? wait };
  return call.api_style === "anthropic_messages" ? callAnthropicStyle(call, request, config, shared) : callOpenAiStyle(call, request, config, shared);
}

const stripFences = (text: string) => text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

/** A completion whose text must parse as JSON and pass `validate`. Invalid output is never repaired. */
export async function callLlmJson<T>(call: ResolvedCall, request: LlmRequest, validate: (value: unknown) => value is T, deps: ClientDeps = {}): Promise<LlmResponse & { value: T | null }> {
  const response = await callLlm(call, { ...request, response_format: request.response_format ?? { type: "json" } }, deps);
  if (response.status !== "completed" || response.output_text === null) return { ...response, value: null };
  try {
    const parsed = JSON.parse(stripFences(response.output_text)) as unknown;
    if (validate(parsed)) return { ...response, value: parsed };
  } catch { /* falls through to LLM_OUTPUT_INVALID */ }
  return { ...response, status: "failed", error_code: "LLM_OUTPUT_INVALID", error_message_redacted: "model output was not valid for the expected schema", value: null };
}
