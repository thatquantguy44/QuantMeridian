import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";
import type { AgentJobCreateRequest } from "@/lib/agent/contracts/job.generated";
import { AgentQueueStore, QUEUE_SCHEMA_VERSION, type CreateJobOptions, type QueueConfig } from "./queueStore";

const require = createRequire(import.meta.url);
const files: string[] = [];
const body: AgentJobCreateRequest = {
  schema_version: "agent-job/1",
  module: "ECOIQ",
  thread_id: "5d0c7a2e-1111-4222-8333-444455556666",
  workflow: "economics.explain",
  message: "Why did the 2s10s curve move?",
  context: { series: [{ source: "econ", id: "DGS2" }, { source: "econ", id: "DGS10" }], tenors: ["2Y", "10Y"] },
  profile: "deterministic",
};
const opts = (key: string, over: Partial<CreateJobOptions> = {}): CreateJobOptions => ({ idempotencyKey: key, correlationId: `corr-${key}`, workflowVersion: "1.0.0", maxAttempts: 2, queueTtlHours: 24, maxQueued: 10, ...over });

// SQLite always; Postgres too when AGENT_TEST_POSTGRES_URL points at a database the suite may create schemas in.
const pgUrl = process.env.AGENT_TEST_POSTGRES_URL;
const schemas: string[] = [];
async function makeConfig(backend: "sqlite" | "postgres"): Promise<QueueConfig> {
  if (backend === "sqlite") {
    const file = path.join(os.tmpdir(), `agent-queue-${Date.now()}-${Math.random()}.db`); files.push(file);
    return { url: `sqlite:${file}`, backend };
  }
  const schema = `agent_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`; schemas.push(schema);
  const pg = require("pg"); const client = new pg.Client({ connectionString: pgUrl }); await client.connect();
  try { await client.query(`CREATE SCHEMA ${schema}`); } finally { await client.end(); }
  const url = new URL(pgUrl!); url.searchParams.set("options", `-c search_path=${schema}`);
  return { url: url.toString(), backend };
}
afterAll(async () => {
  for (const file of files) fs.rmSync(file, { force: true });
  if (pgUrl && schemas.length) {
    const pg = require("pg"); const client = new pg.Client({ connectionString: pgUrl }); await client.connect();
    try { for (const schema of schemas) await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await client.end(); }
  }
});

const backends: Array<"sqlite" | "postgres"> = pgUrl ? ["sqlite", "postgres"] : ["sqlite"];
describe.each(backends)("AgentQueueStore (%s)", (backend) => {
  const store = async () => new AgentQueueStore(await makeConfig(backend));
  const must = <T extends { ok: boolean }>(r: T | null): Extract<T, { ok: true }> => { if (!r || !r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`); return r as Extract<T, { ok: true }>; };

  it("migrates to the current schema version and records events", async () => {
    const s = await store();
    const { job } = must(await s.create("a", body, opts("key-00001")));
    expect(job).toMatchObject({ status: "queued", workflow_version: "1.0.0", max_attempts: 2, correlation_id: "corr-key-00001" });
    expect(Date.parse(job.expires_at)).toBeGreaterThan(Date.now());
    const events = await s.events(job.job_id, "a");
    expect(events).toMatchObject([{ from_status: null, to_status: "queued", actor: "api" }]);
    expect(QUEUE_SCHEMA_VERSION).toBe("agent-queue/1");
  });

  it("creates idempotently: same key and request returns the job; a different request conflicts", async () => {
    const s = await store();
    const first = must(await s.create("a", body, opts("key-00002")));
    expect(first.created).toBe(true);
    const again = must(await s.create("a", { ...body, context: { tenors: ["2Y", "10Y"], series: body.context.series } }, opts("key-00002")));
    expect(again).toMatchObject({ created: false, job: { job_id: first.job.job_id } });
    expect(await s.create("a", { ...body, message: "different" }, opts("key-00002"))).toEqual({ ok: false, code: "AGENT_IDEMPOTENCY_CONFLICT" });
    // Keys are scoped to the requester.
    expect(must(await s.create("b", body, opts("key-00002"))).created).toBe(true);
  });

  it("enforces the queued limit per requester", async () => {
    const s = await store();
    must(await s.create("a", body, opts("key-00003", { maxQueued: 2 })));
    must(await s.create("a", body, opts("key-00004", { maxQueued: 2 })));
    expect(await s.create("a", body, opts("key-00005", { maxQueued: 2 }))).toEqual({ ok: false, code: "AGENT_QUEUE_LIMIT" });
    must(await s.create("b", body, opts("key-00005", { maxQueued: 2 })));
  });

  it("isolates requesters on read, list, cancel, and events", async () => {
    const s = await store();
    const { job } = must(await s.create("a", body, opts("key-00006")));
    expect(await s.get(job.job_id, "b")).toBeNull();
    expect(await s.cancel(job.job_id, "b")).toBeNull();
    expect(await s.events(job.job_id, "b")).toBeNull();
    expect(await s.listThread("b", "ECOIQ", body.thread_id)).toEqual([]);
    expect((await s.listThread("a", "ECOIQ", body.thread_id)).map((j) => j.job_id)).toEqual([job.job_id]);
  });

  it("lists a thread oldest first", async () => {
    const s = await store();
    const one = must(await s.create("a", body, opts("key-00007"))).job;
    await new Promise((r) => setTimeout(r, 5));
    const two = must(await s.create("a", { ...body, message: "second" }, opts("key-00008"))).job;
    expect((await s.listThread("a", "ECOIQ", body.thread_id)).map((j) => j.job_id)).toEqual([one.job_id, two.job_id]);
  });

  it("cancels queued jobs now, flags running jobs, and leaves terminal jobs alone", async () => {
    const s = await store();
    const queued = must(await s.create("a", body, opts("key-00009"))).job;
    expect((await s.cancel(queued.job_id, "a"))?.status).toBe("cancelled");
    const running = must(await s.create("a", body, opts("key-00010"))).job;
    expect(await s.markRunning(running.job_id, "worker")).toBe(true);
    expect(await s.markRunning(running.job_id, "worker")).toBe(false);
    expect(await s.cancel(running.job_id, "a")).toMatchObject({ status: "running", cancel_requested: true, attempts: 1 });
    const done = must(await s.create("a", body, opts("key-00011"))).job;
    await s.finish(done.job_id, "a", "succeeded", null, { ok: true });
    expect(await s.cancel(done.job_id, "a")).toMatchObject({ status: "succeeded", result: { ok: true } });
  });

  it("retries only failed or expired jobs, as a new job with retry_of", async () => {
    const s = await store();
    const original = must(await s.create("a", body, opts("key-00012"))).job;
    const retryOpts = { correlationId: "c", workflowVersion: "1.0.0", maxAttempts: 2, queueTtlHours: 24, maxQueued: 10 };
    expect(await s.retry(original.job_id, "a", retryOpts)).toBeNull(); // still queued
    await s.finish(original.job_id, "a", "failed", "LLM_PROVIDER_ERROR");
    const retried = must(await s.retry(original.job_id, "a", retryOpts));
    expect(retried.job).toMatchObject({ status: "queued", retry_of: original.job_id, message: body.message });
    expect(retried.job.job_id).not.toBe(original.job_id);
    expect(must(await s.retry(original.job_id, "a", retryOpts))).toMatchObject({ created: false });
    expect(await s.retry(original.job_id, "b", retryOpts)).toBeNull();
  });

  it("pauses and resumes through agent_control", async () => {
    const s = await store();
    expect(await s.isPaused()).toBe(false);
    await s.setPaused(true); expect(await s.isPaused()).toBe(true);
    await s.setPaused(false); expect(await s.isPaused()).toBe(false);
  });

  it("looks up a job for the worker without a requester filter", async () => {
    const s = await store();
    const { job } = must(await s.create("a", body, opts("key-00013")));
    expect((await s.getForWorker(job.job_id))?.requester_id).toBe("a");
    expect(await s.getForWorker("missing")).toBeNull();
  });

  it("reports queue stats and only ready, recent worker capabilities", async () => {
    const config = await makeConfig(backend); const s = new AgentQueueStore(config);
    must(await s.create("a", body, opts("key-00014")));
    expect(await s.stats()).toMatchObject({ queued: 1, running: 0, workers: [] });
    expect((await s.liveCapabilities(30)).workers).toBe(0);
    const heartbeat = (id: string, seen: string, ready: number, caps: string[]) => insertHeartbeat(config, id, seen, ready, caps);
    await heartbeat("w1", new Date().toISOString(), 1, ["chart_line_form"]);
    await heartbeat("w2", new Date().toISOString(), 0, ["carry_runtime"]);
    await heartbeat("w3", new Date(Date.now() - 3600_000).toISOString(), 1, ["stm_pack"]);
    const live = await s.liveCapabilities(30);
    expect(live.workers).toBe(1);
    expect([...live.capabilities]).toEqual(["chart_line_form"]);
  });
});

async function insertHeartbeat(config: QueueConfig, id: string, seen: string, ready: number, caps: string[]) {
  const sql = "INSERT INTO agent_worker_heartbeat (worker_id, started_at, last_seen_at, sourcing_mode, code_digest, assets_digest, registry_version, capabilities_json, worker_version, ready) VALUES (?,?,?,?,?,?,?,?,?,?)";
  const values = [id, seen, seen, "path", "c", "a", "r", JSON.stringify(caps), "0.1.0", ready];
  if (config.backend === "postgres") {
    const pg = require("pg"); const client = new pg.Client({ connectionString: config.url }); await client.connect();
    try { let n = 0; await client.query(sql.replace(/\?/g, () => `$${++n}`), values); } finally { await client.end(); }
  } else {
    const Database = require("better-sqlite3"); const db = new Database(config.url.replace(/^sqlite:/, ""));
    try { db.prepare(sql).run(...values); } finally { db.close(); }
  }
}

describe("migration from the pre-T-008 table", () => {
  it("renames the legacy tables, keeps the pause flag, and starts a clean queue", async () => {
    const file = path.join(os.tmpdir(), `agent-legacy-${Date.now()}-${Math.random()}.db`); files.push(file);
    const Database = require("better-sqlite3"); const db = new Database(file);
    db.exec("CREATE TABLE agent_job (job_id TEXT PRIMARY KEY, requester_id TEXT, status TEXT)");
    db.exec("INSERT INTO agent_job VALUES ('old','r','queued')");
    db.exec("CREATE TABLE agent_control (id INTEGER PRIMARY KEY, paused INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)");
    db.exec("INSERT INTO agent_control VALUES (1, 1, 'x')");
    db.close();
    const s = new AgentQueueStore({ url: `sqlite:${file}`, backend: "sqlite" });
    expect(await s.isPaused()).toBe(true);
    expect(await s.stats()).toMatchObject({ queued: 0 });
    const check = new Database(file);
    expect(check.prepare("SELECT job_id FROM agent_job_legacy_v0").all()).toEqual([{ job_id: "old" }]);
    expect(check.prepare("SELECT version FROM agent_schema_version").all()).toEqual([{ version: QUEUE_SCHEMA_VERSION }]);
    check.close();
  });
});
