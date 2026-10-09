import { AgentQueueStore, queueConfig } from "@/lib/server/agent/queueStore";
import { guardPanelRequest } from "@/lib/server/agent/guard";
import { apiJson, correlationId } from "@/lib/server/agent/runtime";
import { localOptIn, profileStates } from "@/lib/server/llm/profiles";

export const runtime = "nodejs";

// Data Ops profile card: each profile's dry-run state (no network call), plus today's token usage when
// the queue database is configured. Metadata only: no endpoint, header, key, or environment value.
export async function GET(request: Request) {
  const correlation = correlationId(request);
  const guard = guardPanelRequest(request);
  if (!guard.ok) return guard.response;
  const states = profileStates("interpreter", ["public_market_data", "module_context"], { assumeEnabled: localOptIn() });
  const store = queueConfig() ? new AgentQueueStore() : null;
  const profiles = await Promise.all(states.map(async (s) => {
    let usage: { input_tokens: number; output_tokens: number } | null = null;
    if (store && s.api_style !== "none") { try { usage = await store.usageToday(s.id); } catch { usage = null; } }
    return { ...s, usage_today: usage };
  }));
  return apiJson({ profiles, queue_configured: store !== null }, { headers: guard.headers, correlation });
}
