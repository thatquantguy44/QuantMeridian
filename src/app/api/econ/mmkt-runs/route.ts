import { randomUUID } from "node:crypto";
import { json } from "@/lib/server/http";
import { goldConfigStatus, goldEnabled, goldStore } from "@/lib/server/goldStore";
import {
  gatePricingCandidates,
  loadGoldMmktRateSnapshot,
  MmktRateSnapshotError,
  type MmktRateSnapshot,
} from "@/lib/server/mmktRateSnapshot";
import { loadSimMmktRateSnapshot } from "@/lib/server/mmktSimRateSets";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 10 * 1024 * 1024;
const DEFAULT_SERVICE_URL = "http://127.0.0.1:8014";

function env(name: string): string | undefined {
  const value = process.env[name];
  return value?.trim() || undefined;
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function failure(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
  return json(
    { source: "ERR", ok: false, code, message, ...details },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function uuidOrNew(value: string | null): string {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : randomUUID();
}

function serviceConfig() {
  const production = isProductionRuntime();
  const token = env("MONEY_MARKET_API_TOKEN");
  const baseUrl = env("MONEY_MARKET_API_URL") ?? DEFAULT_SERVICE_URL;
  if (production && !truthy(env("MMKT_PRODUCTION_ENABLED"))) {
    return { error: failure(503, "MMKT_PRODUCTION_DISABLED", "MMKT production access is disabled.") };
  }
  if (production && !truthy(env("MMKT_TRUSTED_ACCESS_BOUNDARY"))) {
    return { error: failure(503, "MMKT_TRUSTED_BOUNDARY_MISSING", "MMKT requires a trusted access boundary in production.") };
  }
  if (!token) {
    return { error: failure(503, "MMKT_TOKEN_MISSING", "MMKT service token is not configured.") };
  }
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    return { token, baseUrl: url.toString().replace(/\/+$/, "") };
  } catch {
    return { error: failure(503, "MMKT_URL_INVALID", "MMKT service URL is invalid.") };
  }
}

/**
 * POST /api/econ/mmkt-runs
 *
 * The terminal owns market-data access. Clients submit the forecast, candidates,
 * and policy; this route attaches the authoritative rate snapshot and hash: Gold by
 * default, or a registered SIM set only when the client names it explicitly. An unknown
 * SIM set fails closed and Gold is never substituted (or vice versa).
 */
export async function POST(request: Request) {
  const service = serviceConfig();
  if ("error" in service) return service.error;

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return failure(413, "MMKT_REQUEST_TOO_LARGE", "Request body exceeds the MMKT 10 MiB limit.");
  }

  let input: unknown;
  try {
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) {
      return failure(413, "MMKT_REQUEST_TOO_LARGE", "Request body exceeds the MMKT 10 MiB limit.");
    }
    input = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return failure(400, "MMKT_REQUEST_INVALID_JSON", "Request body must be valid JSON.");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return failure(422, "MMKT_REQUEST_INVALID", "Request body must be a JSON object.");
  }

  const payload = input as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(payload, "rate_snapshot")) {
    return failure(400, "CLIENT_RATE_SNAPSHOT_NOT_ALLOWED", "Rate snapshots are attached by the terminal and cannot be supplied by the client.");
  }
  const source = payload.rate_source === undefined ? "gold" : payload.rate_source;
  if (source !== "gold" && source !== "sim") {
    return failure(400, "RATE_SOURCE_INVALID", "rate_source must be gold or sim.");
  }
  let simSnapshot: MmktRateSnapshot | undefined;
  if (source === "sim") {
    if (typeof payload.sim_set_id !== "string" || payload.sim_set_id.trim() === "") {
      return failure(400, "SIM_SET_REQUIRED", "Select a named SIM rate set explicitly.");
    }
    simSnapshot = loadSimMmktRateSnapshot(payload.sim_set_id);
    if (!simSnapshot) {
      return failure(503, "SIM_SET_UNAVAILABLE", "The selected SIM rate set is not registered; Gold data will not be substituted.", {
        selected_sim_set_id: payload.sim_set_id,
      });
    }
  } else if (payload.sim_set_id !== undefined) {
    return failure(400, "SIM_SET_NOT_ALLOWED", "sim_set_id is valid only with rate_source=sim.");
  }

  const candidates = payload.instrument_candidates;
  if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > 10_000) {
    return failure(422, "INSTRUMENT_CANDIDATES_INVALID", "instrument_candidates must contain between 1 and 10000 items.");
  }
  const candidateIds: string[] = [];
  for (const item of candidates) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return failure(422, "INSTRUMENT_CANDIDATES_INVALID", "Each instrument candidate must be an object.");
    }
    const id = (item as Record<string, unknown>).rate_instrument_id;
    if (typeof id !== "string" || id.trim() === "") {
      return failure(422, "RATE_INSTRUMENT_ID_INVALID", "Each candidate requires a non-empty rate_instrument_id.");
    }
    candidateIds.push(id);
  }
  // Multiple candidates may legitimately use the same market rate; the pricing gate
  // deduplicates rate IDs while the service keeps candidate-level identity.
  let snapshot: MmktRateSnapshot;
  if (simSnapshot) {
    snapshot = simSnapshot;
  } else {
    if (!goldEnabled()) {
      return failure(503, "GOLD_UNAVAILABLE", "Gold DB is not configured.");
    }
    try {
      snapshot = await loadGoldMmktRateSnapshot(goldStore(), goldConfigStatus().backend);
    } catch (error) {
      if (error instanceof MmktRateSnapshotError) {
        return failure(503, error.code, error.message);
      }
      console.error("[mmkt-runs] Gold read failed", {
        error_type: error instanceof Error ? error.name : "UnknownError",
      });
      return failure(503, "GOLD_READ_FAILED", "Gold rate snapshot could not be read.");
    }
  }

  const gate = simSnapshot
    ? gatePricingCandidates(snapshot, candidateIds, "SIM", true)
    : gatePricingCandidates(snapshot, candidateIds, "DB");
  if (!gate.eligible) {
    return failure(409, "RATE_CANDIDATES_INELIGIBLE", `Every candidate must have an eligible normalized ${simSnapshot ? "SIM" : "Gold"} rate.`, {
      pricing_gate: gate,
      rate_snapshot_hash: snapshot.snapshot_hash,
      rate_as_of_date: snapshot.as_of_date,
    });
  }

  const { rate_source: _rateSource, sim_set_id: _simSetId, ...requestFields } = payload;
  const requestId = typeof requestFields.request_id === "string" ? requestFields.request_id : randomUUID();
  const servicePayload = {
    ...requestFields,
    request_id: requestId,
    rate_snapshot: {
      source: snapshot.source,
      as_of_date: snapshot.as_of_date,
      snapshot_hash: snapshot.snapshot_hash,
      ...(snapshot.sim_set_id ? { sim_set_id: snapshot.sim_set_id } : {}),
      rows: snapshot.rows,
    },
  };

  const correlationId = uuidOrNew(request.headers.get("x-correlation-id"));
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() || randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 75_000);
  try {
    const upstream = await fetch(`${service.baseUrl}/v1/runs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${service.token}`,
        "content-type": "application/json",
        accept: "application/json",
        "x-correlation-id": correlationId,
        "idempotency-key": idempotencyKey.slice(0, 128),
      },
      body: JSON.stringify(servicePayload),
      cache: "no-store",
      signal: controller.signal,
    });
    const headers = new Headers();
    for (const name of ["content-type", "cache-control"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("x-correlation-id", correlationId);
    headers.set("x-rate-snapshot-hash", snapshot.snapshot_hash);
    headers.set("x-rate-source", snapshot.source);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    return failure(
      aborted ? 504 : 503,
      aborted ? "MMKT_PROXY_TIMEOUT" : "MMKT_SERVICE_UNAVAILABLE",
      aborted ? "MMKT service request timed out." : "MMKT service is unavailable.",
    );
  } finally {
    clearTimeout(timer);
  }
}
