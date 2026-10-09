import { afterEach, describe, expect, it, vi } from "vitest";
import { completeJsonWithProfile, resolveLlmProfile } from "./profileResolver";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const local = { LOCAL_LLM_BASE_URL: "http://127.0.0.1:11434/v1", LOCAL_LLM_MODEL: "qwen3:14b" };

describe("ECOIQ profile resolution", () => {
  it("defaults to the registry default, which needs a key and so is unavailable without one", () => {
    expect(resolveLlmProfile(null, {})).toMatchObject({ id: "anthropic-direct", available: false, reason: "LLM_PROFILE_UNAVAILABLE" });
    expect(resolveLlmProfile(null, { ANTHROPIC_API_KEY: "k".repeat(20) })).toMatchObject({ id: "anthropic-direct", available: true, apiStyle: "anthropic_messages" });
  });

  it("selects the deterministic profile with no model call", () => {
    expect(resolveLlmProfile("deterministic", {})).toMatchObject({ id: "deterministic", available: true, apiStyle: "none", model: null });
  });

  it("enables local-openai through its two environment variables only", () => {
    expect(resolveLlmProfile("local-openai", {})).toMatchObject({ available: false, reason: "LLM_PROFILE_NOT_ALLOWED" });
    expect(resolveLlmProfile("local-openai", local)).toMatchObject({ available: true, apiStyle: "openai_chat_completions", model: "qwen3:14b", baseUrl: "http://127.0.0.1:11434/v1" });
  });

  it("reports unknown profiles", () => {
    expect(resolveLlmProfile("nope", {})).toMatchObject({ available: false, reason: "LLM_PROFILE_UNKNOWN" });
  });
});

describe("ECOIQ completions", () => {
  it("sends the local-model request (JSON mode, think off, no auth) and returns the text", async () => {
    for (const [k, v] of Object.entries(local)) vi.stubEnv(k, v);
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: "{\"summary\":\"s\",\"claims\":[]}" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const text = await completeJsonWithProfile(resolveLlmProfile("local-openai"), "SYS", "USER");
    expect(text).toBe("{\"summary\":\"s\",\"claims\":[]}");
    const [url, init] = fetch.mock.calls[0]; const body = JSON.parse(String(init!.body));
    expect(url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(body).toMatchObject({ model: "qwen3:14b", think: false, format: "json", response_format: { type: "json_object" }, temperature: 0.1, max_tokens: 900 });
    expect(Object.keys(init!.headers as object)).not.toContain("authorization");
  });

  it("returns null for profiles that make no call and throws a coded error on provider failure", async () => {
    expect(await completeJsonWithProfile(resolveLlmProfile("deterministic", {}), "s", "u")).toBeNull();
    for (const [k, v] of Object.entries(local)) vi.stubEnv(k, v);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await expect(completeJsonWithProfile(resolveLlmProfile("local-openai"), "s", "u")).rejects.toThrow("LLM_PROVIDER_ERROR");
  });
});
