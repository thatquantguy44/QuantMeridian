import { createHash } from "node:crypto";
import { goldTable, type GoldStore } from "@/lib/server/goldStore";

const MAX_RATE_ROWS = 5_000;

export interface MmktRateRow {
  instrument_id: string;
  quoted_rate_pct: number | null;
  quoted_basis: string | null;
  mm_yield_pct: number | null;
  observation_date: string | null;
  staleness_days: number | null;
  status: string;
  status_detail: string | null;
}

export interface MmktRateSnapshot {
  api_schema_version: "1.0.0";
  source: "gold" | "sim";
  origin: "gold.mmkt_rate_snapshot" | `SIM:${string}`;
  sim_set_id?: string;
  backend: string;
  as_of_date: string;
  rows: MmktRateRow[];
  snapshot_hash: string;
}

export interface PricingGateIssue {
  instrument_id: string;
  code:
    | "RATE_SOURCE_UNAVAILABLE"
    | "SIM_SELECTION_REQUIRED"
    | "RATE_ROW_MISSING"
    | "RATE_STATUS_NOT_OK"
    | "NORMALIZED_RATE_MISSING";
  status?: string;
}

export interface PricingGate {
  eligible: boolean;
  eligible_instrument_ids: string[];
  issues: PricingGateIssue[];
}

interface RawMmktRateRow {
  instrument_id: unknown;
  quoted_rate_pct: unknown;
  quoted_basis: unknown;
  mm_yield_pct: unknown;
  observation_date: unknown;
  staleness_days: unknown;
  status: unknown;
  status_detail: unknown;
}

export class MmktRateSnapshotError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MmktRateSnapshotError";
  }
}

function nullableText(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new MmktRateSnapshotError("RATE_SNAPSHOT_INVALID", `${field} must be text or null.`);
  }
  return value;
}

function nullableFiniteNumber(value: unknown, field: string): number | null {
  if (value == null) return null;
  if (typeof value !== "number" && typeof value !== "string") {
    throw new MmktRateSnapshotError("RATE_SNAPSHOT_INVALID", `${field} must be numeric or null.`);
  }
  if (typeof value === "string" && value.trim() === "") {
    throw new MmktRateSnapshotError("RATE_SNAPSHOT_INVALID", `${field} is empty.`);
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new MmktRateSnapshotError("RATE_SNAPSHOT_INVALID", `${field} must be finite or null.`);
  }
  return parsed;
}

function nullableDate(value: unknown, field: string): string | null {
  if (value == null) return null;
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new MmktRateSnapshotError("RATE_SNAPSHOT_INVALID", `${field} must be an ISO date.`);
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new MmktRateSnapshotError("RATE_SNAPSHOT_INVALID", `${field} must be a valid ISO date.`);
  }
  return text;
}

function normalizeRow(raw: RawMmktRateRow): MmktRateRow {
  if (typeof raw.instrument_id !== "string" || raw.instrument_id.trim() === "") {
    throw new MmktRateSnapshotError("RATE_SNAPSHOT_INVALID", "instrument_id is missing.");
  }
  if (typeof raw.status !== "string" || raw.status.trim() === "") {
    throw new MmktRateSnapshotError("RATE_SNAPSHOT_INVALID", "rate status is missing.");
  }
  const staleness = nullableFiniteNumber(raw.staleness_days, "staleness_days");
  if (staleness !== null && (!Number.isInteger(staleness) || staleness < 0)) {
    throw new MmktRateSnapshotError("RATE_SNAPSHOT_INVALID", "staleness_days must be a nonnegative integer.");
  }
  const row: MmktRateRow = {
    instrument_id: raw.instrument_id,
    quoted_rate_pct: nullableFiniteNumber(raw.quoted_rate_pct, "quoted_rate_pct"),
    quoted_basis: nullableText(raw.quoted_basis, "quoted_basis"),
    mm_yield_pct: nullableFiniteNumber(raw.mm_yield_pct, "mm_yield_pct"),
    observation_date: nullableDate(raw.observation_date, "observation_date"),
    staleness_days: staleness,
    status: raw.status,
    status_detail: nullableText(raw.status_detail, "status_detail"),
  };
  if (row.status === "ok" && row.mm_yield_pct === null) {
    throw new MmktRateSnapshotError(
      "RATE_SNAPSHOT_INVALID",
      `Rate row ${row.instrument_id} is ok but has no normalized mm_yield_pct.`,
    );
  }
  return row;
}

function canonicalHash(payload: Omit<MmktRateSnapshot, "snapshot_hash">): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function loadGoldMmktRateSnapshot(
  store: GoldStore,
  backend: string,
): Promise<MmktRateSnapshot> {
  const rows = await store.raw<RawMmktRateRow>(
    `SELECT instrument_id, quoted_rate_pct, quoted_basis, mm_yield_pct,
            observation_date, staleness_days, status, status_detail
     FROM ${goldTable("mmkt_rate_snapshot")}
     ORDER BY instrument_id
     LIMIT ${MAX_RATE_ROWS + 1}`,
  );
  if (rows.length === 0) {
    throw new MmktRateSnapshotError("RATE_SNAPSHOT_EMPTY", "Gold returned no MMKT rate rows.");
  }
  if (rows.length > MAX_RATE_ROWS) {
    throw new MmktRateSnapshotError("RATE_SNAPSHOT_TOO_LARGE", "Gold returned too many MMKT rate rows.");
  }

  const normalized = rows.map(normalizeRow);
  if (new Set(normalized.map((row) => row.instrument_id)).size !== normalized.length) {
    throw new MmktRateSnapshotError(
      "RATE_SNAPSHOT_GRAIN_INVALID",
      "Gold returned more than one row for an instrument; snapshot grain is ambiguous.",
    );
  }
  const observationDates = normalized
    .map((row) => row.observation_date)
    .filter((value): value is string => value !== null)
    .sort();
  const asOfDate = observationDates.at(-1);
  if (!asOfDate) {
    throw new MmktRateSnapshotError(
      "RATE_SNAPSHOT_AS_OF_MISSING",
      "Gold rate rows do not contain an observation date.",
    );
  }

  const unsigned: Omit<MmktRateSnapshot, "snapshot_hash"> = {
    api_schema_version: "1.0.0",
    source: "gold",
    origin: "gold.mmkt_rate_snapshot",
    backend,
    as_of_date: asOfDate,
    rows: normalized,
  };
  return { ...unsigned, snapshot_hash: canonicalHash(unsigned) };
}

export function gatePricingCandidates(
  snapshot: MmktRateSnapshot | null,
  candidateInstrumentIds: readonly string[],
  sourceState: "DB" | "SIM" | "LOADING" | "ERR" | "STALE",
  simSelectionExplicit = false,
): PricingGate {
  const uniqueIds = [...new Set(candidateInstrumentIds)].sort();
  const issues: PricingGateIssue[] = [];
  const eligible: string[] = [];

  if (!snapshot || sourceState === "LOADING" || sourceState === "ERR" || sourceState === "STALE") {
    return {
      eligible: false,
      eligible_instrument_ids: [],
      issues: uniqueIds.map((instrument_id) => ({ instrument_id, code: "RATE_SOURCE_UNAVAILABLE" })),
    };
  }
  if (
    (sourceState === "DB" && snapshot.source !== "gold") ||
    (sourceState === "SIM" && (snapshot.source !== "sim" || !simSelectionExplicit || !snapshot.sim_set_id))
  ) {
    return {
      eligible: false,
      eligible_instrument_ids: [],
      issues: uniqueIds.map((instrument_id) => ({
        instrument_id,
        code: sourceState === "SIM" ? "SIM_SELECTION_REQUIRED" : "RATE_SOURCE_UNAVAILABLE",
      })),
    };
  }

  const byId = new Map(snapshot.rows.map((row) => [row.instrument_id, row]));

  for (const instrumentId of uniqueIds) {
    const row = byId.get(instrumentId);
    if (!row) {
      issues.push({ instrument_id: instrumentId, code: "RATE_ROW_MISSING" });
    } else if (row.status !== "ok") {
      issues.push({ instrument_id: instrumentId, code: "RATE_STATUS_NOT_OK", status: row.status });
    } else if (row.mm_yield_pct === null) {
      issues.push({ instrument_id: instrumentId, code: "NORMALIZED_RATE_MISSING", status: row.status });
    } else {
      eligible.push(instrumentId);
    }
  }
  return {
    eligible: issues.length === 0 && uniqueIds.length > 0,
    eligible_instrument_ids: eligible,
    issues,
  };
}
