import { AgentQueueStore } from "@/lib/server/agent/queueStore";
import { guardPanelRequest } from "@/lib/server/agent/guard";
import { agentConfig, apiError, apiJson, correlationId } from "@/lib/server/agent/runtime";

export const runtime = "nodejs";

// Retry creates a new job with `retry_of` for a failed or expired job.
export async function POST(request: Request, ctx: { params: Record<string, string> }) {
  const correlation = correlationId(request);
  const guard = guardPanelRequest(request);
  if (!guard.ok) return guard.response;
  try {
    const store = new AgentQueueStore();
    if (await store.isPaused()) return apiError("AGENT_DISABLED", 503, correlation, guard.headers);
    const original = await store.get(ctx.params.id, guard.requesterId);
    if (!original) return apiError("JOB_NOT_FOUND", 404, correlation, guard.headers);
    const workflow = agentConfig.workflows[original.workflow as keyof typeof agentConfig.workflows];
    const result = await store.retry(ctx.params.id, guard.requesterId, {
      correlationId: correlation, workflowVersion: workflow?.version ?? original.workflow_version, maxAttempts: agentConfig.limits.max_attempts,
      queueTtlHours: agentConfig.limits.queue_ttl_hours, maxQueued: agentConfig.limits.max_queued_per_requester,
    });
    if (!result) return apiError("JOB_NOT_RETRYABLE", 409, correlation, guard.headers);
    if (!result.ok) return apiError(result.code, result.code === "AGENT_QUEUE_LIMIT" ? 429 : 409, correlation, guard.headers);
    return apiJson({ job: result.job }, { status: result.created ? 202 : 200, headers: guard.headers, correlation });
  } catch (error) {
    return apiError((error as Error).message === "AGENT_QUEUE_NOT_CONFIGURED" ? "AGENT_QUEUE_NOT_CONFIGURED" : "AGENT_QUEUE_ERROR", 503, correlation, guard.headers);
  }
}
