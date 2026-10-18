import { randomUUID } from "node:crypto";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";

const DEFAULT_SERVICE_URL = "http://127.0.0.1:8014";
const PROBE_TIMEOUT_MS = 2500;

type Readiness = "READY" | "UNCONFIGURED" | "UNAVAILABLE" | "INCOMPATIBLE";

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

async function probe(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: response.ok, status: response.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/econ/mmkt-service
 *
 * Reports what the MMKT module needs before a run can start: the configured service URL,
 * whether the terminal holds a service token, the unauthenticated health probe, and the
 * authenticated capability manifest (model binding). It never reveals the token.
 */
export async function GET() {
  const baseUrl = env("MONEY_MARKET_API_URL") ?? DEFAULT_SERVICE_URL;
  const token = env("MONEY_MARKET_API_TOKEN");
  const headers = { "cache-control": "no-store" };
  const base = {
    url_configured: Boolean(env("MONEY_MARKET_API_URL")),
    token_configured: Boolean(token),
    model_status: null as string | null,
    binding_id: null as string | null,
    api_schema_version: null as string | null,
  };

  let url: URL;
  try {
    url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
  } catch {
    return json({ ...base, service_health: "INCOMPATIBLE" as Readiness, detail: "MONEY_MARKET_API_URL is invalid." }, { headers });
  }

  const health = await probe(new URL("/health", url).toString());
  if (!health || !health.ok || !health.body) {
    return json({
      ...base,
      service_health: "UNAVAILABLE" as Readiness,
      detail: "The MMKT service is not reachable. Start services/money_market_api on port 8014.",
    }, { headers });
  }
  const body = health.body;
  if (body.status !== "ready" && body.status !== "unconfigured") {
    return json({ ...base, service_health: "INCOMPATIBLE" as Readiness, detail: "Health response does not match the MMKT contract." }, { headers });
  }
  const ready = body.status === "ready" && body.ready === true;
  const result = {
    ...base,
    service_health: (ready ? "READY" : "UNCONFIGURED") as Readiness,
    model_status: typeof body.model_status === "string" ? body.model_status : null,
    api_schema_version: typeof body.api_schema_version === "string" ? body.api_schema_version : null,
    detail: ready
      ? "Service is reachable with an enabled model binding."
      : "Service is reachable but has no model binding. Set MONEY_MARKET_MODEL_BINDING=local-mmkt-lp-v1 on the service.",
  };
  if (!ready || !token) {
    return json(token ? result : { ...result, detail: `${result.detail} The terminal has no MONEY_MARKET_API_TOKEN.` }, { headers });
  }

  const capabilities = await probe(new URL("/v1/capabilities", url).toString(), {
    headers: { authorization: `Bearer ${token}`, "x-correlation-id": randomUUID(), accept: "application/json" },
  });
  if (!capabilities || !capabilities.ok || !capabilities.body) {
    return json({
      ...result,
      service_health: "INCOMPATIBLE" as Readiness,
      detail: capabilities?.status === 401 || capabilities?.status === 403
        ? "The service rejected the terminal token. MONEY_MARKET_API_TOKEN must match on both sides."
        : "The capability manifest could not be read.",
    }, { headers });
  }
  return json({
    ...result,
    binding_id: typeof capabilities.body.binding_id === "string" ? capabilities.body.binding_id : null,
  }, { headers });
}
