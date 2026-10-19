import { json } from "@/lib/server/http";
import http from "node:http";
import https from "node:https";

const DEFAULT_BASE_URL = "http://127.0.0.1:8013";
const MAX_PROXY_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 70_000;
let serviceFetchQueue: Promise<void> = Promise.resolve();

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

function nodeHeaders(headers: HeadersInit | undefined): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  if (!headers) return out;
  const source = new Headers(headers);
  source.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function responseHeaders(headers: http.IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) value.forEach((item) => out.append(key, item));
    else if (typeof value === "string") out.set(key, value);
  }
  return out;
}

function bodyBuffer(body: BodyInit | null | undefined): Buffer | undefined {
  if (!body) return undefined;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (typeof body === "string") return Buffer.from(body);
  return undefined;
}

function serviceRequest(input: string | URL, init: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? new URL(input) : input;
  const transport = url.protocol === "https:" ? https : http;
  const body = bodyBuffer(init.body);
  return new Promise<Response>((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: init.method ?? "GET",
        headers: nodeHeaders(init.headers),
        signal: init.signal ?? undefined,
      },
      (upstream) => {
        const chunks: Buffer[] = [];
        upstream.on("data", (chunk) => chunks.push(chunk as Buffer));
        upstream.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: upstream.statusCode ?? 502,
              statusText: upstream.statusMessage,
              headers: responseHeaders(upstream.headers),
            })
          );
        });
      }
    );
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

async function serviceFetch(input: string | URL, init: RequestInit): Promise<Response> {
  const run = () => serviceRequest(input, init);
  const queued = serviceFetchQueue.then(run, run);
  serviceFetchQueue = queued.then(
    () => undefined,
    () => undefined
  );
  return queued;
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
    configured: Boolean(serviceToken()),
    production,
    productionEnabled: !production || truthy(env("IBAL_PRODUCTION_ENABLED")),
    trustedAccessBoundary: !production || truthy(env("IBAL_TRUSTED_ACCESS_BOUNDARY")),
  };
}

export async function inventoryOptimizerHealthSnapshot(timeoutMs = 3000) {
  const status = inventoryOptimizerStatus();
  if (!status.configured) {
    return {
      ok: false,
      reachable: false,
      ready: false,
      code: "IBAL_TOKEN_MISSING",
      detail: "IBAL service token is not configured.",
      status,
    };
  }
  if (!status.productionEnabled) {
    return {
      ok: false,
      reachable: false,
      ready: false,
      code: "IBAL_PRODUCTION_DISABLED",
      detail: "IBAL production access is disabled.",
      status,
    };
  }
  if (!status.trustedAccessBoundary) {
    return {
      ok: false,
      reachable: false,
      ready: false,
      code: "IBAL_TRUSTED_BOUNDARY_MISSING",
      detail: "IBAL requires a trusted access boundary in production.",
      status,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await serviceFetch(`${serviceBaseUrl()}/health`, {
      cache: "no-store",
      signal: controller.signal,
    });
    const latencyMs = Math.round(performance.now() - started);
    const body = await response.json().catch(() => ({}));
    const ready = response.ok && Boolean(body.ready);
    return {
      ok: response.ok,
      reachable: true,
      ready,
      code: ready ? "IBAL_READY" : "IBAL_ENGINE_NOT_READY",
      detail: ready ? "IBAL service reachable and engine ready." : "IBAL service reachable but engine is not ready.",
      latencyMs,
      health: {
        status: body.status,
        ready: body.ready,
        api_schema_version: body.api_schema_version,
        engine_package_version: body.engine_package_version,
        backend: body.backend,
        error_category: body.error_category,
      },
      status,
    };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    return {
      ok: false,
      reachable: false,
      ready: false,
      code: aborted ? "IBAL_HEALTH_TIMEOUT" : "IBAL_HEALTH_UNREACHABLE",
      detail: aborted ? "IBAL service health probe timed out." : "IBAL service health probe failed.",
      status,
    };
  } finally {
    clearTimeout(timer);
  }
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
  if (upstreamPath === "/v1/runs" || upstreamPath === "/v1/scenarios/stress-test" || upstreamPath === "/v1/showcase/runs" || upstreamPath === "/v1/showcase/edited-runs") {
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
    const upstream = await serviceFetch(upstreamUrl, {
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
