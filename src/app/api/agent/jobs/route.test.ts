import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/server/agent/queueStore", () => ({ AgentQueueStore: class { create = mocks.create; } }));
import { POST } from "./route";

describe("POST /api/agent/jobs", () => {
  it("returns explicit not-configured state when the queue DB is absent", async () => {
    mocks.create.mockRejectedValue(new Error("AGENT_QUEUE_NOT_CONFIGURED"));
    const response = await POST(new Request("http://localhost/api/agent/jobs", { method: "POST", body: JSON.stringify({ schema_version: "agent-job/1", module: "ECOIQ", thread_id: "5d0c7a2e-1111-4222-8333-444455556666", workflow: "economics.explain", context: {} }) }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error_code: "AGENT_QUEUE_NOT_CONFIGURED" });
  });

  it("creates a queued job and sets a requester cookie", async () => {
    mocks.create.mockReset();
    mocks.create.mockResolvedValue({ job_id: "job-1", status: "queued" });
    const response = await POST(new Request("http://localhost/api/agent/jobs", { method: "POST", body: JSON.stringify({ schema_version: "agent-job/1", module: "ECOIQ", thread_id: "5d0c7a2e-1111-4222-8333-444455556666", workflow: "economics.explain", context: {} }) }));
    expect(response.status).toBe(202);
    expect(response.headers.get("set-cookie")).toContain("agent_sid=");
    await expect(response.json()).resolves.toMatchObject({ job: { status: "queued" } });
  });
});
