import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentQueueStore } from "@/lib/server/agent/queueStore";
import { GET } from "./route";
import { POST as probe } from "./[id]/probe/route";

const KEY = "sk-supersecretvalue12345";
const LOCAL_URL = "http://10.9.8.7:11434/v1";
const env = { ANTHROPIC_API_KEY: KEY, LOCAL_LLM_BASE_URL: LOCAL_URL, LOCAL_LLM_MODEL: "qwen3:14b" };
const list = () => GET(new Request("http://localhost/api/agent/profiles"));
const ping = (id: string) => probe(new Request(`http://localhost/api/agent/profiles/${id}/probe`, { method: "POST" }), { params: { id } });
let file = "";

// The probe cooldown is module state, so each test starts an hour later than the last.
let hour = 0;
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.UTC(2026, 9, 9, 12 + ++hour, 0, 0))); for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); if (file) fs.rmSync(file, { force: true }); file = ""; });

describe("GET /api/agent/profiles (dry-run states)", () => {
  it("reports each profile's state without any secret, URL, or environment value (AC-023)", async () => {
    const text = await (await list()).text();
    const body = JSON.parse(text) as { profiles: Array<{ id: string; state: string; model: string | null }> };
    const by = Object.fromEntries(body.profiles.map((p) => [p.id, p]));
    expect(by["anthropic-direct"]).toMatchObject({ state: "ready", model: "claude-opus-4-8" });
    expect(by["deterministic"]).toMatchObject({ state: "ready", model: null });
    expect(by["local-openai"]).toMatchObject({ state: "ready", model: "qwen3:14b" });
    expect(by["openai-direct"].state).toBe("LLM_PROFILE_NOT_ALLOWED"); // disabled in the registry
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("10.9.8.7");
    expect(text).not.toMatch(/https?:\/\//);
  });

  it("marks a profile unavailable when its credential is missing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const body = (await (await list()).json()) as { profiles: Array<{ id: string; state: string; detail: string | null }> };
    expect(body.profiles.find((p) => p.id === "anthropic-direct")).toMatchObject({ state: "LLM_PROFILE_UNAVAILABLE", detail: "ANTHROPIC_API_KEY is not set" });
  });

  it("includes today's usage when the queue database is configured", async () => {
    file = path.join(os.tmpdir(), `profiles-usage-${Date.now()}-${Math.random()}.db`);
    vi.stubEnv("AGENT_QUEUE_DB_URL", `sqlite:${file}`);
    await new AgentQueueStore().recordUsage("anthropic-direct", 40, 9);
    const body = (await (await list()).json()) as { queue_configured: boolean; profiles: Array<{ id: string; usage_today: unknown }> };
    expect(body.queue_configured).toBe(true);
    expect(body.profiles.find((p) => p.id === "anthropic-direct")?.usage_today).toEqual({ input_tokens: 40, output_tokens: 9 });
    expect(body.profiles.find((p) => p.id === "deterministic")?.usage_today).toBeNull();
  });

  it("is closed while the production gate is closed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await list()).status).toBe(503);
  });
});

describe("POST /api/agent/profiles/[id]/probe", () => {
  const chat = (content = "ok") => new Response(JSON.stringify({ model: "qwen3:14b-2025", choices: [{ message: { content } }] }), { status: 200 });

  it("makes one tiny completion and returns metadata only", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => chat());
    vi.stubGlobal("fetch", fetch);
    const response = await ping("local-openai");
    expect(await response.json()).toMatchObject({ profile: "local-openai", status: "ok", code: null, model: "qwen3:14b-2025" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(fetch.mock.calls[0][1]!.body));
    expect(sent).toMatchObject({ max_tokens: 8, messages: [{ role: "system", content: "Reply with the single word: ok" }, { role: "user", content: "ping" }] });
  });

  it("never returns a secret or URL, even when the provider echoes them in an error (AC-023)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: `bad ${KEY} at ${LOCAL_URL}` }), { status: 502 })));
    const text = await (await ping("local-openai")).text();
    expect(JSON.parse(text)).toMatchObject({ status: "failed", code: "LLM_PROVIDER_ERROR", model: null });
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("10.9.8.7");
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["code", "latency_ms", "model", "profile", "status"]);
  });

  it("reports unavailable and skipped profiles without calling out, and 404s unknown ones", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await (await ping("openai-direct")).json()).toMatchObject({ status: "unavailable", code: "LLM_PROFILE_NOT_ALLOWED" });
    expect(await (await ping("deterministic")).json()).toMatchObject({ status: "skipped" });
    expect((await ping("nope")).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rate limits repeat probes of one profile", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => chat()));
    expect((await ping("local-openai")).status).toBe(200);
    expect((await ping("local-openai")).status).toBe(429);
    vi.setSystemTime(new Date(Date.now() + 30_000));
    expect((await ping("local-openai")).status).toBe(200);
  });

  it("is closed while the production gate is closed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await ping("local-openai")).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
});
