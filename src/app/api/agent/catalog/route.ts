import { AgentQueueStore, queueConfig } from "@/lib/server/agent/queueStore";
import { guardPanelRequest } from "@/lib/server/agent/guard";
import { agentConfig, apiError, apiJson, correlationId, missingCapabilities, moduleConfig, profileOptions } from "@/lib/server/agent/runtime";

export const runtime = "nodejs";

// Panel bootstrap. Sets the requester cookie; offers a workflow only if config enables it and a
// ready worker heartbeat lists every capability it requires.
export async function GET(request: Request) {
  const correlation = correlationId(request);
  const guard = guardPanelRequest(request);
  if (!guard.ok) return guard.response;
  const code = new URL(request.url).searchParams.get("module") ?? "";
  const mod = moduleConfig(code);
  if (!mod || !mod.enabled) return apiError("AGENT_MODULE_DISABLED", 403, correlation, guard.headers);

  let live = { workers: 0, capabilities: new Set<string>() }; let paused = false; let queueState: "ok" | "not_configured" | "error" = "ok";
  if (!queueConfig()) queueState = "not_configured";
  else {
    try { const store = new AgentQueueStore(); paused = await store.isPaused(); live = await store.liveCapabilities(agentConfig.limits.heartbeat_seconds * 2); } catch { queueState = "error"; }
  }
  const workflows = mod.workflows.flatMap((id) => {
    const wf = agentConfig.workflows[id];
    if (!wf || !wf.enabled) return [];
    const missing = missingCapabilities(wf, live.capabilities);
    const kinds = Object.entries(wf.kinds ?? {}).map(([kind]) => ({ kind, missing_capabilities: missingCapabilities(wf, live.capabilities, kind) })).filter((k) => k.missing_capabilities.length === 0).map((k) => k.kind);
    return [{ id, version: wf.version, llm: wf.llm, offered: missing.length === 0 && queueState === "ok" && !paused, missing_capabilities: missing, kinds }];
  });
  return apiJson({
    module: code, enabled: true, paused, queue: queueState, workflows, context_fields: mod.context_fields, profiles: profileOptions(mod),
    default_profile: mod.default_profile, limits: agentConfig.limits, worker: { online: live.workers > 0, workers: live.workers },
  }, { headers: guard.headers, correlation });
}
