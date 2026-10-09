import { guardPanelRequest } from "@/lib/server/agent/guard";
import { apiError, apiJson, correlationId } from "@/lib/server/agent/runtime";
import { callLlm } from "@/lib/server/llm/client";
import { localOptIn, resolveProfile, type LlmUse } from "@/lib/server/llm/profiles";
import registry from "../../../../../../../settings/llm_profiles.json";

export const runtime = "nodejs";

const COOLDOWN_MS = 10_000;
const lastProbe = new Map<string, number>();

// One tiny completion against one profile. Closed while the production gate is closed (the guard).
// The response is metadata only: status, latency, the model as the provider reported it, and a code.
export async function POST(request: Request, ctx: { params: Record<string, string> }) {
  const correlation = correlationId(request);
  const guard = guardPanelRequest(request);
  if (!guard.ok) return guard.response;
  const id = ctx.params.id;
  const profile = (registry.profiles as Record<string, { uses: LlmUse[] }>)[id];
  if (!profile) return apiError("LLM_PROFILE_UNKNOWN", 404, correlation, guard.headers);

  const resolved = resolveProfile({ requested: id, use: profile.uses[0] ?? "interpreter", dataClasses: [] }, { assumeEnabled: localOptIn() });
  if (!resolved.ok) return apiJson({ profile: id, status: "unavailable", code: resolved.code, latency_ms: 0, model: null }, { headers: guard.headers, correlation });
  if (resolved.api_style === "none") return apiJson({ profile: id, status: "skipped", code: null, latency_ms: 0, model: null }, { headers: guard.headers, correlation });

  const now = Date.now();
  if (now - (lastProbe.get(id) ?? 0) < COOLDOWN_MS) return apiError("PROBE_RATE_LIMITED", 429, correlation, guard.headers);
  lastProbe.set(id, now);

  const response = await callLlm({ ...resolved, limits: { ...resolved.limits, max_retries: 0 } }, {
    workflow_id: "probe", run_id: correlation, task_type: "interpretation", prompt_id: "probe.v1",
    system: "Reply with the single word: ok", user: "ping", max_output_tokens: 8, data_classes: [], correlation_id: correlation,
  });
  return apiJson({
    profile: id, status: response.status === "completed" ? "ok" : "failed", code: response.error_code, latency_ms: response.latency_ms,
    model: response.status === "completed" ? response.model : null,
  }, { headers: guard.headers, correlation });
}
