// Same-origin hop from the terminal to the INDEM service (spec020 IND-T14). The service URL and token live
// only here, on the server. Every response is checked against the contract before it reaches the browser.
import { json } from "@/lib/server/http";
import { isRunResponse, isServiceError, type TransportErrorCode } from "@/lib/indemnificationApi";

export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
export const RUN_TIMEOUT_MS = 300_000;
export const QUICK_TIMEOUT_MS = 8_000;

export interface ServiceCall {
  path: string;
  method: "GET" | "POST";
  body?: unknown;
  idempotencyKey?: string | null;
}

function failure(status: number, code: TransportErrorCode, message: string) {
  return json({ api_schema_version: "1.0", code, category: "transport", message },
    { status, headers: { "cache-control": "no-store" } });
}

export async function indemnificationProxy(call: ServiceCall): Promise<Response> {
  const base = process.env.INDEMNIFICATION_API_URL?.trim();
  const token = process.env.INDEMNIFICATION_API_TOKEN?.trim();
  if (!base || !token) return failure(503, "BINDING_UNCONFIGURED", "The INDEM service URL or token is missing.");
  // Local-only until identity, audit and governed-source gates are approved (spec020).
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production")
    return failure(403, "PRODUCTION_DISABLED", "INDEM is local-only pending access and source approval.");
  let target: URL;
  try {
    target = new URL(call.path, base.endsWith("/") ? base : base + "/");
    if (target.protocol !== "http:" && target.protocol !== "https:") throw Error("protocol");
  } catch {
    return failure(503, "BINDING_INCOMPATIBLE", "The INDEM service URL is invalid.");
  }
  let body: string | undefined;
  if (call.body !== undefined) {
    body = JSON.stringify(call.body);
    if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES)
      return failure(413, "REQUEST_TOO_LARGE", "The request is larger than 4 MiB.");
  }
  const isRun = call.path === "/v1/runs" && call.method === "POST";
  const correlation = crypto.randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), isRun ? RUN_TIMEOUT_MS : QUICK_TIMEOUT_MS);
  const headers: Record<string, string> = {
    authorization: "Bearer " + token, "content-type": "application/json", "x-correlation-id": correlation,
  };
  if (call.idempotencyKey) headers["idempotency-key"] = call.idempotencyKey;
  try {
    const upstream = await fetch(target, { method: call.method, body, signal: controller.signal, cache: "no-store", headers });
    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength > MAX_RESPONSE_BYTES) return failure(502, "RESPONSE_TOO_LARGE", "The INDEM response exceeded the size limit.");
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { return failure(502, "RESPONSE_INVALID", "The INDEM service returned invalid JSON."); }
    const ok = upstream.ok
      ? (call.path.startsWith("/v1/runs") ? isRunResponse(payload) : typeof payload === "object" && payload !== null)
      : isServiceError(payload);
    if (!ok) return failure(502, "RESPONSE_INCOMPATIBLE", "The INDEM response did not match the contract.");
    return json(payload, { status: upstream.status, headers: { "cache-control": "no-store", "x-correlation-id": correlation } });
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    return aborted
      ? failure(504, "SERVICE_TIMEOUT", "The INDEM service did not answer in time.")
      : failure(503, "SERVICE_UNAVAILABLE", "The INDEM service is unavailable.");
  } finally { clearTimeout(timer); }
}
