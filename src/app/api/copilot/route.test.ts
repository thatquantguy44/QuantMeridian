import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocked SDK (spec009 T-006, AC-022): the default Copilot request must reach messages.create exactly as
// it did before the profile layer: model, system prompt, messages, and token limit, with nothing added.
const sdk = vi.hoisted(() => ({ create: vi.fn(), ctor: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { constructor(options: unknown) { sdk.ctor(options); } messages = { create: sdk.create }; },
}));
vi.mock("@/lib/server/copilotContext", () => ({ buildCopilotContext: () => ({ desk: "snapshot", n: 3 }) }));
import { POST } from "./route";

const ask = (question = "Why did revenue fall?") => POST(new Request("http://localhost/api/copilot", { method: "POST", body: JSON.stringify({ question }) }));
const reply = (text: string) => ({ model: "claude-opus-4-8", content: [{ type: "text", text }], usage: { input_tokens: 120, output_tokens: 30 } });

beforeEach(() => { sdk.create.mockReset(); sdk.ctor.mockReset(); vi.stubEnv("ANTHROPIC_API_KEY", "k".repeat(24)); vi.stubEnv("LLM_PROFILE_DEFAULT", ""); });
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/copilot (AC-022)", () => {
  it("sends the same default request as before the profile layer", async () => {
    sdk.create.mockResolvedValue(reply('{"text":"Revenue fell on lower spreads.","bullets":["a"]}'));
    await ask();
    expect(sdk.create).toHaveBeenCalledTimes(1);
    const params = sdk.create.mock.calls[0][0];
    expect(Object.keys(params).sort()).toEqual(["max_tokens", "messages", "model", "system"]);
    expect(params.model).toBe("claude-opus-4-8");
    expect(params.max_tokens).toBe(1500);
    expect(params.system).toMatch(/^You are the AI Copilot for a Bloomberg-style securities-finance terminal/);
    expect(params.system).toMatch(/Respond with ONLY a single JSON object/);
    expect(params.messages).toEqual([{ role: "user", content: 'Desk data snapshot (JSON):\n{"desk":"snapshot","n":3}\n\nQuestion: Why did revenue fall?' }]);
    expect(sdk.ctor.mock.calls[0][0]).toMatchObject({ apiKey: "k".repeat(24), baseURL: "https://api.anthropic.com" });
  });

  it("names the profile and model on AI responses", async () => {
    sdk.create.mockResolvedValue(reply('```json\n{"text":"T","bullets":["a","b"]}\n```'));
    const body = await (await ask()).json();
    expect(body).toEqual({ source: "AI", text: "T", bullets: ["a", "b"], profile: "anthropic-direct", model: "claude-opus-4-8" });
  });

  it("falls back to LOCAL exactly as before", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await (await ask()).json()).toEqual({ source: "LOCAL" });
    expect(sdk.create).not.toHaveBeenCalled();
    vi.stubEnv("ANTHROPIC_API_KEY", "k".repeat(24));
    sdk.create.mockResolvedValue(reply("not json at all"));
    expect(await (await ask()).json()).toEqual({ source: "LOCAL" });
    sdk.create.mockResolvedValue({ model: "m", content: [], usage: {} });
    expect(await (await ask()).json()).toEqual({ source: "LOCAL" });
    sdk.create.mockRejectedValue(Object.assign(new Error("rate limited"), { status: 429 }));
    expect(await (await ask()).json()).toEqual({ source: "LOCAL" });
  });

  it("keeps request validation", async () => {
    expect((await POST(new Request("http://localhost/api/copilot", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await ask("  ")).status).toBe(400);
  });

  it("answers LOCAL when the selected default profile cannot serve the Copilot", async () => {
    vi.stubEnv("LLM_PROFILE_DEFAULT", "local-openai"); // disabled in the registry and has no copilot use
    expect(await (await ask()).json()).toEqual({ source: "LOCAL" });
    expect(sdk.create).not.toHaveBeenCalled();
  });

  it("records token usage when the queue database is configured, and not otherwise", async () => {
    const file = path.join(os.tmpdir(), `copilot-usage-${Date.now()}-${Math.random()}.db`);
    sdk.create.mockResolvedValue(reply('{"text":"T","bullets":[]}'));
    try {
      vi.stubEnv("AGENT_QUEUE_DB_URL", `sqlite:${file}`);
      await ask();
      const { AgentQueueStore } = await import("@/lib/server/agent/queueStore");
      await vi.waitFor(async () => expect(await new AgentQueueStore().usageToday("anthropic-direct")).toEqual({ input_tokens: 120, output_tokens: 30 }));
      vi.stubEnv("AGENT_QUEUE_DB_URL", "");
      expect((await ask()).status).toBe(200); // no queue: nothing recorded, answer unaffected
    } finally { fs.rmSync(file, { force: true }); }
  });
});
