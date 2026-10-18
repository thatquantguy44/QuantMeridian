import { json } from "@/lib/server/http";
import { isCollateralRun } from "@/lib/collateralOptimizer";
import bindingManifest from "../../../services/collateral_optimizer_api/binding-manifest.json";

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

function failure(status: number, code: string, message: string) {
  return json({ api_schema_version: "1.0.0", code, category: "transport", message },
    { status, headers: { "cache-control": "no-store" } });
}

export async function collateralProxy(request: Request, path: string, method: "GET" | "POST") {
  const base = process.env.COLLATERAL_OPTIMIZER_API_URL?.trim();
  const token = process.env.COLLATERAL_OPTIMIZER_API_TOKEN?.trim();
  if (!base || !token) return failure(503, "BINDING_UNCONFIGURED", "Collateral service URL or token is missing.");
  // The spec015 identity, audit, and governed-source gates remain open.
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production")
    return failure(403, "PRODUCTION_DISABLED", "Collateral preview is local-only pending source and access approval.");
  let target: URL;
  try {
    target = new URL(path, base.endsWith("/") ? base : base + "/");
    if (target.protocol !== "http:" && target.protocol !== "https:") throw Error("protocol");
  } catch {
    return failure(503, "BINDING_INCOMPATIBLE", "Collateral service URL is invalid.");
  }
  let body: ArrayBuffer | undefined;
  if (method === "POST") {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return failure(413, "REQUEST_TOO_LARGE", "Maximum request size is 2 MiB.");
    try {
      const payload = JSON.parse(new TextDecoder().decode(body)) as { source_mode?: string };
      if (payload.source_mode === "PRODUCTION_BOOK")
        return failure(403, "PRODUCTION_BOOK_DISABLED", "Governed book and execution gates are not approved.");
    } catch {
      return failure(422, "REQUEST_INVALID", "Request must be JSON.");
    }
  }
  const correlation = crypto.randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(target, { method, body, signal: controller.signal,
      cache: "no-store", headers: { authorization: "Bearer " + token,
        "content-type": "application/json", "x-correlation-id": correlation,
        "idempotency-key": request.headers.get("idempotency-key") ?? crypto.randomUUID() } });
    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES * 4) return failure(502, "RESPONSE_TOO_LARGE", "Collateral response exceeded the limit.");
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { return failure(502, "RESPONSE_INVALID", "Collateral service returned invalid JSON."); }
    if (upstream.ok && path === "/v1/runs") {
      if (!isCollateralRun(payload) || payload.model_commit !== bindingManifest.commit ||
          payload.package_version !== bindingManifest.package_version ||
          payload.wheel_sha256 !== bindingManifest.wheel_sha256)
        return failure(502, "RESPONSE_INCOMPATIBLE", "Collateral result failed the terminal pin or contract check.");
    }
    if (upstream.ok && path === "/health") {
      const health = payload as { ready?: boolean; source_commit?: string; wheel_sha256?: string };
      if (health.ready && (health.source_commit !== bindingManifest.commit ||
                           health.wheel_sha256 !== bindingManifest.wheel_sha256))
        return failure(502, "BINDING_INCOMPATIBLE", "Collateral service reports a different artifact.");
    }
    return json(payload, { status: upstream.status, headers: { "cache-control": "no-store",
      "x-correlation-id": correlation } });
  } catch (error) {
    return failure(error instanceof DOMException && error.name === "AbortError" ? 504 : 503,
      "SERVICE_UNAVAILABLE", "Collateral service is unavailable or timed out.");
  } finally { clearTimeout(timer); }
}
