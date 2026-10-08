import { AgentQueueStore } from "@/lib/server/agent/queueStore";
import { checkGate } from "@/lib/server/agent/gate";
import { guardPanelRequest } from "@/lib/server/agent/guard";
import { agentConfig, apiError, apiJson, correlationId } from "@/lib/server/agent/runtime";

export const runtime = "nodejs";

// Data Ops metrics: counts, ages, digests, and capability names only (no question text).
export async function GET(request: Request) {
  const correlation = correlationId(request);
  const guard = guardPanelRequest(request);
  if (!guard.ok) return guard.response;
  try {
    const store = new AgentQueueStore();
    const [stats, paused] = await Promise.all([store.stats(), store.isPaused()]);
    const cutoff = Date.now() - agentConfig.limits.heartbeat_seconds * 2000;
    const workers = stats.workers.map((w) => ({ ...w, online: Date.parse(w.last_seen_at) >= cutoff }));
    return apiJson({
      gate: checkGate().open ? "open" : "closed", paused, queued: stats.queued, running: stats.running,
      oldest_queued_age_seconds: stats.oldest_queued_at ? Math.max(0, Math.round((Date.now() - Date.parse(stats.oldest_queued_at)) / 1000)) : null,
      outcomes: stats.outcomes, workers,
    }, { headers: guard.headers, correlation });
  } catch (error) {
    return apiError((error as Error).message === "AGENT_QUEUE_NOT_CONFIGURED" ? "AGENT_QUEUE_NOT_CONFIGURED" : "AGENT_QUEUE_ERROR", 503, correlation, guard.headers);
  }
}
