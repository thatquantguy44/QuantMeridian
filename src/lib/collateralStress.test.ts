import { describe, expect, it } from "vitest";
import { buildGeneratedBook, type NativeSnapshot } from "./collateralBooks";
import {
  STRESS_FAMILIES,
  applyStress,
  buildCollateralSuite,
  changedFields,
  clampStress,
  defaultStress,
  rankCollateralOutcomes,
  type CollateralOutcome,
} from "./collateralStress";

const base = () => buildGeneratedBook("dealer");
const usd = (book: NativeSnapshot, callId: string) => {
  const call = book.calls.find((c) => c.call_id === callId)!;
  return call.required_value * book.fx.find((q) => q.currency === call.currency)!.usd_per_unit;
};

describe("applyStress", () => {
  it("scales only the largest calls (by USD) and reports calls as the changed input", () => {
    const b = base();
    const { snapshot, changed } = applyStress(b, "call_spike", { breadth: 2, increasePct: 50 });
    const ranked = [...b.calls].sort((x, y) => usd(b, y.call_id) - usd(b, x.call_id)).map((c) => c.call_id);
    for (const call of b.calls) {
      const after = snapshot.calls.find((c) => c.call_id === call.call_id)!;
      const expected = ranked.slice(0, 2).includes(call.call_id) ? call.required_value * 1.5 : call.required_value;
      expect(after.required_value, call.call_id).toBeCloseTo(expected, 2);
    }
    expect(changed).toEqual(["calls"]);
  });

  it("raises every non-cash haircut by the shift, capped below 100%, leaving cash alone", () => {
    const b = base();
    const { snapshot, changed } = applyStress(b, "haircut_shock", { shiftPp: 5 });
    for (const [i, agreement] of snapshot.agreements.entries()) {
      for (const rule of agreement.classes) {
        const before = b.agreements[i].classes.find((c) => c.asset_class === rule.asset_class)!.haircut;
        expect(rule.haircut).toBeCloseTo(rule.asset_class === "CASH" ? before : Math.min(0.95, before + 0.05), 10);
        expect(rule.haircut).toBeLessThan(1);
      }
    }
    expect(changed).toEqual(["agreements"]);
  });

  it("multiplies the liquidity reserve", () => {
    const b = base();
    const { snapshot, changed } = applyStress(b, "reserve_squeeze", { reservePct: 250 });
    expect(snapshot.minimum_liquidity_reserve_usd).toBeCloseTo(b.minimum_liquidity_reserve_usd * 2.5, 2);
    expect(changed).toEqual(["minimum_liquidity_reserve_usd"]);
  });

  it("shortens deadlines as whole minutes, never below five", () => {
    const b = base();
    const { snapshot, changed } = applyStress(b, "cutoff_squeeze", { deadlinePct: 10 });
    for (const call of snapshot.calls) {
      expect(Number.isInteger(call.deadline_minutes)).toBe(true);
      expect(call.deadline_minutes).toBeGreaterThanOrEqual(5);
    }
    expect(snapshot.calls.find((c) => c.call_id === "US-CSA-1")!.deadline_minutes).toBe(144);
    expect(snapshot.calls.find((c) => c.call_id === "US-CCP-1")!.deadline_minutes).toBe(6);
    expect(changed).toEqual(["calls"]);
  });

  it("scales move costs and activation fees only where they exist", () => {
    const b = base();
    const { snapshot, changed } = applyStress(b, "cost_shock", { multiple: 5 });
    snapshot.assets.forEach((asset, i) => {
      const before = b.assets[i];
      expect(asset.variable_move_bps).toBeCloseTo(before.variable_move_bps * 5, 10);
      expect(asset.fixed_activation_fee_usd).toBeCloseTo(before.fixed_activation_fee_usd * 5, 10);
    });
    expect(changed).toEqual(["assets"]);
  });

  it("denies the largest free issuers across every agreement and ignores legacy holdings", () => {
    const b = base();
    const { snapshot, changed } = applyStress(b, "issuer_denial", { breadth: 1 });
    const added = snapshot.agreements.map((a, i) => a.denied_issuers.filter((x) => !b.agreements[i].denied_issuers.includes(x)));
    const issuers = new Set(added.flat());
    expect(issuers.size).toBe(1);
    expect([...issuers][0]).not.toMatch(/^LEGACY-/);
    for (const list of added) expect(list).toHaveLength(1);
    expect(changed).toEqual(["agreements"]);
  });

  it("never mutates the base book and is deterministic", () => {
    const b = base();
    const copy = JSON.stringify(b);
    const first = applyStress(b, "call_spike", defaultStress("call_spike"));
    const second = applyStress(b, "call_spike", defaultStress("call_spike"));
    expect(JSON.stringify(b)).toBe(copy);
    expect(JSON.stringify(first.snapshot)).toBe(JSON.stringify(second.snapshot));
  });

  it("tags the scenario with its family and sizing and never claims to be SIM", () => {
    const { snapshot } = applyStress(base(), "haircut_shock", { shiftPp: 8 });
    expect(snapshot.scenario_id).toContain("haircut_shock");
    expect(snapshot.scenario_id).toContain("8");
    expect(snapshot.source).not.toMatch(/^SIM/);
    const other = applyStress(base(), "haircut_shock", { shiftPp: 3 }).snapshot;
    expect(other.scenario_id).not.toBe(snapshot.scenario_id);
  });
});

describe("sizing fields", () => {
  it("has in-range defaults for every field of every family", () => {
    for (const family of STRESS_FAMILIES) {
      const d = defaultStress(family.id);
      for (const field of family.fields) {
        expect(d[field.key]).toBeGreaterThanOrEqual(field.min);
        expect(d[field.key]).toBeLessThanOrEqual(field.max);
      }
    }
  });
  it("uses profile-specific defaults that still respect every range", () => {
    expect(defaultStress("reserve_squeeze", "dealer").reservePct).toBeGreaterThan(defaultStress("reserve_squeeze", "asset_manager").reservePct);
    for (const profile of ["dealer", "asset_manager"]) {
      for (const family of STRESS_FAMILIES) {
        const d = defaultStress(family.id, profile);
        for (const field of family.fields) {
          expect(d[field.key]).toBeGreaterThanOrEqual(field.min);
          expect(d[field.key]).toBeLessThanOrEqual(field.max);
        }
      }
    }
  });
  it("falls back to the generic default for an unknown profile", () => {
    expect(defaultStress("reserve_squeeze", "nope")).toEqual(defaultStress("reserve_squeeze"));
  });
  it("clamps hostile or half-typed input", () => {
    const clamped = clampStress("call_spike", { increasePct: 99999, breadth: Number.NaN });
    expect(clamped.increasePct).toBe(STRESS_FAMILIES.find((f) => f.id === "call_spike")!.fields.find((f) => f.key === "increasePct")!.max);
    expect(clamped.breadth).toBe(defaultStress("call_spike").breadth);
  });
});

describe("buildCollateralSuite", () => {
  it("sizes the suite from the book's own profile", () => {
    const dealer = buildCollateralSuite(buildGeneratedBook("dealer")).find((s) => s.family === "reserve_squeeze")!;
    const manager = buildCollateralSuite(buildGeneratedBook("asset_manager")).find((s) => s.family === "reserve_squeeze")!;
    expect(dealer.snapshot.minimum_liquidity_reserve_usd / buildGeneratedBook("dealer").minimum_liquidity_reserve_usd).toBeCloseTo(4, 5);
    expect(manager.snapshot.minimum_liquidity_reserve_usd / buildGeneratedBook("asset_manager").minimum_liquidity_reserve_usd).toBeCloseTo(2.5, 5);
  });

  it("makes one default-sized, distinct scenario per family, each differing from the base", () => {
    const b = base();
    const suite = buildCollateralSuite(b);
    expect(suite.map((s) => s.family)).toEqual(STRESS_FAMILIES.map((f) => f.id));
    expect(new Set(suite.map((s) => s.snapshot.scenario_id)).size).toBe(suite.length);
    for (const item of suite) expect(item.changed.length).toBeGreaterThan(0);
  });
});

describe("changedFields", () => {
  it("lists only top-level fields whose content differs", () => {
    const b = base();
    expect(changedFields(b, b)).toEqual([]);
    const reserve = { ...b, minimum_liquidity_reserve_usd: 1 };
    expect(changedFields(b, reserve)).toEqual(["minimum_liquidity_reserve_usd"]);
  });
});

describe("rankCollateralOutcomes", () => {
  const o = (family: string, costUsd: number | null, over: Partial<CollateralOutcome> = {}): CollateralOutcome =>
    ({ family, label: family, lifecycle: "SUCCEEDED_VERIFIED", verified: true, costUsd, ...over });

  it("puts infeasible and unverified outcomes ahead of every feasible one", () => {
    const ranked = rankCollateralOutcomes(100, [
      o("a", 150),
      o("b", null, { lifecycle: "INFEASIBLE", verified: false }),
      o("c", 400, { verified: false }),
    ]);
    expect(ranked.map((r) => r.family)).toEqual(["b", "c", "a"]);
  });
  it("orders feasible outcomes by cost increase over the baseline, largest first", () => {
    const ranked = rankCollateralOutcomes(100, [o("small", 110), o("big", 300), o("cheaper", 90)]);
    expect(ranked.map((r) => r.family)).toEqual(["big", "small", "cheaper"]);
    expect(ranked.map((r) => r.deltaUsd)).toEqual([200, 10, -10]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
  it("is stable for equal deltas and gives no delta when there is no cost", () => {
    const ranked = rankCollateralOutcomes(100, [o("x", 120), o("y", 120), o("z", null, { lifecycle: "ERROR", verified: false })]);
    expect(ranked.map((r) => r.family)).toEqual(["z", "x", "y"]);
    expect(ranked[0].deltaUsd).toBeNull();
  });
});
