import { AgentQueueStore } from "@/lib/server/agent/queueStore";
import { guardPanelRequest } from "@/lib/server/agent/guard";
import { apiError, apiJson, correlationId } from "@/lib/server/agent/runtime";

export const runtime = "nodejs";

// Metadata-only record: lifecycle events and versions, never the question, inputs, context, or output.
export async function GET(request: Request, ctx: { params: Record<string, string> }) {
  const correlation = correlationId(request);
  const guard = guardPanelRequest(request);
  if (!guard.ok) return guard.response;
  try {
    const store = new AgentQueueStore();
    const job = await store.get(ctx.params.id, guard.requesterId);
    const events = job ? await store.events(ctx.params.id, guard.requesterId) : null;
    if (!job || !events) return apiError("JOB_NOT_FOUND", 404, correlation, guard.headers);
    return apiJson({
      audit: {
        job_id: job.job_id, module: job.module, workflow: job.workflow, kind: job.kind, workflow_version: job.workflow_version,
        profile_requested: job.profile, status: job.status, attempts: job.attempts, error_code: job.error_code, retry_of: job.retry_of,
        correlation_id: job.correlation_id, created_at: job.created_at, started_at: job.started_at, finished_at: job.finished_at, expires_at: job.expires_at,
        events: events.map(({ at, from_status, to_status, actor, code }) => ({ at, from_status, to_status, actor, code })),
      },
    }, { headers: guard.headers, correlation });
  } catch (error) {
    return apiError((error as Error).message === "AGENT_QUEUE_NOT_CONFIGURED" ? "AGENT_QUEUE_NOT_CONFIGURED" : "AGENT_QUEUE_ERROR", 503, correlation, guard.headers);
  }
}
