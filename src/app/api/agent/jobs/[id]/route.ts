import { json } from "@/lib/server/http";
import { AgentQueueStore } from "@/lib/server/agent/queueStore";
import { requesterHeaders, requesterId } from "@/lib/server/agent/requester";

export const runtime = "nodejs";

export async function GET(_request: Request, ctx: { params: Record<string, string> }) {
  const identity = requesterId(_request);
  try {
    const job = await new AgentQueueStore().get(ctx.params.id, identity.id);
    if (!job) return json({ error_code: "JOB_NOT_FOUND" }, { status: 404, headers: requesterHeaders(identity.id, identity.isNew) });
    return json({ job }, { headers: { ...requesterHeaders(identity.id, identity.isNew), "cache-control": "no-store" } });
  } catch (error) { return json({ error_code: "AGENT_QUEUE_ERROR", message: (error as Error).message }, { status: 503 }); }
}
