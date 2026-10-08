import { json } from "@/lib/server/http";
import { executeEcoIqJob } from "@/lib/server/agent/ecoiqExecutor";
import { AgentQueueStore } from "@/lib/server/agent/queueStore";
import { requesterHeaders, requesterId } from "@/lib/server/agent/requester";

export const runtime = "nodejs";

export async function POST(request: Request, ctx: { params: Record<string, string> }) {
  const identity = requesterId(request);
  try {
    const job = await new AgentQueueStore().get(ctx.params.id, identity.id);
    if (!job) return json({ error_code: "JOB_NOT_FOUND" }, { status: 404, headers: requesterHeaders(identity.id, identity.isNew) });
    if (job.status !== "queued" && job.status !== "running") return json({ error_code: "JOB_NOT_QUEUED" }, { status: 409, headers: requesterHeaders(identity.id, identity.isNew) });
    const result = await executeEcoIqJob(job.job_id, identity.id, job.message ?? "Why did the Treasury curve move?", job.workflow as "economics.explain" | "economics.transmission" | "economics.scenario", job.profile);
    return json({ result }, { headers: requesterHeaders(identity.id, identity.isNew) });
  } catch (error) { return json({ error_code: "AGENT_EXECUTION_ERROR", message: (error as Error).message }, { status: 503 }); }
}
