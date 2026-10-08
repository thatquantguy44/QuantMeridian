import { json } from "@/lib/server/http";
import { AgentQueueStore } from "@/lib/server/agent/queueStore";
import { requesterHeaders, requesterId } from "@/lib/server/agent/requester";

export const runtime = "nodejs";
export async function POST(request: Request, ctx: { params: Record<string, string> }) {
  const identity = requesterId(request);
  try {
    const job = await new AgentQueueStore().transition(ctx.params.id, identity.id, "queued");
    if (!job) return json({ error_code: "JOB_NOT_FOUND" }, { status: 404, headers: requesterHeaders(identity.id, identity.isNew) });
    return json({ job }, { status: 202, headers: requesterHeaders(identity.id, identity.isNew) });
  } catch (error) { return json({ error_code: "AGENT_QUEUE_ERROR", message: (error as Error).message }, { status: 503 }); }
}
