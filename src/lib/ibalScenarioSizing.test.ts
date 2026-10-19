import { describe, expect, it } from "vitest";
import type { DatasetEnvelope, IbalResult, IbalStressOutcome } from "@/lib/inventoryOptimizer";
import {
  SCENARIO_FAMILIES,
  buildScenarioParameters,
  clampSizing,
  defaultSizing,
  familyAvailability,
  rankStressOutcomes,
} from "./ibalScenarioSizing";

const route = (id: string, borrower: string, current: number, max: number, extra: object = {}) => ({
  route_id: id, inventory_id: "INV-1", security_id: "SEC-1", borrower_id: borrower, demand_group_id: `DG-${id}`,
  current_quantity_shares: current, hard_minimum_quantity_shares: 0, minimum_active_quantity_shares: null,
  maximum_quantity_shares: max, fee_rate: 0.02, eligible: true, ...extra,
});

function dataset(over: Record<string, unknown> = {}): DatasetEnvelope {
  return {
    request_hash: "abcdef123456",
    summary: { effective_date: "2026-09-14" },
    request: {
      as_of: "2026-09-14T12:00:00Z",
      effective_date: "2026-09-14",
      routes: [route("R1", "B1", 100, 1000), route("R2", "B2", 50, 800), route("R3", "B1", 10, 500), route("R4", "B3", 0, 300)],
      inventory: [
        { inventory_id: "INV-1", eligible: true, available_to_lend_shares: 10_000, total_lendable_shares: 20_000 },
        { inventory_id: "INV-2", eligible: true, available_to_lend_shares: 40_000, total_lendable_shares: 50_000 },
      ],
      demand: [{ demand_group_id: "DG-R1" }],
      counterparty_limits: [
        { limit_id: "L1", effective_from: "2026-01-01", effective_to: null },
        { limit_id: "L2", effective_from: "2026-01-01", effective_to: null },
      ],
      external_borrow_quotes: [],
      balance_sheet_budgets: [],
      ...over,
    },
  } as unknown as DatasetEnvelope;
}

const baseline = {
  allocations: [
    { route_id: "R1", post_quantity_shares: 400 },
    { route_id: "R2", post_quantity_shares: 700 },
    { route_id: "R3", post_quantity_shares: 100 },
    { route_id: "R4", post_quantity_shares: 0 },
  ],
} as unknown as IbalResult;

describe("buildScenarioParameters", () => {
  it("sizes a recall against the baseline allocation of the largest routes", () => {
    const p = buildScenarioParameters("recall_wave", dataset(), baseline, { breadth: 2, recallPct: 50 }) as { targets: { route_id: string; quantity_shares: number }[] };
    expect(p.targets.map((t) => t.route_id)).toEqual(["R2", "R1"]);
    expect(p.targets[0].quantity_shares).toBe(350); // 50% of 700
    expect(p.targets[1].quantity_shares).toBe(200); // 50% of 400
  });

  it("caps a recall at the route's removable capacity and never emits zero", () => {
    const p = buildScenarioParameters("recall_wave", dataset(), baseline, { breadth: 4, recallPct: 100 }) as { targets: { route_id: string; quantity_shares: number }[] };
    const r2 = p.targets.find((t) => t.route_id === "R2")!;
    expect(r2.quantity_shares).toBe(700);
    expect(p.targets.every((t) => t.quantity_shares > 0)).toBe(true);
    expect(p.targets.some((t) => t.route_id === "R4")).toBe(false); // nothing allocated, nothing to recall
  });

  it("includes the trade, effective and settlement dates the engine requires for a recall", () => {
    const p = buildScenarioParameters("recall_wave", dataset(), baseline, { breadth: 1, recallPct: 50 });
    expect(p).toMatchObject({ trade_date: "2026-09-14", effective_date: "2026-09-14", settlement_date: "2026-09-14" });
  });

  it("falls back to the current book when there is no baseline result", () => {
    const p = buildScenarioParameters("recall_wave", dataset(), null, { breadth: 1, recallPct: 100 }) as { targets: { route_id: string }[] };
    expect(p.targets[0].route_id).toBe("R1");
  });

  it("widens fees on the largest baseline routes", () => {
    const p = buildScenarioParameters("specials_squeeze", dataset(), baseline, { breadth: 2, spreadBps: 150 }) as { route_ids: string[]; spread_widening_bps: number };
    expect(p.route_ids).toEqual(["R2", "R1"]);
    expect(p.spread_widening_bps).toBe(150);
  });

  it("defaults the borrower to the one with the most baseline exposure", () => {
    const p = buildScenarioParameters("borrower_default", dataset(), baseline, { breadth: 1, recoveryPct: 0 }) as { borrower_ids: string[]; recovery_fraction?: number };
    expect(p.borrower_ids).toEqual(["B2"]); // B2 holds 700; B1 holds 500
    expect(p.recovery_fraction).toBeUndefined(); // omitted means zero recovery in the engine
  });

  it("passes recovery through as a fraction when set", () => {
    const p = buildScenarioParameters("borrower_default", dataset(), baseline, { breadth: 1, recoveryPct: 40 }) as { recovery_fraction: number };
    expect(p.recovery_fraction).toBeCloseTo(0.4);
  });

  it("converts limit-cut percent to a fraction", () => {
    const p = buildScenarioParameters("borrower_limit_cut", dataset(), baseline, { breadth: 2, reductionPct: 30 }) as { limit_ids: string[]; reduction_fraction: number };
    expect(p.limit_ids).toEqual(["L1", "L2"]);
    expect(p.reduction_fraction).toBeCloseTo(0.3);
  });

  it("sizes a supply shock against the inventory with the most available shares", () => {
    const p = buildScenarioParameters("supply_shock", dataset(), baseline, { lendablePct: 25 }) as { inventory_id: string; quantity_shares: number };
    expect(p.inventory_id).toBe("INV-2");
    expect(p.quantity_shares).toBe(10_000);
  });

  it("builds an ascending three-step rate ladder ending at the chosen maximum", () => {
    const p = buildScenarioParameters("rate_shock_ladder", dataset(), baseline, { breadth: 1, maxStepBps: 100 }) as { steps_bps: number[]; targets: unknown[] };
    expect(p.steps_bps).toEqual([25, 50, 100]);
    expect(p.targets).toHaveLength(1);
  });

  it("tags every scenario with a unique id derived from the dataset hash and sizing", () => {
    const a = buildScenarioParameters("specials_squeeze", dataset(), baseline, { breadth: 1, spreadBps: 50 }) as { scenario_id: string };
    const b = buildScenarioParameters("specials_squeeze", dataset(), baseline, { breadth: 1, spreadBps: 200 }) as { scenario_id: string };
    expect(a.scenario_id).not.toBe(b.scenario_id);
    expect(a.scenario_id).toContain("abcdef12");
  });
});

describe("familyAvailability", () => {
  it("is available for families the synthetic dataset supports", () => {
    expect(familyAvailability("recall_wave", dataset()).available).toBe(true);
    expect(familyAvailability("rate_shock_ladder", dataset()).available).toBe(true);
  });
  it("treats limits whose effective_from is a timestamp as in force (the synthetic generator's format)", () => {
    const ds = dataset({ counterparty_limits: [{ limit_id: "T1", effective_from: "2026-09-14T12:00:00Z", effective_to: null }] });
    expect(familyAvailability("borrower_limit_cut", ds).available).toBe(true);
    const p = buildScenarioParameters("borrower_limit_cut", ds, baseline, { breadth: 1, reductionPct: 50 }) as { limit_ids: string[] };
    expect(p.limit_ids).toEqual(["T1"]);
  });
  it("ignores limits that have not started or have ended", () => {
    const ds = dataset({ counterparty_limits: [
      { limit_id: "FUTURE", effective_from: "2026-09-15T00:00:00Z", effective_to: null },
      { limit_id: "ENDED", effective_from: "2026-01-01", effective_to: "2026-09-14T11:00:00Z" },
    ] });
    expect(familyAvailability("borrower_limit_cut", ds).available).toBe(false);
  });
  it("explains why quote expiry and balance-sheet haircut cannot run without quotes or budgets", () => {
    const q = familyAvailability("quote_expiry", dataset());
    const b = familyAvailability("balance_sheet_haircut", dataset());
    expect(q.available).toBe(false);
    expect(q.reason).toMatch(/quote/i);
    expect(b.available).toBe(false);
    expect(b.reason).toMatch(/budget/i);
  });
  it("becomes available when the dataset carries quotes and budgets", () => {
    const ds = dataset({
      external_borrow_quotes: [{ quote_id: "Q1", expires_at: "2026-09-14T18:00:00Z", observed_at: "2026-09-14T08:00:00Z" }],
      balance_sheet_budgets: [{ budget_id: "BB1" }],
    });
    expect(familyAvailability("quote_expiry", ds).available).toBe(true);
    expect(familyAvailability("balance_sheet_haircut", ds).available).toBe(true);
  });
});

describe("sizing fields", () => {
  it("has a default for every field of every family, inside its own range", () => {
    for (const family of SCENARIO_FAMILIES) {
      const defaults = defaultSizing(family.id);
      for (const field of family.fields) {
        expect(defaults[field.key]).toBeGreaterThanOrEqual(field.min);
        expect(defaults[field.key]).toBeLessThanOrEqual(field.max);
      }
    }
  });
  it("clamps out-of-range and non-numeric input", () => {
    const fam = SCENARIO_FAMILIES.find((f) => f.id === "recall_wave")!;
    const clamped = clampSizing("recall_wave", { recallPct: 900, breadth: Number.NaN });
    const pct = fam.fields.find((f) => f.key === "recallPct")!;
    expect(clamped.recallPct).toBe(pct.max);
    expect(clamped.breadth).toBe(defaultSizing("recall_wave").breadth);
  });
  it("produces default parameters that reference real entities for every available family", () => {
    const ds = dataset({
      external_borrow_quotes: [{ quote_id: "Q1", expires_at: "2026-09-14T18:00:00Z", observed_at: "2026-09-14T08:00:00Z" }],
      balance_sheet_budgets: [{ budget_id: "BB1" }],
    });
    for (const family of SCENARIO_FAMILIES) {
      const p = buildScenarioParameters(family.id, ds, baseline, defaultSizing(family.id));
      expect(p.scenario_id).toBeTruthy();
      const lists = Object.values(p).filter(Array.isArray) as unknown[][];
      for (const list of lists) expect(list.length).toBeGreaterThan(0);
    }
  });
});

describe("rankStressOutcomes", () => {
  const outcome = (id: string, delta: number | null, extra: Partial<IbalStressOutcome> = {}): IbalStressOutcome => ({
    scenario_id: id, scenario_name: id, status: "optimal", verification_passed: true, objective_delta_usd: delta,
    baseline_objective_usd: 100, scenario_objective_usd: delta === null ? null : 100 + delta, rank: null,
    driver_deltas: [], driver_reconciliations: [], ...extra,
  });
  it("orders the most damaging scenario first and tags each with its family", () => {
    const ranked = rankStressOutcomes([
      { family: "specials_squeeze", outcomes: [outcome("a", 40)] },
      { family: "borrower_default", outcomes: [outcome("b", -700)] },
      { family: "rate_shock_ladder", outcomes: [outcome("c1", 20), outcome("c2", -10)] },
    ]);
    expect(ranked.map((r) => r.outcome.scenario_id)).toEqual(["b", "c2", "c1", "a"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(ranked[0].family).toBe("borrower_default");
  });
  it("puts infeasible or unscored outcomes ahead of every feasible one", () => {
    const ranked = rankStressOutcomes([
      { family: "recall_wave", outcomes: [outcome("ok", -5)] },
      { family: "supply_shock", outcomes: [outcome("bad", null, { status: "infeasible", verification_passed: false })] },
    ]);
    expect(ranked[0].outcome.scenario_id).toBe("bad");
  });
  it("is stable for equal deltas", () => {
    const ranked = rankStressOutcomes([
      { family: "recall_wave", outcomes: [outcome("x", -1)] },
      { family: "supply_shock", outcomes: [outcome("y", -1)] },
    ]);
    expect(ranked.map((r) => r.outcome.scenario_id)).toEqual(["x", "y"]);
  });
});
