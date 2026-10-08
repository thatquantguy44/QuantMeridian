import { json } from "@/lib/server/http";
import { AgentQueueStore } from "@/lib/server/agent/queueStore";
import { guardPanelRequest } from "@/lib/server/agent/guard";

export const runtime = "nodejs";

export async function GET(request: Request, ctx: { params: Record<string, string> }) {
  const guard = guardPanelRequest(request);
  if (!guard.ok) return guard.response;
  try {
    const job = await new AgentQueueStore().get(ctx.params.id, guard.requesterId);
    if (!job) return json({ error_code: "JOB_NOT_FOUND" }, { status: 404, headers: guard.headers });
    return json({ job }, { headers: { ...guard.headers, "cache-control": "no-store" } });
  } catch (error) { return json({ error_code: "AGENT_QUEUE_ERROR", message: (error as Error).message }, { status: 503 }); }
}
