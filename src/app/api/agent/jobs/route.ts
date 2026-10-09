import { validateContract } from "@/lib/agent/validate";
import { AgentQueueStore } from "@/lib/server/agent/queueStore";
import { guardPanelRequest } from "@/lib/server/agent/guard";
import { resolveProfile } from "@/lib/server/llm/profiles";
import { agentConfig, apiError, apiJson, correlationId, missingCapabilities, moduleConfig } from "@/lib/server/agent/runtime";
import type { AgentJobCreateRequest } from "@/lib/agent/contracts/job.generated";

export const runtime = "nodejs";

const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const UUID_LIKE = /^[0-9a-fA-F-]{8,64}$/;

export async function POST(request: Request) {
  const correlation = correlationId(request);
  const guard = guardPanelRequest(request);
  if (!guard.ok) return guard.response;
  const fail = (code: string, status: number, extra: Record<string, unknown> = {}) => apiError(code, status, correlation, guard.headers, extra);
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!KEY.test(key)) return fail("AGENT_CONTEXT_INVALID", 400, { message: "An Idempotency-Key header (8-128 URL-safe characters) is required." });

  const raw = await request.text();
  if (raw.length > agentConfig.limits.max_context_bytes * 4) return fail("AGENT_CONTEXT_INVALID", 400, { message: "Request body too large." });
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { /* validated below */ }
  const checked = validateContract("job", body);
  if (!checked.ok) return fail(((body as { inputs?: unknown } | null)?.inputs ? "AGENT_INPUTS_INVALID" : "AGENT_CONTEXT_INVALID"), 400, { issues: checked.issues });
  const job = body as AgentJobCreateRequest;

  const mod = moduleConfig(job.module);
  if (!mod || !mod.enabled) return fail("AGENT_MODULE_DISABLED", 403);
  const workflow = agentConfig.workflows[job.workflow as keyof typeof agentConfig.workflows];
  if (!workflow || !mod.workflows.includes(job.workflow)) return fail("WORKFLOW_UNKNOWN", 400);
  if (!workflow.enabled) return fail("WORKFLOW_NOT_READY", 409, { message: "Workflow is not enabled." });
  if (!UUID_LIKE.test(job.thread_id)) return fail("AGENT_CONTEXT_INVALID", 400);

  const context = job.context ?? {};
  const unexpected = Object.keys(context).filter((field) => !(mod.context_fields as string[]).includes(field));
  if (unexpected.length) return fail("AGENT_CONTEXT_INVALID", 400, { message: `Context fields not allowed for ${job.module}: ${unexpected.join(", ")}` });
  if (JSON.stringify(context).length > agentConfig.limits.max_context_bytes) return fail("AGENT_CONTEXT_INVALID", 400, { message: "Context too large." });
  if ((job.message ?? "").length > agentConfig.limits.max_message_chars) return fail("AGENT_CONTEXT_INVALID", 400, { message: "Message too long." });

  if (job.profile) {
    if (!mod.profile_override) return fail("LLM_PROFILE_NOT_ALLOWED", 403);
    const uses = workflow.uses.length ? workflow.uses : (["interpreter"] as const);
    for (const use of uses) {
      const resolved = resolveProfile({ requested: job.profile, use, dataClasses: workflow.data_classes });
      if (resolved.ok) continue;
      return fail(resolved.code, resolved.code === "LLM_PROFILE_UNKNOWN" ? 400 : resolved.code === "LLM_PROFILE_NOT_ALLOWED" ? 403 : 409, { message: resolved.detail });
    }
  }

  try {
    const store = new AgentQueueStore();
    if (await store.isPaused()) return fail("AGENT_DISABLED", 503, { message: "Agent workflows are paused." });
    const needed = missingCapabilities(workflow, (await store.liveCapabilities(agentConfig.limits.heartbeat_seconds * 2)).capabilities, job.kind);
    if (needed.length) return fail("WORKFLOW_NOT_READY", 409, { missing_capabilities: needed });
    const created = await store.create(guard.requesterId, job, {
      idempotencyKey: key, correlationId: correlation, workflowVersion: workflow.version, maxAttempts: agentConfig.limits.max_attempts,
      queueTtlHours: agentConfig.limits.queue_ttl_hours, maxQueued: agentConfig.limits.max_queued_per_requester,
    });
    if (!created.ok) return fail(created.code, created.code === "AGENT_QUEUE_LIMIT" ? 429 : 409);
    return apiJson({ job: created.job }, { status: created.created ? 202 : 200, headers: guard.headers, correlation });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "AGENT_QUEUE_NOT_CONFIGURED") return fail(message, 503, { message: "AGENT_QUEUE_DB_URL is not configured." });
    return fail("AGENT_QUEUE_ERROR", 500, { message: "Agent queue unavailable." });
  }
}

export async function GET(request: Request) {
  const correlation = correlationId(request);
  const guard = guardPanelRequest(request);
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const module = url.searchParams.get("module") ?? ""; const thread = url.searchParams.get("thread") ?? "";
  if (!moduleConfig(module) || !UUID_LIKE.test(thread)) return apiError("AGENT_CONTEXT_INVALID", 400, correlation, guard.headers);
  try {
    // Pending verifications run here once the verifier exists (T-017).
    const jobs = await new AgentQueueStore().listThread(guard.requesterId, module, thread);
    return apiJson({ jobs }, { headers: guard.headers, correlation });
  } catch (error) {
    if ((error as Error).message === "AGENT_QUEUE_NOT_CONFIGURED") return apiError("AGENT_QUEUE_NOT_CONFIGURED", 503, correlation, guard.headers);
    return apiError("AGENT_QUEUE_ERROR", 500, correlation, guard.headers);
  }
}
