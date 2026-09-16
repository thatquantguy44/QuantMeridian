import { json } from "@/lib/server/http";

const DEFAULT_BASE_URL = "http://127.0.0.1:8013";
const MAX_PROXY_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 70_000;

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function serviceBaseUrl(): string {
  return (env("INVENTORY_OPTIMIZER_API_URL") ?? env("IBAL_API_URL") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function serviceToken(): string | undefined {
  return env("INVENTORY_OPTIMIZER_API_TOKEN") ?? env("IBAL_API_TOKEN");
}

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function gate() {
  const production = isProductionRuntime();
  if (production && !truthy(env("IBAL_PRODUCTION_ENABLED"))) {
    return { ok: false as const, status: 503, code: "IBAL_PRODUCTION_DISABLED", message: "IBAL production access is disabled." };
  }
  if (production && !truthy(env("IBAL_TRUSTED_ACCESS_BOUNDARY"))) {
    return { ok: false as const, status: 503, code: "IBAL_TRUSTED_BOUNDARY_MISSING", message: "IBAL requires a trusted access boundary in production." };
  }
  const token = serviceToken();
  if (!token) {
    return { ok: false as const, status: 503, code: "IBAL_TOKEN_MISSING", message: "IBAL service token is not configured." };
  }
  return { ok: true as const, token };
}

function correlationId(request: Request): string {
  return request.headers.get("x-correlation-id") ?? crypto.randomUUID();
}

function passthroughHeaders(upstream: Response): Headers {
  const headers = new Headers();
  for (const name of ["content-type", "content-disposition", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function isBodyAllowed(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

export function inventoryOptimizerStatus() {
  const production = isProductionRuntime();
  return {
    baseUrl: serviceBaseUrl(),
    configured: Boolean(serviceToken()),
    production,
    productionEnabled: !production || truthy(env("IBAL_PRODUCTION_ENABLED")),
    trustedAccessBoundary: !production || truthy(env("IBAL_TRUSTED_ACCESS_BOUNDARY")),
  };
}

export async function proxyInventoryOptimizer(request: Request, upstreamPath: string, init?: { method?: string; timeoutMs?: number }) {
  const allowed = gate();
  if (!allowed.ok) {
    return json({ source: "ERR", ok: false, code: allowed.code, error: allowed.message, config: inventoryOptimizerStatus() }, { status: allowed.status });
  }

  const method = init?.method ?? request.method;
  const inboundUrl = new URL(request.url);
  const upstreamUrl = new URL(`${serviceBaseUrl()}${upstreamPath}`);
  inboundUrl.searchParams.forEach((value, key) => upstreamUrl.searchParams.append(key, value));

  const headers = new Headers();
  headers.set("authorization", `Bearer ${allowed.token}`);
  headers.set("x-correlation-id", correlationId(request));
  headers.set("accept", request.headers.get("accept") ?? "application/json");

  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  if (upstreamPath === "/v1/runs") {
    headers.set("idempotency-key", request.headers.get("idempotency-key") ?? crypto.randomUUID());
  }

  let body: ArrayBuffer | undefined;
  if (isBodyAllowed(method)) {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_PROXY_BYTES) {
      return json({ source: "ERR", ok: false, code: "IBAL_PROXY_SIZE", error: "Request body exceeds the IBAL 10 MiB limit." }, { status: 413 });
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: passthroughHeaders(upstream),
    });
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    return json(
      {
        source: "ERR",
        ok: false,
        code: aborted ? "IBAL_PROXY_TIMEOUT" : "IBAL_PROXY_UNAVAILABLE",
        error: aborted ? "IBAL service request timed out." : "IBAL service is unavailable.",
        config: inventoryOptimizerStatus(),
      },
      { status: aborted ? 504 : 503 }
    );
  } finally {
    clearTimeout(timer);
  }
}
