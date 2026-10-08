import { json } from "@/lib/server/http";
import { executeEcoIqJob } from "@/lib/server/agent/ecoiqExecutor";
import { AgentQueueStore } from "@/lib/server/agent/queueStore";
import { guardPanelRequest, guardWorkerRequest } from "@/lib/server/agent/guard";
import { verifyWorkerToken } from "@/lib/server/agent/gate";

export const runtime = "nodejs";

// Attended execution: the job's own requester (browser) or the worker (bearer token) may run it.
export async function POST(request: Request, ctx: { params: Record<string, string> }) {
  const fromWorker = request.headers.has("authorization") && verifyWorkerToken(request);
  const guard = fromWorker ? null : guardPanelRequest(request);
  if (guard && !guard.ok) return guard.response;
  if (fromWorker) { const gate = guardWorkerRequest(request); if (!gate.ok) return gate.response; }
  const headers = guard?.ok ? guard.headers : undefined;
  try {
    const store = new AgentQueueStore();
    if (await store.isPaused()) return json({ error_code: "AGENT_PAUSED" }, { status: 503, headers });
    const job = fromWorker ? await store.getForWorker(ctx.params.id) : await store.get(ctx.params.id, (guard as { requesterId: string }).requesterId);
    if (!job) return json({ error_code: "JOB_NOT_FOUND" }, { status: 404, headers });
    if (job.status !== "queued" && job.status !== "running") return json({ error_code: "JOB_NOT_QUEUED" }, { status: 409, headers });
    const result = await executeEcoIqJob(job.job_id, job.requester_id, job.message ?? "Why did the Treasury curve move?", job.workflow as "economics.explain" | "economics.transmission" | "economics.scenario", job.profile);
    return json({ result }, { headers });
  } catch (error) { return json({ error_code: "AGENT_EXECUTION_ERROR", message: (error as Error).message }, { status: 503 }); }
}
