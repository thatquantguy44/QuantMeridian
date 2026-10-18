import { canonicalHash, type MmktRateRow, type MmktRateSnapshot } from "@/lib/server/mmktRateSnapshot";

/**
 * Registered, named MMKT SIM rate sets (spec011 PLAN: "the user may explicitly select a
 * named deterministic SIM set"). These are synthetic, hand-written values used only when
 * the user picks a set by ID. They are never substituted for unavailable Gold rows.
 *
 * Instrument IDs follow FRED series naming where a series exists. Fund yields and bank
 * deposit/CD rates have no licensed upstream source yet (handoff XR-4), so those rows are
 * illustrative policy-style inputs. Reconcile IDs with the EcoMedallion instrument map once
 * EcoMedallion PR #81 merges (XR-2).
 */

export type QuotedBasis = "simple_act360" | "discount_act360" | "bond_equivalent" | "sec_7d_yield";

interface SimRateSeed {
  instrument_id: string;
  label: string;
  quoted_rate_pct: number | null;
  quoted_basis: QuotedBasis;
  /** Days to maturity used to normalize a discount quote. */
  tenor_days: number;
  status?: "ok" | "stale" | "unavailable";
  staleness_days?: number;
  status_detail?: string;
}

export interface MmktSimRateSet {
  sim_set_id: string;
  label: string;
  description: string;
  as_of_date: string;
  rows: SimRateSeed[];
}

/**
 * Normalize a quoted rate to a simple ACT/365 money-market yield. SIM convention:
 * - simple_act360 (SOFR, repo, RRP, deposits, CDs): r × 365/360
 * - discount_act360 (T-bills, CP): d / (1 − d·t/360) × 365/360
 * - bond_equivalent / sec_7d_yield: already annualized on a 365-day basis
 */
export function normalizeToMmYield(quotedPct: number, basis: QuotedBasis, tenorDays: number): number {
  const r = quotedPct / 100;
  let y: number;
  if (basis === "simple_act360") y = (r * 365) / 360;
  else if (basis === "discount_act360") y = (r / (1 - (r * tenorDays) / 360)) * (365 / 360);
  else y = r;
  return Math.round(y * 100 * 10_000) / 10_000;
}

const BASE_ROWS: SimRateSeed[] = [
  { instrument_id: "RRPONTSYAWARD", label: "Fed ON RRP award rate", quoted_rate_pct: 3.75, quoted_basis: "simple_act360", tenor_days: 1 },
  { instrument_id: "SOFR", label: "SOFR (tri-party repo proxy)", quoted_rate_pct: 3.86, quoted_basis: "simple_act360", tenor_days: 1 },
  { instrument_id: "DTB4WK", label: "4-week T-bill", quoted_rate_pct: 3.78, quoted_basis: "discount_act360", tenor_days: 28 },
  { instrument_id: "DTB3", label: "3-month T-bill", quoted_rate_pct: 3.72, quoted_basis: "discount_act360", tenor_days: 91 },
  { instrument_id: "DTB6", label: "6-month T-bill", quoted_rate_pct: 3.62, quoted_basis: "discount_act360", tenor_days: 182 },
  { instrument_id: "DCPF1M", label: "1-month AA financial CP", quoted_rate_pct: 3.94, quoted_basis: "discount_act360", tenor_days: 30 },
  { instrument_id: "DCPN3M", label: "3-month AA nonfinancial CP", quoted_rate_pct: null, quoted_basis: "discount_act360", tenor_days: 91, status: "unavailable", status_detail: "Series inactive in the upstream manifest; not priced." },
  { instrument_id: "DTB1YR", label: "52-week T-bill", quoted_rate_pct: 3.41, quoted_basis: "discount_act360", tenor_days: 364, status: "stale", staleness_days: 6, status_detail: "Last observation is 6 days old; displayed but not priced." },
  { instrument_id: "MMF.GOVT.7D", label: "Government MMF 7-day yield (illustrative)", quoted_rate_pct: 3.70, quoted_basis: "sec_7d_yield", tenor_days: 1 },
  { instrument_id: "MMF.PRIME.7D", label: "Prime MMF 7-day yield (illustrative)", quoted_rate_pct: 3.88, quoted_basis: "sec_7d_yield", tenor_days: 1 },
  { instrument_id: "CD.3M", label: "3-month bank CD (illustrative)", quoted_rate_pct: 3.92, quoted_basis: "simple_act360", tenor_days: 91 },
  { instrument_id: "DEP.ON", label: "Operating bank deposit (illustrative)", quoted_rate_pct: 3.40, quoted_basis: "simple_act360", tenor_days: 1 },
];

/** A cut priced into the curve: overnight rates fall most, longer bills least. */
const CUT_SHIFT_BPS: Record<string, number> = {
  RRPONTSYAWARD: -25, SOFR: -25, "MMF.GOVT.7D": -22, "MMF.PRIME.7D": -22, "DEP.ON": -25,
  DTB4WK: -18, DCPF1M: -17, "CD.3M": -10, DTB3: -9, DTB6: -5, DTB1YR: -3,
};

export const MMKT_SIM_RATE_SETS: MmktSimRateSet[] = [
  {
    sim_set_id: "SIM-MMKT-2026-10-BASE",
    label: "SIM base curve · 2026-10-16",
    description: "Hand-written front-end curve with one stale and one unavailable row to show fail-closed pricing.",
    as_of_date: "2026-10-16",
    rows: BASE_ROWS,
  },
  {
    sim_set_id: "SIM-MMKT-2026-10-CUT25",
    label: "SIM 25bp cut priced · 2026-10-16",
    description: "Base curve with a 25bp policy cut priced in: overnight −25bp, 1m about −17bp, 3m −9bp, 6m −5bp.",
    as_of_date: "2026-10-16",
    rows: BASE_ROWS.map((row) => ({
      ...row,
      quoted_rate_pct: row.quoted_rate_pct === null ? null : Math.round((row.quoted_rate_pct + (CUT_SHIFT_BPS[row.instrument_id] ?? 0) / 100) * 10_000) / 10_000,
    })),
  },
];

export function findSimRateSet(simSetId: string): MmktSimRateSet | undefined {
  return MMKT_SIM_RATE_SETS.find((set) => set.sim_set_id === simSetId);
}

export function simRateSetSummaries() {
  return MMKT_SIM_RATE_SETS.map(({ sim_set_id, label, description, as_of_date, rows }) => ({
    sim_set_id, label, description, as_of_date, row_count: rows.length,
    labels: Object.fromEntries(rows.map((row) => [row.instrument_id, row.label])),
  }));
}

/** Build the hashed snapshot for a registered set, or undefined if the ID is unknown. */
export function loadSimMmktRateSnapshot(simSetId: string): MmktRateSnapshot | undefined {
  const set = findSimRateSet(simSetId);
  if (!set) return undefined;
  const rows: MmktRateRow[] = [...set.rows]
    .sort((a, b) => a.instrument_id.localeCompare(b.instrument_id))
    .map((seed) => {
      const status = seed.status ?? "ok";
      const priced = status === "ok" && seed.quoted_rate_pct !== null;
      return {
        instrument_id: seed.instrument_id,
        quoted_rate_pct: seed.quoted_rate_pct,
        quoted_basis: seed.quoted_basis,
        mm_yield_pct: priced ? normalizeToMmYield(seed.quoted_rate_pct!, seed.quoted_basis, seed.tenor_days) : null,
        observation_date: status === "stale" ? shiftDate(set.as_of_date, -(seed.staleness_days ?? 0)) : status === "unavailable" ? null : set.as_of_date,
        staleness_days: status === "unavailable" ? null : seed.staleness_days ?? 0,
        status,
        status_detail: seed.status_detail ?? `SIM set ${set.sim_set_id}`,
      };
    });
  const unsigned: Omit<MmktRateSnapshot, "snapshot_hash"> = {
    api_schema_version: "1.0.0",
    source: "sim",
    origin: `SIM:${set.sim_set_id}`,
    sim_set_id: set.sim_set_id,
    backend: "terminal-sim-registry",
    as_of_date: set.as_of_date,
    rows,
  };
  return { ...unsigned, snapshot_hash: canonicalHash(unsigned) };
}

function shiftDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
