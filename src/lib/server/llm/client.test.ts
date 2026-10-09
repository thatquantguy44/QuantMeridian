import { describe, expect, it, vi } from "vitest";
import type { LlmProfilesConfig } from "@/lib/agent/contracts/llm-profiles.generated";
import { callLlm, callLlmJson, type LlmRequest } from "./client";
import { resolveProfile, type ResolvedCall } from "./profiles";
import { redactMessage } from "./redact";

const ALL = ["public_market_data", "module_context", "desk_simulated"] as const;
const lim = { max_output_tokens: 700, timeout_ms: 5000, max_retries: 2, per_job_token_cap: 1000, daily_token_budget: null };
const base = { enabled: true, label: "t", data_classes: [...ALL], uses: ["copilot", "interpreter", "narrator", "drafter"] as const, limits: lim };
const config = (profiles: Record<string, object>) => ({ schema_version: "llm-profiles/1", default_profile: "p", profiles: { ...profiles, deterministic: { enabled: true, label: "d", api_style: "none", data_classes: [...ALL], uses: ["interpreter", "narrator"] } } }) as unknown as LlmProfilesConfig;
const request = (over: Partial<LlmRequest> = {}): LlmRequest => ({ workflow_id: "chart.build", run_id: "job-1", task_type: "interpretation", prompt_id: "p1", system: "SYS", user: "USER", data_classes: ["public_market_data"], correlation_id: "c1", ...over });
const KEY = "sk-supersecretvalue12345";
const resolve = (cfg: LlmProfilesConfig, env: Record<string, string>) => resolveProfile({ use: "interpreter", dataClasses: ["public_market_data"] }, { env, config: cfg }) as ResolvedCall;
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noSleep = async () => {};

describe("openai_chat_completions client", () => {
  const cfg = config({ p: { ...base, api_style: "openai_chat_completions", base_url_env: "GW", model_env: "GWM", auth: { scheme: "bearer", credential_env: "GWK" }, header_envs: { "X-Tenant": "TENANT" } } });
  const env = { GW: "https://llm.test/v1", GWM: "alias", GWK: KEY, TENANT: "t-9" };

  it("sends the documented request and normalizes the response", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => ok({ model: "alias-2025", choices: [{ message: { content: "hello" } }], usage: { prompt_tokens: 11, completion_tokens: 4 } }));
    const out = await callLlm(resolve(cfg, env), request({ temperature: 0.1 }), { env, config: cfg, fetch, now: () => 5 });
    const [url, init] = fetch.mock.calls[0]; const sent = JSON.parse(String(init!.body)); const headers = init!.headers as Record<string, string>;
    expect(url).toBe("https://llm.test/v1/chat/completions");
    expect(headers).toMatchObject({ authorization: `Bearer ${KEY}`, "x-tenant": "t-9", "content-type": "application/json" });
    expect(sent).toEqual({ model: "alias", max_tokens: 700, temperature: 0.1, messages: [{ role: "system", content: "SYS" }, { role: "user", content: "USER" }] });
    expect(sent.tools).toBeUndefined();
    expect(out).toMatchObject({ status: "completed", provider_style: "openai_chat_completions", model: "alias-2025", output_text: "hello", usage: { input_tokens: 11, output_tokens: 4, cost_estimate: null }, retryable: false, error_code: null });
  });

  it("sends json_object or json_schema response formats and merges extra_body last", async () => {
    const fetch = vi.fn(async () => ok({ choices: [{ message: { content: "{}" } }] }));
    await callLlm(resolve(cfg, env), request({ response_format: { type: "json" }, extra_body: { think: false } }), { env, config: cfg, fetch });
    await callLlm(resolve(cfg, env), request({ response_format: { type: "json", schema: { type: "object" } } }), { env, config: cfg, fetch });
    const first = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)); const second = JSON.parse(String((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(first).toMatchObject({ response_format: { type: "json_object" }, think: false });
    expect(second.response_format).toEqual({ type: "json_schema", json_schema: { name: "result", schema: { type: "object" }, strict: false } });
  });

  it("retries 429 and 5xx up to max_retries then reports a retryable provider error", async () => {
    const fetch = vi.fn(async () => ok({}, 429));
    const out = await callLlm(resolve(cfg, env), request(), { env, config: cfg, fetch, sleep: noSleep });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(out).toMatchObject({ status: "failed", error_code: "LLM_PROVIDER_ERROR", retryable: true, error_message_redacted: "provider returned HTTP 429" });
  });

  it("recovers when a retry succeeds", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(ok({}, 503)).mockResolvedValueOnce(ok({ choices: [{ message: { content: "fine" } }] }));
    expect((await callLlm(resolve(cfg, env), request(), { env, config: cfg, fetch, sleep: noSleep })).output_text).toBe("fine");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry other 4xx and marks them non-retryable", async () => {
    const fetch = vi.fn(async () => ok({ error: { message: `bad key ${KEY}` } }, 401));
    const out = await callLlm(resolve(cfg, env), request(), { env, config: cfg, fetch, sleep: noSleep });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ status: "failed", retryable: false });
  });

  it("treats timeouts as retryable and never leaks secrets or URLs in the message", async () => {
    const timeout = Object.assign(new Error(`fetch to https://llm.test/v1 with ${KEY} timed out`), { name: "TimeoutError" });
    const out = await callLlm(resolve(cfg, env), request(), { env, config: cfg, fetch: async () => { throw timeout; }, sleep: noSleep });
    expect(out).toMatchObject({ status: "failed", retryable: true, error_code: "LLM_PROVIDER_ERROR" });
    const network = await callLlm(resolve(cfg, env), request(), { env, config: cfg, fetch: async () => { throw new TypeError(`connect failed https://llm.test/v1 Bearer ${KEY}`); }, sleep: noSleep });
    expect(JSON.stringify(network)).not.toContain(KEY);
    expect(JSON.stringify(network)).not.toContain("llm.test");
  });

  it("reports a response without text as invalid output", async () => {
    const out = await callLlm(resolve(cfg, env), request(), { env, config: cfg, fetch: async () => ok({ choices: [{ message: { content: null } }] }) });
    expect(out).toMatchObject({ status: "failed", error_code: "LLM_OUTPUT_INVALID" });
  });
});

describe("anthropic_messages client", () => {
  const message = (text = "hi") => ok({ id: "m1", type: "message", role: "assistant", model: "claude-x", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 7, output_tokens: 3 } });

  it("sends x-api-key to the default endpoint with system, user, and the profile's token limit", async () => {
    const cfg = config({ p: { ...base, api_style: "anthropic_messages", model: "claude-test", auth: { scheme: "provider_default", credential_env: "ANTHROPIC_API_KEY" } } });
    const env = { ANTHROPIC_API_KEY: KEY };
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => message());
    const out = await callLlm(resolve(cfg, env), request(), { env, config: cfg, fetch });
    const [url, init] = fetch.mock.calls[0]; const headers = new Headers(init!.headers); const sent = JSON.parse(String(init!.body));
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    expect(headers.get("x-api-key")).toBe(KEY);
    expect(sent).toEqual({ model: "claude-test", max_tokens: 700, system: "SYS", messages: [{ role: "user", content: "USER" }] });
    expect(out).toMatchObject({ status: "completed", provider_style: "anthropic_messages", model: "claude-x", output_text: "hi", usage: { input_tokens: 7, output_tokens: 3 } });
  });

  it("uses a bearer token and a gateway base URL for the gateway profile", async () => {
    const cfg = config({ p: { ...base, api_style: "anthropic_messages", base_url_env: "GW", model_env: "GWM", auth: { scheme: "bearer", credential_env: "GWK" }, header_envs: { "X-Route": "ROUTE" } } });
    const env = { GW: "https://gw.test/anthropic", GWM: "alias", GWK: KEY, ROUTE: "r1" };
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => message());
    await callLlm(resolve(cfg, env), request(), { env, config: cfg, fetch });
    const [url, init] = fetch.mock.calls[0]; const headers = new Headers(init!.headers);
    expect(String(url)).toBe("https://gw.test/anthropic/v1/messages");
    expect(headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(headers.get("x-api-key")).toBeNull();
    expect(headers.get("x-route")).toBe("r1");
  });

  it("swaps in a custom auth header on the wire", async () => {
    const cfg = config({ p: { ...base, api_style: "anthropic_messages", model: "m", base_url_env: "GW", auth: { scheme: "header", credential_env: "K", header_name: "api-key" } } });
    const env = { GW: "https://gw.test", K: KEY };
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => message());
    await callLlm(resolve(cfg, env), request(), { env, config: cfg, fetch });
    const headers = new Headers(fetch.mock.calls[0][1]!.headers);
    expect(headers.get("api-key")).toBe(KEY);
    expect(headers.get("x-api-key")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
  });

  it("maps provider errors to LLM_PROVIDER_ERROR with redacted text", async () => {
    const cfg = config({ p: { ...base, limits: { ...lim, max_retries: 0 }, api_style: "anthropic_messages", model: "m", auth: { scheme: "provider_default", credential_env: "K" } } });
    const env = { K: KEY };
    const out = await callLlm(resolve(cfg, env), request(), { env, config: cfg, fetch: async () => ok({ type: "error", error: { type: "authentication_error", message: `invalid ${KEY}` } }, 401) });
    expect(out).toMatchObject({ status: "failed", error_code: "LLM_PROVIDER_ERROR", retryable: false });
    expect(JSON.stringify(out)).not.toContain(KEY);
  });
});

describe("skipped calls", () => {
  it("does nothing for the deterministic profile and for dry runs", async () => {
    const cfg = config({ p: { ...base, api_style: "none" } });
    const fetch = vi.fn();
    const none = await callLlm(resolve(cfg, {}), request(), { config: cfg, fetch });
    expect(none).toMatchObject({ status: "skipped", provider_style: "none", output_text: null });
    const cfg2 = config({ p: { ...base, api_style: "openai_chat_completions", model: "m", auth: { scheme: "none" } } });
    const dry = await callLlm(resolve(cfg2, {}), request({ dry_run: true }), { config: cfg2, fetch });
    expect(dry.status).toBe("skipped");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("callLlmJson", () => {
  const cfg = config({ p: { ...base, api_style: "openai_chat_completions", model: "m", base_url_env: "B", auth: { scheme: "none" } } });
  const env = { B: "http://h/v1" };
  const isShape = (v: unknown): v is { n: number } => typeof (v as { n?: unknown })?.n === "number";
  const reply = (text: string) => async () => ok({ choices: [{ message: { content: text } }] });

  it("parses JSON, including fenced output, and validates it", async () => {
    const out = await callLlmJson(resolve(cfg, env), request(), isShape, { env, config: cfg, fetch: reply("```json\n{\"n\": 3}\n```") });
    expect(out).toMatchObject({ status: "completed", value: { n: 3 } });
  });

  it("never repairs: bad JSON and wrong shapes are LLM_OUTPUT_INVALID", async () => {
    for (const text of ["not json", "{\"n\": \"3\"}", "{\"n\": 3} trailing"]) {
      const out = await callLlmJson(resolve(cfg, env), request(), isShape, { env, config: cfg, fetch: reply(text) });
      expect(out).toMatchObject({ status: "failed", error_code: "LLM_OUTPUT_INVALID", value: null });
    }
  });
});

describe("redactMessage", () => {
  it("removes configured secret values, bearer tokens, key-shaped strings, and URLs", () => {
    const text = redactMessage(`Bearer abcdefgh12345678 key=${KEY} ${"https://u:p@h.test/x?k=1"} custom-secret-value`, ["CUSTOM"], { CUSTOM: "custom-secret-value" });
    expect(text).not.toMatch(/abcdefgh12345678|supersecret|h\.test|custom-secret-value/);
    expect(text).toContain("[url]");
  });
});
