/**
 * Agent queue store (spec009 T-008): the DDL, migrations, and job lifecycle for SQLite and
 * Postgres. Node owns and migrates the schema; the worker checks it (agent_schema_version).
 *
 * SQL is written once with `?` placeholders; the Postgres path rewrites them to `$n`. Every public
 * method opens one connection (a "session") so multi-statement operations can run in a transaction.
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type { AgentJobCreateRequest, ErrorCode, JobStatus } from "@/lib/agent/contracts/job.generated";

const requireFromRuntime = createRequire(import.meta.url);
const optionalRequire = (name: string): any => { try { return requireFromRuntime(name); } catch { return null; } };

export const QUEUE_SCHEMA_VERSION = "agent-queue/1";
const TERMINAL: JobStatus[] = ["succeeded", "needs_clarification", "failed", "cancelled", "expired"];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface AgentQueueJob {
  job_id: string;
  requester_id: string;
  module: string;
  thread_id: string;
  workflow: string;
  kind: string | null;
  workflow_version: string;
  message: string | null;
  inputs: unknown | null;
  context: Record<string, unknown>;
  profile: string | null;
  parent_job_id: string | null;
  retry_of: string | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  cancel_requested: boolean;
  result: unknown | null;
  error_code: ErrorCode | string | null;
  error_message: string | null;
  correlation_id: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  expires_at: string;
  updated_at: string;
}

export interface AgentJobEvent { id: string; job_id: string; at: string; from_status: string | null; to_status: string; actor: string; code: string | null; detail: unknown | null }

export interface CreateJobOptions {
  idempotencyKey: string;
  correlationId: string;
  workflowVersion: string;
  maxAttempts: number;
  queueTtlHours: number;
  /** Requester's queued limit; the store enforces it atomically with the insert. */
  maxQueued: number;
  retentionDays?: { purge: number; delete: number };
  retryOf?: string | null;
}

export type CreateJobResult =
  | { ok: true; job: AgentQueueJob; created: boolean }
  | { ok: false; code: "AGENT_IDEMPOTENCY_CONFLICT" | "AGENT_QUEUE_LIMIT" };

export type QueueConfig = { url: string; backend: "sqlite" | "postgres" };

export function queueConfig(env: Record<string, string | undefined> = process.env): QueueConfig | null {
  const url = env.AGENT_QUEUE_DB_URL?.trim();
  if (!url) return null;
  return { url, backend: /^postgres(ql)?:\/\//i.test(url) ? "postgres" : "sqlite" };
}

const now = () => new Date().toISOString();
const sqlitePath = (url: string) => url.replace(/^sqlite:/i, "");
const json = (value: unknown) => (value === undefined || value === null ? null : JSON.stringify(value));
const parse = (text: string | null | undefined) => (text ? JSON.parse(text) : null);

/** One connection; `?` placeholders on both backends. */
interface Session {
  all<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<number>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

const DDL = [
  "CREATE TABLE IF NOT EXISTS agent_schema_version (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS agent_control (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)",
  `CREATE TABLE IF NOT EXISTS agent_thread (
    requester TEXT NOT NULL, module TEXT NOT NULL, thread_id TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (requester, module, thread_id))`,
  `CREATE TABLE IF NOT EXISTS agent_job (
    id TEXT PRIMARY KEY, requester TEXT NOT NULL, idempotency_key TEXT NOT NULL,
    module TEXT NOT NULL, thread_id TEXT NOT NULL, workflow TEXT NOT NULL, kind TEXT,
    workflow_version TEXT NOT NULL, status TEXT NOT NULL, message TEXT, inputs_json TEXT,
    context_json TEXT NOT NULL, profile_requested TEXT, parent_job_id TEXT, retry_of TEXT,
    attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL,
    lease_owner TEXT, lease_expires_at TEXT, cancel_requested INTEGER NOT NULL DEFAULT 0,
    result_json TEXT, result_schema_version TEXT, verification_json TEXT, disclosure_json TEXT,
    usage_json TEXT, error_code TEXT, error_message TEXT, error_retryable INTEGER,
    correlation_id TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
    updated_at TEXT NOT NULL, expires_at TEXT NOT NULL, purge_after TEXT NOT NULL, delete_after TEXT NOT NULL,
    UNIQUE (requester, idempotency_key))`,
  "CREATE INDEX IF NOT EXISTS agent_job_thread ON agent_job (requester, module, thread_id, created_at)",
  "CREATE INDEX IF NOT EXISTS agent_job_status ON agent_job (status, created_at)",
  `CREATE TABLE IF NOT EXISTS agent_job_event (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL, at TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL,
    actor TEXT NOT NULL, code TEXT, detail_json TEXT)`,
  "CREATE INDEX IF NOT EXISTS agent_job_event_job ON agent_job_event (job_id, at)",
  `CREATE TABLE IF NOT EXISTS agent_job_artifact (
    job_id TEXT NOT NULL, kind TEXT NOT NULL, sha256 TEXT NOT NULL, content BLOB NOT NULL,
    purge_class TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (job_id, kind))`,
  `CREATE TABLE IF NOT EXISTS agent_worker_heartbeat (
    worker_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
    sourcing_mode TEXT NOT NULL, code_digest TEXT NOT NULL, assets_digest TEXT NOT NULL,
    registry_version TEXT NOT NULL, capabilities_json TEXT NOT NULL, worker_version TEXT NOT NULL,
    ready INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS agent_usage_daily (
    profile_id TEXT NOT NULL, day TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (profile_id, day))`,
];

// BLOB is not a Postgres type.
const forBackend = (sql: string, backend: QueueConfig["backend"]) => (backend === "postgres" ? sql.replace(/\bBLOB\b/g, "BYTEA") : sql);
const migrated = new Map<string, Promise<void>>();

export class AgentQueueStore {
  private readonly config: QueueConfig;
  constructor(config = queueConfig()) { if (!config) throw new Error("AGENT_QUEUE_NOT_CONFIGURED"); this.config = config; }

  private async session<T>(fn: (q: Session) => Promise<T>): Promise<T> {
    if (this.config.backend === "postgres") {
      const pg = optionalRequire("pg"); if (!pg) throw new Error("pg is not installed");
      const client = new pg.Client({ connectionString: this.config.url });
      await client.connect();
      const text = (sql: string) => { let n = 0; return sql.replace(/\?/g, () => `$${++n}`); };
      const q: Session = {
        all: async (sql, params = []) => (await client.query(text(sql), params)).rows,
        run: async (sql, params = []) => (await client.query(text(sql), params)).rowCount ?? 0,
        begin: async () => { await client.query("BEGIN"); },
        commit: async () => { await client.query("COMMIT"); },
        rollback: async () => { await client.query("ROLLBACK").catch(() => {}); },
      };
      try { return await fn(q); } finally { await client.end().catch(() => {}); }
    }
    const Database = optionalRequire("better-sqlite3"); if (!Database) throw new Error("better-sqlite3 is not installed");
    const db = new Database(sqlitePath(this.config.url));
    db.pragma("journal_mode = WAL"); db.pragma("busy_timeout = 5000");
    const q: Session = {
      all: async (sql, params = []) => db.prepare(sql).all(...params),
      run: async (sql, params = []) => db.prepare(sql).run(...params).changes,
      begin: async () => { db.exec("BEGIN IMMEDIATE"); },
      commit: async () => { db.exec("COMMIT"); },
      rollback: async () => { try { db.exec("ROLLBACK"); } catch { /* no open transaction */ } },
    };
    try { return await fn(q); } finally { db.close(); }
  }

  private async tx<T>(fn: (q: Session) => Promise<T>): Promise<T> {
    return this.session(async (q) => {
      await q.begin();
      try { const out = await fn(q); await q.commit(); return out; } catch (error) { await q.rollback(); throw error; }
    });
  }

  /** Idempotent and cached per process. Legacy (pre-T-008) tables are renamed, never dropped. */
  migrate(): Promise<void> {
    const key = `${this.config.backend}:${this.config.url}`;
    let pending = migrated.get(key);
    if (!pending) {
      pending = this.runMigration().catch((error) => { migrated.delete(key); throw error; });
      migrated.set(key, pending);
    }
    return pending;
  }

  private async runMigration(): Promise<void> {
    await this.session(async (q) => {
      const columns = async (table: string): Promise<string[]> => this.config.backend === "postgres"
        ? (await q.all<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?", [table])).map((r) => r.column_name)
        : (await q.all<{ name: string }>(`PRAGMA table_info(${table})`)).map((r) => r.name);
      let legacyPaused = false;
      if ((await columns("agent_job")).includes("job_id")) {
        await q.run("ALTER TABLE agent_job RENAME TO agent_job_legacy_v0");
      }
      if ((await columns("agent_control")).includes("paused")) {
        legacyPaused = Number((await q.all<any>("SELECT paused FROM agent_control WHERE id = 1"))[0]?.paused ?? 0) === 1;
        await q.run("ALTER TABLE agent_control RENAME TO agent_control_legacy_v0");
      }
      for (const statement of DDL) await q.run(forBackend(statement, this.config.backend));
      const stamp = now();
      await q.run("INSERT INTO agent_schema_version (version, applied_at) VALUES (?, ?) ON CONFLICT (version) DO NOTHING", [QUEUE_SCHEMA_VERSION, stamp]);
      if (legacyPaused) await q.run("INSERT INTO agent_control (key, value, updated_at) VALUES ('paused', '1', ?) ON CONFLICT (key) DO NOTHING", [stamp]);
    });
  }

  private toJob(row: any): AgentQueueJob {
    return {
      job_id: row.id, requester_id: row.requester, module: row.module, thread_id: row.thread_id, workflow: row.workflow,
      kind: row.kind ?? null, workflow_version: row.workflow_version, message: row.message ?? null, inputs: parse(row.inputs_json),
      context: JSON.parse(row.context_json), profile: row.profile_requested ?? null, parent_job_id: row.parent_job_id ?? null,
      retry_of: row.retry_of ?? null, status: row.status, attempts: Number(row.attempt), max_attempts: Number(row.max_attempts),
      cancel_requested: Number(row.cancel_requested) === 1, result: parse(row.result_json), error_code: row.error_code ?? null,
      error_message: row.error_message ?? null, correlation_id: row.correlation_id, created_at: row.created_at,
      started_at: row.started_at ?? null, finished_at: row.finished_at ?? null, expires_at: row.expires_at, updated_at: row.updated_at,
    };
  }

  private async event(q: Session, jobId: string, from: string | null, to: string, actor: string, code: string | null = null, detail: unknown = null) {
    await q.run("INSERT INTO agent_job_event (id, job_id, at, from_status, to_status, actor, code, detail_json) VALUES (?,?,?,?,?,?,?,?)", [randomUUID(), jobId, now(), from, to, actor, code, json(detail)]);
  }

  // --- control row -----------------------------------------------------------------------------

  /** Run-time kill switch (`node scripts/agent-control.mjs pause|resume`). */
  async isPaused(): Promise<boolean> {
    await this.migrate();
    return this.session(async (q) => (await q.all<{ value: string }>("SELECT value FROM agent_control WHERE key = 'paused'"))[0]?.value === "1");
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.migrate();
    await this.session((q) => q.run("INSERT INTO agent_control (key, value, updated_at) VALUES ('paused', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [paused ? "1" : "0", now()]));
  }

  // --- jobs ------------------------------------------------------------------------------------

  /**
   * Idempotent create. Same requester + key + same request returns the existing job; the same key
   * with a different request is a conflict. The queued limit is checked in the same transaction.
   */
  async create(requesterId: string, body: AgentJobCreateRequest, options: CreateJobOptions): Promise<CreateJobResult> {
    await this.migrate();
    const wanted = requestKey({ module: body.module, thread_id: body.thread_id, workflow: body.workflow, kind: body.kind, message: body.message, inputs: body.inputs, context: body.context, profile: body.profile, parent_job_id: body.parent_job_id }, options.retryOf);
    return this.tx(async (q) => {
      const existing = (await q.all<any>("SELECT * FROM agent_job WHERE requester = ? AND idempotency_key = ?", [requesterId, options.idempotencyKey]))[0];
      if (existing) {
        const stored = requestKey({ module: existing.module, thread_id: existing.thread_id, workflow: existing.workflow, kind: existing.kind, message: existing.message, inputs: parse(existing.inputs_json), context: JSON.parse(existing.context_json), profile: existing.profile_requested, parent_job_id: existing.parent_job_id }, existing.retry_of);
        return stored === wanted ? { ok: true as const, job: this.toJob(existing), created: false } : { ok: false as const, code: "AGENT_IDEMPOTENCY_CONFLICT" as const };
      }
      const queued = Number((await q.all<any>("SELECT COUNT(*) AS n FROM agent_job WHERE requester = ? AND status = 'queued'", [requesterId]))[0]?.n ?? 0);
      if (queued >= options.maxQueued) return { ok: false as const, code: "AGENT_QUEUE_LIMIT" as const };
      const id = randomUUID(); const created = new Date(); const stamp = created.toISOString();
      const retention = options.retentionDays ?? { purge: 30, delete: 90 };
      await q.run("INSERT INTO agent_thread (requester, module, thread_id, created_at) VALUES (?,?,?,?) ON CONFLICT (requester, module, thread_id) DO NOTHING", [requesterId, body.module, body.thread_id, stamp]);
      await q.run(
        `INSERT INTO agent_job (id, requester, idempotency_key, module, thread_id, workflow, kind, workflow_version, status, message, inputs_json,
           context_json, profile_requested, parent_job_id, retry_of, attempt, max_attempts, cancel_requested, correlation_id, created_at, updated_at,
           expires_at, purge_after, delete_after) VALUES (?,?,?,?,?,?,?,?,'queued',?,?,?,?,?,?,0,?,0,?,?,?,?,?,?)`,
        [id, requesterId, options.idempotencyKey, body.module, body.thread_id, body.workflow, body.kind ?? null, options.workflowVersion, body.message ?? null,
          json(body.inputs), JSON.stringify(body.context ?? {}), body.profile ?? null, body.parent_job_id ?? null, options.retryOf ?? null, options.maxAttempts,
          options.correlationId, stamp, stamp, new Date(created.getTime() + options.queueTtlHours * HOUR).toISOString(),
          new Date(created.getTime() + retention.purge * DAY).toISOString(), new Date(created.getTime() + retention.delete * DAY).toISOString()],
      );
      await this.event(q, id, null, "queued", "api", null, { correlation_id: options.correlationId });
      return { ok: true as const, job: this.toJob((await q.all<any>("SELECT * FROM agent_job WHERE id = ?", [id]))[0]), created: true };
    });
  }

  async get(jobId: string, requesterId: string): Promise<AgentQueueJob | null> {
    await this.migrate();
    const row = (await this.session((q) => q.all<any>("SELECT * FROM agent_job WHERE id = ? AND requester = ?", [jobId, requesterId])))[0];
    return row ? this.toJob(row) : null;
  }

  /** Worker-only lookup with no requester filter; never expose the result to a different requester. */
  async getForWorker(jobId: string): Promise<AgentQueueJob | null> {
    await this.migrate();
    const row = (await this.session((q) => q.all<any>("SELECT * FROM agent_job WHERE id = ?", [jobId])))[0];
    return row ? this.toJob(row) : null;
  }

  async listThread(requesterId: string, module: string, threadId: string, limit = 50): Promise<AgentQueueJob[]> {
    await this.migrate();
    const rows = await this.session((q) => q.all<any>("SELECT * FROM agent_job WHERE requester = ? AND module = ? AND thread_id = ? ORDER BY created_at, id LIMIT ?", [requesterId, module, threadId, limit]));
    return rows.map((row) => this.toJob(row));
  }

  async events(jobId: string, requesterId: string): Promise<AgentJobEvent[] | null> {
    await this.migrate();
    return this.session(async (q) => {
      if (!(await q.all("SELECT 1 FROM agent_job WHERE id = ? AND requester = ?", [jobId, requesterId])).length) return null;
      const rows = await q.all<any>("SELECT * FROM agent_job_event WHERE job_id = ? ORDER BY at, id", [jobId]);
      return rows.map((r) => ({ id: r.id, job_id: r.job_id, at: r.at, from_status: r.from_status ?? null, to_status: r.to_status, actor: r.actor, code: r.code ?? null, detail: parse(r.detail_json) }));
    });
  }

  /** `queued → cancelled` now; `running` sets `cancel_requested` for the worker's next stage boundary. Terminal jobs are unchanged. */
  async cancel(jobId: string, requesterId: string): Promise<AgentQueueJob | null> {
    await this.migrate();
    return this.tx(async (q) => {
      const row = (await q.all<any>("SELECT * FROM agent_job WHERE id = ? AND requester = ?", [jobId, requesterId]))[0];
      if (!row) return null;
      const stamp = now();
      if (row.status === "queued") {
        await q.run("UPDATE agent_job SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'", [stamp, stamp, jobId]);
        await this.event(q, jobId, "queued", "cancelled", "api");
      } else if (row.status === "running" || row.status === "verifying") {
        await q.run("UPDATE agent_job SET cancel_requested = 1, updated_at = ? WHERE id = ?", [stamp, jobId]);
        await this.event(q, jobId, row.status, row.status, "api", "CANCEL_REQUESTED");
      }
      return this.toJob((await q.all<any>("SELECT * FROM agent_job WHERE id = ?", [jobId]))[0]);
    });
  }

  /**
   * Retry creates a new job with `retry_of` for a `failed` or `expired` job (state model). The new
   * job copies the original request. Returns null when the job is missing or not retryable.
   */
  async retry(jobId: string, requesterId: string, options: Omit<CreateJobOptions, "retryOf" | "idempotencyKey"> & { idempotencyKey?: string }): Promise<CreateJobResult | null> {
    const original = await this.get(jobId, requesterId);
    if (!original || !["failed", "expired"].includes(original.status)) return null;
    const body = { schema_version: "agent-job/1", module: original.module, thread_id: original.thread_id, workflow: original.workflow, kind: original.kind, message: original.message ?? undefined, inputs: original.inputs, context: original.context, profile: original.profile, parent_job_id: original.parent_job_id } as AgentJobCreateRequest;
    return this.create(requesterId, body, { ...options, idempotencyKey: options.idempotencyKey ?? `retry:${jobId}`, retryOf: jobId });
  }

  /** Terminal write used by the attended executor (the worker's fenced writes arrive with T-012). */
  async finish(jobId: string, requesterId: string, status: "succeeded" | "failed", errorCode: string | null = null, result: unknown = null): Promise<AgentQueueJob | null> {
    await this.migrate();
    return this.tx(async (q) => {
      const row = (await q.all<any>("SELECT status FROM agent_job WHERE id = ? AND requester = ?", [jobId, requesterId]))[0];
      if (!row) return null;
      const stamp = now();
      await q.run("UPDATE agent_job SET status = ?, error_code = ?, result_json = ?, finished_at = ?, updated_at = ? WHERE id = ? AND requester = ?", [status, errorCode, json(result), stamp, stamp, jobId, requesterId]);
      await this.event(q, jobId, row.status, status, "api", errorCode);
      return this.toJob((await q.all<any>("SELECT * FROM agent_job WHERE id = ?", [jobId]))[0]);
    });
  }

  /** Attended execution marks the job running before the stages start. */
  async markRunning(jobId: string, actor: string): Promise<boolean> {
    await this.migrate();
    return this.tx(async (q) => {
      const stamp = now();
      const changed = await q.run("UPDATE agent_job SET status = 'running', attempt = attempt + 1, started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ? AND status = 'queued'", [stamp, stamp, jobId]);
      if (changed) await this.event(q, jobId, "queued", "running", actor);
      return changed > 0;
    });
  }

  // --- health ----------------------------------------------------------------------------------

  async stats(): Promise<{ queued: number; running: number; oldest_queued_at: string | null; outcomes: Record<string, number>; workers: Array<{ worker_id: string; last_seen_at: string; ready: boolean; sourcing_mode: string; code_digest: string; assets_digest: string; capabilities: string[] }> }> {
    await this.migrate();
    return this.session(async (q) => {
      const byStatus = await q.all<any>("SELECT status, COUNT(*) AS n FROM agent_job GROUP BY status");
      const count = (status: string) => Number(byStatus.find((r) => r.status === status)?.n ?? 0);
      const oldest = (await q.all<any>("SELECT MIN(created_at) AS at FROM agent_job WHERE status = 'queued'"))[0]?.at ?? null;
      const codes = await q.all<any>("SELECT COALESCE(error_code, status) AS code, COUNT(*) AS n FROM agent_job WHERE status IN ('succeeded','failed','expired','needs_clarification') GROUP BY COALESCE(error_code, status)");
      const workers = await q.all<any>("SELECT * FROM agent_worker_heartbeat ORDER BY last_seen_at DESC");
      return {
        queued: count("queued"), running: count("running"), oldest_queued_at: oldest,
        outcomes: Object.fromEntries(codes.map((r) => [r.code, Number(r.n)])),
        workers: workers.map((w) => ({ worker_id: w.worker_id, last_seen_at: w.last_seen_at, ready: Number(w.ready) === 1, sourcing_mode: w.sourcing_mode, code_digest: w.code_digest, assets_digest: w.assets_digest, capabilities: parse(w.capabilities_json) ?? [] })),
      };
    });
  }

  /** Capabilities published by ready workers seen within `withinSeconds` (the catalog's config ∩ capability rule). */
  async liveCapabilities(withinSeconds: number): Promise<{ workers: number; capabilities: Set<string> }> {
    await this.migrate();
    const since = new Date(Date.now() - withinSeconds * 1000).toISOString();
    const rows = await this.session((q) => q.all<any>("SELECT capabilities_json FROM agent_worker_heartbeat WHERE ready = 1 AND last_seen_at >= ?", [since]));
    const capabilities = new Set<string>();
    for (const row of rows) for (const name of parse(row.capabilities_json) ?? []) capabilities.add(String(name));
    return { workers: rows.length, capabilities };
  }
}

/** Canonical form of a create request (key order, null, and undefined do not matter). */
function requestKey(request: Record<string, unknown>, retryOf?: string | null): string {
  const sort = (v: any): any => Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined && v[k] !== null).map((k) => [k, sort(v[k])])) : v;
  return JSON.stringify(sort({ ...request, retry_of: retryOf ?? null }));
}

export const isTerminal = (status: JobStatus) => TERMINAL.includes(status);
