import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type { AgentJobCreateRequest, JobStatus } from "@/lib/agent/contracts/job.generated";

const requireFromRuntime = createRequire(import.meta.url);
const optionalRequire = (name: string): any => { try { return requireFromRuntime(name); } catch { return null; } };

export interface AgentQueueJob {
  job_id: string;
  requester_id: string;
  module: string;
  workflow: string;
  message: string | null;
  context: Record<string, unknown>;
  profile: string | null;
  status: JobStatus;
  attempts: number;
  created_at: string;
  updated_at: string;
  error_code: string | null;
  result: unknown | null;
}

export type QueueConfig = { url: string; backend: "sqlite" | "postgres" };

export function queueConfig(env: Record<string, string | undefined> = process.env): QueueConfig | null {
  const url = env.AGENT_QUEUE_DB_URL?.trim();
  if (!url) return null;
  return { url, backend: /^postgres(ql)?:\/\//i.test(url) ? "postgres" : "sqlite" };
}

function now(): string { return new Date().toISOString(); }

const CREATE_SQL = `CREATE TABLE IF NOT EXISTS agent_job (
  job_id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL,
  module TEXT NOT NULL,
  workflow TEXT NOT NULL,
  message TEXT,
  context_json TEXT NOT NULL,
  profile TEXT,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  error_code TEXT,
  result_json TEXT
)`;

const CONTROL_SQL = `CREATE TABLE IF NOT EXISTS agent_control (
  id INTEGER PRIMARY KEY,
  paused INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
)`;

function sqlitePath(url: string): string { return url.replace(/^sqlite:/i, ""); }

export class AgentQueueStore {
  private readonly config: QueueConfig;
  constructor(config = queueConfig()) { if (!config) throw new Error("AGENT_QUEUE_NOT_CONFIGURED"); this.config = config; }

  private async postgres<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const pg = optionalRequire("pg"); if (!pg) throw new Error("pg is not installed");
    const client = new pg.Client({ connectionString: this.config.url });
    await client.connect(); try { return (await client.query(sql, params)).rows as T[]; } finally { await client.end().catch(() => {}); }
  }

  private sqlite<T>(fn: (db: any) => T): T {
    const Database = optionalRequire("better-sqlite3"); if (!Database) throw new Error("better-sqlite3 is not installed");
    const db = new Database(sqlitePath(this.config.url)); try { return fn(db); } finally { db.close(); }
  }

  async migrate(): Promise<void> {
    if (this.config.backend === "postgres") { await this.postgres(CREATE_SQL); await this.postgres(CONTROL_SQL); await this.postgres("ALTER TABLE agent_job ADD COLUMN IF NOT EXISTS result_json TEXT"); return; }
    this.sqlite((db) => { db.exec(CREATE_SQL); db.exec(CONTROL_SQL); try { db.exec("ALTER TABLE agent_job ADD COLUMN result_json TEXT"); } catch { /* already migrated */ } });
  }

  async create(requesterId: string, body: AgentJobCreateRequest): Promise<AgentQueueJob> {
    await this.migrate();
    const jobId = randomUUID(); const timestamp = now();
    const values = [jobId, requesterId, body.module, body.workflow, body.message ?? null, JSON.stringify(body.context), body.profile ?? null, "queued", 0, timestamp, timestamp, null, null];
    if (this.config.backend === "postgres") {
      await this.postgres(`INSERT INTO agent_job (job_id, requester_id, module, workflow, message, context_json, profile, status, attempts, created_at, updated_at, error_code, result_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, values);
    } else this.sqlite((db) => db.prepare(`INSERT INTO agent_job VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...values));
    return (await this.get(jobId, requesterId))!;
  }

  /** Run-time kill switch (`node scripts/agent-control.mjs pause|resume`); checked on job creation and worker claims. */
  async isPaused(): Promise<boolean> {
    await this.migrate();
    const rows = this.config.backend === "postgres"
      ? await this.postgres<any>("SELECT paused FROM agent_control WHERE id = 1")
      : this.sqlite<any[]>((db) => db.prepare("SELECT paused FROM agent_control WHERE id = 1").all());
    return Number(rows[0]?.paused ?? 0) === 1;
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.migrate(); const timestamp = now(); const flag = paused ? 1 : 0;
    if (this.config.backend === "postgres") await this.postgres("INSERT INTO agent_control (id, paused, updated_at) VALUES (1, $1, $2) ON CONFLICT (id) DO UPDATE SET paused = $1, updated_at = $2", [flag, timestamp]);
    else this.sqlite((db) => db.prepare("INSERT INTO agent_control (id, paused, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET paused = excluded.paused, updated_at = excluded.updated_at").run(flag, timestamp));
  }

  /** Worker-only lookup with no requester filter; never expose the result to a different requester. */
  async getForWorker(jobId: string): Promise<AgentQueueJob | null> {
    await this.migrate();
    const rows = this.config.backend === "postgres"
      ? await this.postgres<any>("SELECT * FROM agent_job WHERE job_id = $1", [jobId])
      : this.sqlite<any[]>((db) => db.prepare("SELECT * FROM agent_job WHERE job_id = ?").all(jobId));
    const row = rows[0]; if (!row) return null;
    return { ...row, context: JSON.parse(row.context_json) as Record<string, unknown>, result: row.result_json ? JSON.parse(row.result_json) : null } as AgentQueueJob;
  }

  async get(jobId: string, requesterId: string): Promise<AgentQueueJob | null> {
    await this.migrate();
    const rows = this.config.backend === "postgres"
      ? await this.postgres<any>("SELECT * FROM agent_job WHERE job_id = $1 AND requester_id = $2", [jobId, requesterId])
      : this.sqlite<any[]>((db) => db.prepare("SELECT * FROM agent_job WHERE job_id = ? AND requester_id = ?").all(jobId, requesterId));
    const row = rows[0]; if (!row) return null;
    return { ...row, context: JSON.parse(row.context_json) as Record<string, unknown>, result: row.result_json ? JSON.parse(row.result_json) : null } as AgentQueueJob;
  }

  async transition(jobId: string, requesterId: string, status: "cancelled" | "queued"): Promise<AgentQueueJob | null> {
    await this.migrate(); const timestamp = now();
    const current = await this.get(jobId, requesterId); if (!current) return null;
    if (status === "cancelled" && ["succeeded", "failed", "cancelled", "expired"].includes(current.status)) return current;
    if (this.config.backend === "postgres") await this.postgres("UPDATE agent_job SET status = $1, attempts = CASE WHEN $1 = 'queued' THEN attempts + 1 ELSE attempts END, updated_at = $2, error_code = NULL WHERE job_id = $3 AND requester_id = $4", [status, timestamp, jobId, requesterId]);
    else this.sqlite((db) => db.prepare("UPDATE agent_job SET status = ?, attempts = CASE WHEN ? = 'queued' THEN attempts + 1 ELSE attempts END, updated_at = ?, error_code = NULL WHERE job_id = ? AND requester_id = ?").run(status, status, timestamp, jobId, requesterId));
    return this.get(jobId, requesterId);
  }

  async finish(jobId: string, requesterId: string, status: "succeeded" | "failed", errorCode: string | null = null, result: unknown = null): Promise<AgentQueueJob | null> {
    await this.migrate(); const timestamp = now();
    if (this.config.backend === "postgres") await this.postgres("UPDATE agent_job SET status = $1, updated_at = $2, error_code = $3, result_json = $4 WHERE job_id = $5 AND requester_id = $6", [status, timestamp, errorCode, JSON.stringify(result), jobId, requesterId]);
    else this.sqlite((db) => db.prepare("UPDATE agent_job SET status = ?, updated_at = ?, error_code = ?, result_json = ? WHERE job_id = ? AND requester_id = ?").run(status, timestamp, errorCode, JSON.stringify(result), jobId, requesterId));
    return this.get(jobId, requesterId);
  }
}
