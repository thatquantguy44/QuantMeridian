import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentQueueStore } from "./queueStore";

const files: string[] = [];
const body = {
  schema_version: "agent-job/1",
  module: "ECOIQ",
  thread_id: "5d0c7a2e-1111-4222-8333-444455556666",
  workflow: "economics.explain",
  message: "Why did the 2s10s curve move?",
  context: { series: [{ source: "econ", id: "DGS2" }, { source: "econ", id: "DGS10" }], tenors: ["2Y", "10Y"] },
  profile: "deterministic",
};

afterEach(() => { for (const file of files.splice(0)) fs.rmSync(file, { force: true }); });

describe("AgentQueueStore", () => {
  it("creates, isolates, cancels, and retries jobs", async () => {
    const file = path.join(os.tmpdir(), `ecoiq-agent-${Date.now()}-${Math.random()}.db`); files.push(file);
    const store = new AgentQueueStore({ url: `sqlite:${file}`, backend: "sqlite" });
    const created = await store.create("requester-a", body as never);
    expect(created.status).toBe("queued");
    expect(await store.get(created.job_id, "requester-b")).toBeNull();
    expect((await store.transition(created.job_id, "requester-a", "cancelled"))?.status).toBe("cancelled");
    expect((await store.transition(created.job_id, "requester-a", "queued"))?.status).toBe("queued");
  });

  it("pauses and resumes through agent_control", async () => {
    const file = path.join(os.tmpdir(), `ecoiq-agent-${Date.now()}-${Math.random()}.db`); files.push(file);
    const store = new AgentQueueStore({ url: `sqlite:${file}`, backend: "sqlite" });
    expect(await store.isPaused()).toBe(false);
    await store.setPaused(true); expect(await store.isPaused()).toBe(true);
    await store.setPaused(false); expect(await store.isPaused()).toBe(false);
  });

  it("looks up a job for the worker without a requester filter", async () => {
    const file = path.join(os.tmpdir(), `ecoiq-agent-${Date.now()}-${Math.random()}.db`); files.push(file);
    const store = new AgentQueueStore({ url: `sqlite:${file}`, backend: "sqlite" });
    const created = await store.create("requester-a", body as never);
    expect((await store.getForWorker(created.job_id))?.requester_id).toBe("requester-a");
    expect(await store.getForWorker("missing")).toBeNull();
  });
});
