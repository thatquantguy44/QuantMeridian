import { describe, expect, test } from "vitest";
import { gatePricingCandidates } from "./mmktRateSnapshot";
import { MMKT_SIM_RATE_SETS, loadSimMmktRateSnapshot, normalizeToMmYield } from "./mmktSimRateSets";

describe("normalizeToMmYield", () => {
  test("simple ACT/360 converts to ACT/365", () => {
    expect(normalizeToMmYield(3.6, "simple_act360", 1)).toBeCloseTo(3.65, 10);
  });

  test("discount ACT/360 converts to a simple ACT/365 yield", () => {
    // d = 3.6%, t = 90: 0.036 / (1 − 0.036·90/360) × 365/360 = 0.036 / 0.991 × 1.013888…
    expect(normalizeToMmYield(3.6, "discount_act360", 90)).toBeCloseTo(3.6831, 4);
  });

  test("bond-equivalent and 7-day SEC yields pass through", () => {
    expect(normalizeToMmYield(3.7, "bond_equivalent", 30)).toBe(3.7);
    expect(normalizeToMmYield(3.7, "sec_7d_yield", 1)).toBe(3.7);
  });
});

describe("registered MMKT SIM rate sets", () => {
  test("unknown set IDs are not registered", () => {
    expect(loadSimMmktRateSnapshot("SIM-DOES-NOT-EXIST")).toBeUndefined();
  });

  test("snapshots are deterministic, labelled SIM and hashed", () => {
    const a = loadSimMmktRateSnapshot("SIM-MMKT-2026-10-BASE")!;
    const b = loadSimMmktRateSnapshot("SIM-MMKT-2026-10-BASE")!;
    expect(a).toEqual(b);
    expect(a.source).toBe("sim");
    expect(a.origin).toBe("SIM:SIM-MMKT-2026-10-BASE");
    expect(a.snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(a.rows.map((r) => r.instrument_id)).size).toBe(a.rows.length);
  });

  test("non-ok rows carry no normalized yield and fail the pricing gate", () => {
    const snap = loadSimMmktRateSnapshot("SIM-MMKT-2026-10-BASE")!;
    const stale = snap.rows.find((r) => r.instrument_id === "DTB1YR")!;
    const unavailable = snap.rows.find((r) => r.instrument_id === "DCPN3M")!;
    expect(stale.status).toBe("stale");
    expect(stale.mm_yield_pct).toBeNull();
    expect(stale.staleness_days).toBe(6);
    expect(unavailable.mm_yield_pct).toBeNull();
    const gate = gatePricingCandidates(snap, ["SOFR", "DTB1YR"], "SIM", true);
    expect(gate.eligible).toBe(false);
    expect(gate.eligible_instrument_ids).toEqual(["SOFR"]);
    expect(gate.issues).toEqual([{ instrument_id: "DTB1YR", code: "RATE_STATUS_NOT_OK", status: "stale" }]);
  });

  test("SIM pricing requires explicit selection", () => {
    const snap = loadSimMmktRateSnapshot("SIM-MMKT-2026-10-BASE")!;
    expect(gatePricingCandidates(snap, ["SOFR"], "SIM", false).eligible).toBe(false);
    expect(gatePricingCandidates(snap, ["SOFR"], "DB").eligible).toBe(false);
    expect(gatePricingCandidates(snap, ["SOFR"], "SIM", true).eligible).toBe(true);
  });

  test("the cut set lowers overnight rates more than term bills", () => {
    const base = loadSimMmktRateSnapshot("SIM-MMKT-2026-10-BASE")!;
    const cut = loadSimMmktRateSnapshot("SIM-MMKT-2026-10-CUT25")!;
    const delta = (id: string) => cut.rows.find((r) => r.instrument_id === id)!.mm_yield_pct! - base.rows.find((r) => r.instrument_id === id)!.mm_yield_pct!;
    expect(delta("SOFR")).toBeLessThan(delta("DTB3"));
    expect(delta("DTB3")).toBeLessThan(0);
    expect(cut.snapshot_hash).not.toBe(base.snapshot_hash);
    expect(MMKT_SIM_RATE_SETS.map((s) => s.sim_set_id)).toEqual(["SIM-MMKT-2026-10-BASE", "SIM-MMKT-2026-10-CUT25"]);
  });
});
