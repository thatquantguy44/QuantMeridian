import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentQueueStore } from "@/lib/server/agent/queueStore";
import { GET } from "./route";
import { GET as health } from "../health/route";

const require = createRequire(import.meta.url);
let file = "";
beforeEach(() => { file = path.join(os.tmpdir(), `agent-catalog-${Date.now()}-${Math.random()}.db`); process.env.AGENT_QUEUE_DB_URL = `sqlite:${file}`; });
afterEach(() => { delete process.env.AGENT_QUEUE_DB_URL; fs.rmSync(file, { force: true }); });
const catalog = async (module: string) => GET(new Request(`http://localhost/api/agent/catalog?module=${module}`));
type Catalog = { workflows: Array<{ id: string; offered: boolean; missing_capabilities: string[] }>; queue: string; worker: { online: boolean }; profiles: Array<{ id: string; available: boolean }>; context_fields: string[] };

function heartbeat(caps: string[]) {
  const Database = require("better-sqlite3"); const db = new Database(file); const at = new Date().toISOString();
  db.prepare("INSERT INTO agent_worker_heartbeat VALUES (?,?,?,?,?,?,?,?,?,?)").run("w1", at, at, "path", "c", "a", "r", JSON.stringify(caps), "0.1.0", 1);
  db.close();
}

describe("GET /api/agent/catalog", () => {
  it("sets the requester cookie and lists the module's configuration", async () => {
    const response = await catalog("ECOIQ");
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("agent_sid=");
    const body = (await response.json()) as Catalog;
    expect(body.workflows.map((w) => w.id)).toEqual(["economics.explain", "economics.transmission", "economics.scenario"]);
    expect(body.context_fields).toEqual(["asOfDate", "tenors", "series"]);
    expect(JSON.stringify(body)).not.toMatch(/sk-|ANTHROPIC_API_KEY=|https?:\/\//);
  });

  it("offers capability-free workflows with no worker, and hides gated ones until a worker publishes the capability (AC-007)", async () => {
    expect(((await (await catalog("ECOIQ")).json()) as Catalog).workflows.every((w) => w.offered)).toBe(true);
    const gated = (await (await catalog("MGC")).json()) as Catalog;
    expect(gated.workflows).toMatchObject([{ id: "chart.build", offered: false, missing_capabilities: ["chart_line_form"] }]);
    expect(gated.worker.online).toBe(false);
    heartbeat(["chart_line_form"]);
    const ready = (await (await catalog("MGC")).json()) as Catalog;
    expect(ready.workflows[0]).toMatchObject({ offered: true, missing_capabilities: [] });
    expect(ready.worker.online).toBe(true);
  });

  it("reports an unconfigured queue and rejects disabled or unknown modules", async () => {
    delete process.env.AGENT_QUEUE_DB_URL;
    const body = (await (await catalog("ECOIQ")).json()) as Catalog;
    expect(body.queue).toBe("not_configured");
    expect(body.workflows.every((w) => !w.offered)).toBe(true);
    expect((await catalog("CURV")).status).toBe(403);
    expect((await catalog("NOPE")).status).toBe(403);
  });

  it("marks everything not offered while paused", async () => {
    await new AgentQueueStore().setPaused(true);
    const body = (await (await catalog("ECOIQ")).json()) as Catalog & { paused: boolean };
    expect(body.paused).toBe(true);
    expect(body.workflows.every((w) => !w.offered)).toBe(true);
  });
});

describe("GET /api/agent/health", () => {
  it("returns queue counts and worker metadata without question text", async () => {
    const store = new AgentQueueStore();
    await store.create("r", { schema_version: "agent-job/1", module: "ECOIQ", thread_id: "5d0c7a2e-1111-4222-8333-444455556666", workflow: "economics.explain", message: "secret question", context: {} }, { idempotencyKey: "health-key-1", correlationId: "c", workflowVersion: "1.0.0", maxAttempts: 2, queueTtlHours: 24, maxQueued: 10 });
    heartbeat(["chart_line_form"]);
    const response = await health(new Request("http://localhost/api/agent/health"));
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ gate: "open", paused: false, queued: 1, running: 0, workers: [{ worker_id: "w1", online: true, ready: true, capabilities: ["chart_line_form"] }] });
    expect(JSON.parse(text).oldest_queued_age_seconds).toBeGreaterThanOrEqual(0);
    expect(text).not.toContain("secret question");
  });
});
