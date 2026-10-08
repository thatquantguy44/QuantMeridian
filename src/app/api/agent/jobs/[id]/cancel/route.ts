import { AgentQueueStore } from "@/lib/server/agent/queueStore";
import { guardPanelRequest } from "@/lib/server/agent/guard";
import { apiError, apiJson, correlationId } from "@/lib/server/agent/runtime";

export const runtime = "nodejs";

export async function POST(request: Request, ctx: { params: Record<string, string> }) {
  const correlation = correlationId(request);
  const guard = guardPanelRequest(request);
  if (!guard.ok) return guard.response;
  try {
    const job = await new AgentQueueStore().cancel(ctx.params.id, guard.requesterId);
    if (!job) return apiError("JOB_NOT_FOUND", 404, correlation, guard.headers);
    return apiJson({ job }, { headers: guard.headers, correlation });
  } catch (error) {
    return apiError((error as Error).message === "AGENT_QUEUE_NOT_CONFIGURED" ? "AGENT_QUEUE_NOT_CONFIGURED" : "AGENT_QUEUE_ERROR", 503, correlation, guard.headers);
  }
}
