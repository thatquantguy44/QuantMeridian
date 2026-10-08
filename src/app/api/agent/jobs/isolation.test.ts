import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as create } from "./route";
import { GET as read } from "./[id]/route";
import { POST as cancel } from "./[id]/cancel/route";
import { POST as retry } from "./[id]/retry/route";
import { POST as execute } from "./[id]/execute/route";
import { GET as audit } from "./[id]/audit/route";

let file = "";
const job = { schema_version: "agent-job/1", module: "ECOIQ", thread_id: "5d0c7a2e-1111-4222-8333-444455556666", workflow: "economics.explain", message: "why?", context: {} };
const cookieOf = (response: Response) => response.headers.get("set-cookie")!.split(";")[0];
const ctx = (id: string) => ({ params: { id } });
const call = (cookie: string, init: RequestInit = {}) => new Request("http://localhost/api/agent/jobs/x", { ...init, headers: { cookie, ...(init.headers as object) } });
let n = 0;
const make = (headers: Record<string, string> = {}) => create(new Request("http://localhost/api/agent/jobs", { method: "POST", body: JSON.stringify(job), headers: { "idempotency-key": `iso-key-${++n}-abcdef`, ...headers } }));

beforeEach(() => { file = path.join(os.tmpdir(), `agent-iso-${Date.now()}-${Math.random()}.db`); process.env.AGENT_QUEUE_DB_URL = `sqlite:${file}`; process.env.AGENT_WORKER_TOKEN = "w".repeat(32); });
afterEach(() => { delete process.env.AGENT_QUEUE_DB_URL; delete process.env.AGENT_WORKER_TOKEN; fs.rmSync(file, { force: true }); });

describe("requester isolation (AC-025)", () => {
  it("never lets requester B read, audit, cancel, retry, or execute requester A's job", async () => {
    const made = await make();
    expect(made.status).toBe(202);
    const a = cookieOf(made); const id = ((await made.json()) as { job: { job_id: string } }).job.job_id;
    const b = cookieOf(await make());
    expect(b).not.toBe(a);
    expect((await read(call(a), ctx(id))).status).toBe(200);
    for (const response of [await read(call(b), ctx(id)), await audit(call(b), ctx(id)), await cancel(call(b, { method: "POST" }), ctx(id)), await retry(call(b, { method: "POST" }), ctx(id)), await execute(call(b, { method: "POST" }), ctx(id))]) {
      expect(response.status).toBe(404);
    }
    expect(((await (await read(call(a), ctx(id))).json()) as { job: { status: string } }).job.status).toBe("queued");
  });

  it("rejects a wrong worker token and an anonymous caller on execute", async () => {
    const made = await make();
    const id = ((await made.json()) as { job: { job_id: string } }).job.job_id;
    const wrong = await execute(call("", { method: "POST", headers: { authorization: `Bearer ${"x".repeat(32)}` } }), ctx(id));
    expect(wrong.status).toBe(404); // falls through to requester identity, which does not own the job
    const anon = await execute(new Request("http://localhost/x", { method: "POST" }), ctx(id));
    expect(anon.status).toBe(404);
  });
});

describe("cancel, retry, and audit", () => {
  it("cancels a queued job, refuses to retry a non-failed one, and exposes a metadata-only audit record", async () => {
    const made = await make(); const sid = cookieOf(made);
    const id = ((await made.json()) as { job: { job_id: string } }).job.job_id;
    expect((await retry(call(sid, { method: "POST" }), ctx(id))).status).toBe(409);
    const cancelled = await cancel(call(sid, { method: "POST" }), ctx(id));
    expect(((await cancelled.json()) as { job: { status: string } }).job.status).toBe("cancelled");
    const record = await audit(call(sid), ctx(id));
    const text = await record.text();
    expect(JSON.parse(text).audit).toMatchObject({ job_id: id, status: "cancelled", workflow: "economics.explain", events: [{ to_status: "queued" }, { to_status: "cancelled" }] });
    expect(text).not.toContain("why?");
  });
});
