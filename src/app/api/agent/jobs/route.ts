import { json } from "@/lib/server/http";
import { validateContract } from "@/lib/agent/validate";
import { AgentQueueStore } from "@/lib/server/agent/queueStore";
import { requesterHeaders, requesterId } from "@/lib/server/agent/requester";
import type { AgentJobCreateRequest } from "@/lib/agent/contracts/job.generated";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const identity = requesterId(request);
  const body = await request.json().catch(() => null);
  const checked = validateContract("job", body);
  if (!checked.ok) return json({ error_code: "AGENT_CONTEXT_INVALID", issues: checked.issues }, { status: 400, headers: requesterHeaders(identity.id, identity.isNew) });
  try {
    const job = await new AgentQueueStore().create(identity.id, body as AgentJobCreateRequest);
    return json({ job }, { status: 202, headers: { ...requesterHeaders(identity.id, identity.isNew), "cache-control": "no-store" } });
  } catch (error) {
    const message = (error as Error).message;
    const status = message === "AGENT_QUEUE_NOT_CONFIGURED" ? 503 : 500;
    return json({ error_code: message === "AGENT_QUEUE_NOT_CONFIGURED" ? message : "AGENT_QUEUE_ERROR", message: status === 503 ? "AGENT_QUEUE_DB_URL is not configured." : "Agent queue unavailable." }, { status, headers: requesterHeaders(identity.id, identity.isNew) });
  }
}
