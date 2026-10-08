import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentQueueStore } from "@/lib/server/agent/queueStore";
import { GET, POST } from "./route";

const require = createRequire(import.meta.url);
let file = "";
const THREAD = "5d0c7a2e-1111-4222-8333-444455556666";
const ecoiq = { schema_version: "agent-job/1", module: "ECOIQ", thread_id: THREAD, workflow: "economics.explain", message: "why?", context: { tenors: ["2Y", "10Y"] } };
let n = 0;
const post = (body: unknown, headers: Record<string, string> = {}, key: string | null = `key-${++n}-abcdefgh`) =>
  POST(new Request("http://localhost/api/agent/jobs", { method: "POST", body: JSON.stringify(body), headers: { ...(key ? { "idempotency-key": key } : {}), ...headers } }));
const cookie = (r: Response) => r.headers.get("set-cookie")?.split(";")[0] ?? "";
const code = async (r: Response) => ((await r.json()) as { error_code?: string }).error_code;

beforeEach(() => { file = path.join(os.tmpdir(), `agent-route-${Date.now()}-${Math.random()}.db`); process.env.AGENT_QUEUE_DB_URL = `sqlite:${file}`; });
afterEach(() => { delete process.env.AGENT_QUEUE_DB_URL; delete process.env.AGENT_WORKFLOWS_DISABLED; fs.rmSync(file, { force: true }); });

function heartbeat(caps: string[]) {
  const Database = require("better-sqlite3"); const db = new Database(file); const at = new Date().toISOString();
  db.prepare("INSERT INTO agent_worker_heartbeat VALUES (?,?,?,?,?,?,?,?,?,?)").run("w1", at, at, "path", "c", "a", "r", JSON.stringify(caps), "0.1.0", 1);
  db.close();
}

describe("POST /api/agent/jobs", () => {
  it("returns an explicit not-configured state when the queue DB is absent", async () => {
    delete process.env.AGENT_QUEUE_DB_URL;
    const response = await post(ecoiq);
    expect(response.status).toBe(503);
    expect(await code(response)).toBe("AGENT_QUEUE_NOT_CONFIGURED");
  });

  it("creates a queued job, sets the requester cookie, and echoes the correlation id", async () => {
    const response = await post(ecoiq, { "x-correlation-id": "trace-123" });
    expect(response.status).toBe(202);
    expect(cookie(response)).toContain("agent_sid=");
    expect(response.headers.get("x-correlation-id")).toBe("trace-123");
    await expect(response.json()).resolves.toMatchObject({ job: { status: "queued", correlation_id: "trace-123", workflow_version: "1.0.0" } });
  });

  it("generates a correlation id when none is supplied or it is malformed", async () => {
    expect((await post(ecoiq)).headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect((await post(ecoiq, { "x-correlation-id": "bad id with spaces" })).headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("requires an Idempotency-Key", async () => {
    const response = await post(ecoiq, {}, null);
    expect(response.status).toBe(400);
    expect(await code(response)).toBe("AGENT_CONTEXT_INVALID");
    expect(await code(await post(ecoiq, {}, "short"))).toBe("AGENT_CONTEXT_INVALID");
  });

  it("returns the existing job (200) for a repeated key and 409 when the body differs", async () => {
    const first = await post(ecoiq, {}, "same-key-12345");
    const sid = cookie(first); const created = (await first.json()) as { job: { job_id: string } };
    const again = await post(ecoiq, { cookie: sid }, "same-key-12345");
    expect(again.status).toBe(200);
    expect(((await again.json()) as { job: { job_id: string } }).job.job_id).toBe(created.job.job_id);
    const conflict = await post({ ...ecoiq, message: "something else" }, { cookie: sid }, "same-key-12345");
    expect(conflict.status).toBe(409);
    expect(await code(conflict)).toBe("AGENT_IDEMPOTENCY_CONFLICT");
  });

  it("limits queued jobs per requester (429)", async () => {
    const first = await post(ecoiq); const sid = cookie(first);
    for (let i = 0; i < 9; i++) expect((await post(ecoiq, { cookie: sid })).status).toBe(202);
    const over = await post(ecoiq, { cookie: sid });
    expect(over.status).toBe(429);
    expect(await code(over)).toBe("AGENT_QUEUE_LIMIT");
  });

  it("rejects disabled modules, unknown workflows, and workflows a module does not offer", async () => {
    const disabled = await post({ ...ecoiq, module: "CURV", workflow: "chart.build" });
    expect([disabled.status, await code(disabled)]).toEqual([403, "AGENT_MODULE_DISABLED"]);
    const ineligible = await post({ ...ecoiq, module: "IBAL" });
    expect([ineligible.status, await code(ineligible)]).toEqual([403, "AGENT_MODULE_DISABLED"]);
    const wrong = await post({ ...ecoiq, module: "MGC" });
    expect([wrong.status, await code(wrong)]).toEqual([400, "WORKFLOW_UNKNOWN"]);
    expect((await post({ ...ecoiq, workflow: "nope.nothing" })).status).toBe(400);
  });

  it("rejects context outside the module allowlist, an oversize message, and bad thread ids", async () => {
    const field = await post({ ...ecoiq, context: { range: "1Y" } });
    expect([field.status, await code(field)]).toEqual([400, "AGENT_CONTEXT_INVALID"]);
    expect((await post({ ...ecoiq, message: "x".repeat(2001) })).status).toBe(400);
    expect((await post({ ...ecoiq, thread_id: "!!" })).status).toBe(400);
    expect(await code(await post("not an object"))).toBe("AGENT_CONTEXT_INVALID");
  });

  it("forbids a profile override on a module that disallows it", async () => {
    const forbidden = await post({ ...ecoiq, profile: "deterministic" });
    expect([forbidden.status, await code(forbidden)]).toEqual([403, "LLM_PROFILE_NOT_ALLOWED"]);
  });

  it("offers a capability-gated workflow only when a ready worker lists the capability", async () => {
    const mgc = { schema_version: "agent-job/1", module: "MGC", thread_id: THREAD, workflow: "chart.build", message: "plot 2s10s", context: { range: "1Y" } };
    await new AgentQueueStore().migrate();
    const notReady = await post(mgc);
    expect([notReady.status, await code(notReady)]).toEqual([409, "WORKFLOW_NOT_READY"]);
    heartbeat(["chart_line_form"]);
    expect((await post(mgc)).status).toBe(202);
  });

  it("rejects an unavailable or unknown profile on a module that allows overrides", async () => {
    const mgc = { schema_version: "agent-job/1", module: "MGC", thread_id: THREAD, workflow: "chart.build", message: "x", context: {} };
    await new AgentQueueStore().migrate(); heartbeat(["chart_line_form"]);
    expect(await code(await post({ ...mgc, profile: "openai-direct" }))).toBe("LLM_PROFILE_UNAVAILABLE");
    expect(await code(await post({ ...mgc, profile: "no-such-profile" }))).toBe("LLM_PROFILE_UNKNOWN");
    expect((await post({ ...mgc, profile: "deterministic" })).status).toBe(202);
  });

  it("refuses creation while paused or switched off", async () => {
    await new AgentQueueStore().setPaused(true);
    const paused = await post(ecoiq);
    expect([paused.status, await code(paused)]).toEqual([503, "AGENT_DISABLED"]);
    await new AgentQueueStore().setPaused(false);
    process.env.AGENT_WORKFLOWS_DISABLED = "1";
    expect(await code(await post(ecoiq))).toBe("AGENT_DISABLED");
  });
});

describe("GET /api/agent/jobs (thread view)", () => {
  it("returns only the requester's jobs for the thread, oldest first", async () => {
    const a = await post(ecoiq); const sid = cookie(a);
    await post({ ...ecoiq, message: "second" }, { cookie: sid });
    await post({ ...ecoiq, message: "other requester" });
    const list = await GET(new Request(`http://localhost/api/agent/jobs?module=ECOIQ&thread=${THREAD}`, { headers: { cookie: sid } }));
    const { jobs } = (await list.json()) as { jobs: Array<{ message: string }> };
    expect(jobs.map((j) => j.message)).toEqual(["why?", "second"]);
  });

  it("validates the query", async () => {
    expect((await GET(new Request("http://localhost/api/agent/jobs?module=NOPE&thread=x"))).status).toBe(400);
  });
});
