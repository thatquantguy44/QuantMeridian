import { json } from "@/lib/server/http";
import { goldConfigStatus, goldEnabled, goldStore } from "@/lib/server/goldStore";
import {
  gatePricingCandidates,
  loadGoldMmktRateSnapshot,
  MmktRateSnapshotError,
} from "@/lib/server/mmktRateSnapshot";

export const runtime = "nodejs";

function errorResponse(
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  return json(
    {
      source: "ERR",
      ok: false,
      code,
      message,
      rate_snapshot: null,
      ...details,
    },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/**
 * GET /api/econ/mmkt-rate-snapshot?source=gold[&instrument_id=...]
 *
 * SIM is opt-in by named set. No set is silently selected, and this route currently
 * fails closed because no approved MMKT SIM rate set is registered in the terminal.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const source = params.get("source") ?? "gold";
  const simSetId = params.get("sim_set_id");
  const candidateIds = params.getAll("instrument_id");

  if (params.has("sim") && source !== "sim") {
    return errorResponse(
      400,
      "SIM_SET_REQUIRED",
      "Global SIM mode does not select an MMKT rate set; choose source=sim and a named sim_set_id.",
    );
  }
  if (source !== "gold" && source !== "sim") {
    return errorResponse(400, "RATE_SOURCE_INVALID", "source must be gold or sim.");
  }
  if (candidateIds.length > 5_000 || candidateIds.some((id) => id.trim() === "")) {
    return errorResponse(400, "CANDIDATE_IDS_INVALID", "instrument_id values must be non-empty and bounded.");
  }
  if (new Set(candidateIds).size !== candidateIds.length) {
    return errorResponse(400, "CANDIDATE_IDS_DUPLICATE", "instrument_id values must be unique.");
  }

  if (source === "sim") {
    if (!simSetId) {
      return errorResponse(400, "SIM_SET_REQUIRED", "Select a named SIM rate set explicitly.");
    }
    return errorResponse(
      503,
      "SIM_SET_UNAVAILABLE",
      "The selected SIM rate set is not registered; Gold data will not be substituted.",
      { selected_sim_set_id: simSetId },
    );
  }
  if (simSetId !== null) {
    return errorResponse(400, "SIM_SET_NOT_ALLOWED", "sim_set_id is valid only with source=sim.");
  }
  if (!goldEnabled()) {
    return errorResponse(503, "GOLD_UNAVAILABLE", "Gold DB is not configured.");
  }

  try {
    const snapshot = await loadGoldMmktRateSnapshot(goldStore(), goldConfigStatus().backend);
    const pricingGate = candidateIds.length
      ? gatePricingCandidates(snapshot, candidateIds, "DB")
      : null;
    return json(
      {
        source: "DB",
        ok: true,
        rate_snapshot: {
          source: snapshot.source,
          as_of_date: snapshot.as_of_date,
          snapshot_hash: snapshot.snapshot_hash,
          ...(snapshot.sim_set_id ? { sim_set_id: snapshot.sim_set_id } : {}),
          rows: snapshot.rows,
        },
        lineage: { origin: snapshot.origin, backend: snapshot.backend },
        pricing_gate: pricingGate,
        row_statuses: snapshot.rows.map((row) => ({
          instrument_id: row.instrument_id,
          status: row.status,
          display_status: row.status === "ok" ? "DB" : "ERR",
          status_detail: row.status_detail,
          observation_date: row.observation_date,
          staleness_days: row.staleness_days,
          pricing_eligible: row.status === "ok" && row.mm_yield_pct !== null,
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof MmktRateSnapshotError) {
      return errorResponse(503, error.code, error.message);
    }
    console.error("[mmkt-rate-snapshot] Gold read failed", {
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(503, "GOLD_READ_FAILED", "Gold rate snapshot could not be read.");
  }
}
