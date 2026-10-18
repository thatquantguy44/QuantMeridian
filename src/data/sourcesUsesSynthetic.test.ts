import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PENALTIES, NEUTRAL_KNOBS, SCENARIOS, applyKnobs, baseProblem, solveSim, toWorkspaceConfiguration, verifySim,
  type FeasibleResult, type PenaltyConfig, type SimProblem, type SimSource, type SimUse,
} from "./sourcesUsesSynthetic";
import { validateConfiguration } from "./sourcesUses";

/** All penalty components off: a plain transportation problem. */
const PLAIN: PenaltyConfig = {
  ...DEFAULT_PENALTIES,
  crossEntityBps: 0,
  tenorMismatchBpsPer30d: 0,
  haircutChargeBps: 0,
  concentration: { enabled: false, thresholdPct: 100, penaltyBps: 0 },
  idleEnabled: false,
  minDrawEnabled: false,
};

const feasible = (problem: SimProblem, config: PenaltyConfig = PLAIN): FeasibleResult => {
  const result = solveSim(problem, config);
  if (result.status !== "optimal") throw new Error("expected a feasible solve");
  expect(verifySim(result).filter((c) => !c.passed)).toEqual([]);
  return result;
};

const source = (id: string, costBps: number, extra: Partial<SimSource> = {}): SimSource => ({
  id, label: id, short: id, family: "internal", legalEntity: "E", amount: 100, costBps, haircutPct: 0,
  tenorDays: 1, idlePenaltyBps: 0, minDraw: 0, minDrawPenaltyBps: 0, ...extra,
});
const use = (id: string, amount: number, extra: Partial<SimUse> = {}): SimUse => ({
  id, label: id, short: id, legalEntity: "E", amount, tier: 1, policy: "hard", penaltyBps: 0, tenorDays: 1, ...extra,
});
const lanes = (pairs: [string, string, number?][]) => pairs.map(([sourceId, useId, penaltyBps = 0]) => ({ sourceId, useId, penaltyBps, note: "" }));
const flow = (r: FeasibleResult, s: string, u: string) => r.flows.find((f) => f.sourceId === s && f.useId === u)?.nominal ?? 0;

const tiny = (): SimProblem => ({
  sources: [source("A", 10), source("B", 30, { family: "secured", haircutPct: 20 })],
  uses: [use("X", 80)],
  lanes: lanes([["A", "X"], ["B", "X"]]),
});

describe("SU-SIM synthetic dataset", () => {
  test("is deterministic and contains no random source (SIM-AC-001)", () => {
    expect(baseProblem()).toEqual(baseProblem());
    const text = readFileSync(fileURLToPath(new URL("./sourcesUsesSynthetic.ts", import.meta.url)), "utf8");
    expect(text).not.toMatch(/Math\.random|crypto\.|randomUUID/);
  });

  test("has eight sources, ten uses, three families, four tiers, single currency", () => {
    const p = baseProblem();
    expect(p.sources).toHaveLength(8);
    expect(p.uses).toHaveLength(10);
    expect(new Set(p.sources.map((s) => s.family)).size).toBe(3);
    expect(new Set(p.uses.map((u) => u.tier))).toEqual(new Set([1, 2, 3, 4]));
  });
});

describe("classic transportation core (SIM-AC-002)", () => {
  test("prefers the cheap source and credits haircut-adjusted coverage", () => {
    const r = feasible(tiny());
    expect(flow(r, "A", "X")).toBeCloseTo(80, 6);
    expect(r.idle.A).toBeCloseTo(20, 6);
    expect(r.totals.totalCostMm).toBeCloseTo((80 * 10) / 10_000, 9);
  });

  test("a haircut forces extra nominal: 100 of B at 20% covers only 80", () => {
    const p = tiny();
    p.sources[0].amount = 0;
    const r = feasible(p);
    expect(flow(r, "B", "X")).toBeCloseTo(100, 6);
    expect(r.totals.haircutDrag).toBeCloseTo(20, 6);
  });

  test("hand-derived duals: binding cheap source is worth the cost gap", () => {
    // Need 150 coverage. A (10bp, 100) is exhausted; B covers 50 at 30bp / 0.8 = 37.5bp per $ coverage.
    const p = tiny();
    p.uses[0].amount = 150;
    const r = feasible(p);
    expect(r.useDualBps.X).toBeCloseTo(37.5, 6);
    expect(r.capacityDualBps.A).toBeCloseTo(27.5, 6);
    expect(r.capacityDualBps.B).toBeCloseTo(0, 6);
  });

  test("supply and demand balance through the dummy idle and shortfall nodes", () => {
    const p: SimProblem = { sources: [source("A", 10)], uses: [use("X", 150, { policy: "soft", penaltyBps: 200 })], lanes: lanes([["A", "X"]]) };
    const r = feasible(p);
    expect(r.idle.A).toBeCloseTo(0, 6);
    expect(r.shortfall.X).toBeCloseTo(50, 6);
    expect(r.breakdown.shortfall).toBeCloseTo((50 * 200) / 10_000, 9);
  });

  test("denied lanes are unusable", () => {
    const r = feasible(applyKnobs(tiny(), { ...NEUTRAL_KNOBS, deniedLanes: ["A>X"] }));
    expect(flow(r, "A", "X")).toBe(0);
    expect(flow(r, "B", "X")).toBeCloseTo(100, 6);
  });
});

describe("configurable penalties", () => {
  const twoEqual = (): SimProblem => ({
    sources: [source("A", 20), source("B", 22)],
    uses: [use("X", 80)],
    lanes: lanes([["A", "X"], ["B", "X"]]),
  });

  test("a pair penalty re-routes flow, and its override takes precedence", () => {
    const p = twoEqual();
    p.lanes[0].penaltyBps = 5; // A→X now 25bp vs B→X 22bp
    expect(flow(feasible(p), "B", "X")).toBeCloseTo(80, 6);
    const r = feasible(p, { ...PLAIN, lanePenaltyOverrides: { "A>X": 0 } });
    expect(flow(r, "A", "X")).toBeCloseTo(80, 6);
    expect(r.flows.find((f) => f.sourceId === "A")!.cost.pair).toBe(0);
  });

  test("cross-entity penalty applies only across legal entities", () => {
    const p = twoEqual();
    p.sources[0].legalEntity = "Other";
    expect(flow(feasible(p), "A", "X")).toBeCloseTo(80, 6);
    const r = feasible(p, { ...PLAIN, crossEntityBps: 5 });
    expect(flow(r, "B", "X")).toBeCloseTo(80, 6);
    expect(r.flows.find((f) => f.sourceId === "A")!.cost.crossEntity).toBe(5);
    expect(r.flows.find((f) => f.sourceId === "B")!.cost.crossEntity).toBe(0);
  });

  test("tenor mismatch penalty pushes term uses to term funding", () => {
    const p: SimProblem = {
      sources: [source("ON", 10, { tenorDays: 1 }), source("TERM", 25, { tenorDays: 365 })],
      uses: [use("X", 80, { tenorDays: 365 })],
      lanes: lanes([["ON", "X"], ["TERM", "X"]]),
    };
    expect(flow(feasible(p), "ON", "X")).toBeCloseTo(80, 6);
    // 1.5bp × 364 / 30 = 18.2bp → overnight costs 28.2bp vs term 25bp.
    const r = feasible(p, { ...PLAIN, tenorMismatchBpsPer30d: 1.5 });
    expect(flow(r, "TERM", "X")).toBeCloseTo(80, 6);
    expect(r.flows.find((f) => f.sourceId === "ON")!.cost.tenor).toBeCloseTo(18.2, 9);
  });

  test("haircut charge prices the encumbered over-collateral", () => {
    const p = tiny();
    p.sources[0].amount = 0;
    const r = feasible(p, { ...PLAIN, haircutChargeBps: 50 });
    expect(r.flows.find((f) => f.sourceId === "B")!.cost.haircut).toBeCloseTo(10, 9); // 50bp × 20%
    expect(r.breakdown.haircut).toBeCloseTo((100 * 10) / 10_000, 9);
  });

  test("concentration penalty is convex: cheap lane up to the threshold, then the next best", () => {
    const p: SimProblem = {
      sources: [source("A", 10, { amount: 200 }), source("B", 15, { amount: 200 })],
      uses: [use("X", 100)],
      lanes: lanes([["A", "X"], ["B", "X"]]),
    };
    const steep = feasible(p, { ...PLAIN, concentration: { enabled: true, thresholdPct: 60, penaltyBps: 12 } });
    expect(flow(steep, "A", "X")).toBeCloseTo(60, 6);
    expect(flow(steep, "B", "X")).toBeCloseTo(40, 6);
    const mild = feasible(p, { ...PLAIN, concentration: { enabled: true, thresholdPct: 60, penaltyBps: 2 } });
    expect(flow(mild, "A", "X")).toBeCloseTo(100, 6);
    expect(mild.flows.find((f) => f.sourceId === "A")!.excess).toBeCloseTo(40, 6);
    expect(mild.breakdown.concentration).toBeCloseTo((40 * 2) / 10_000, 9);
  });

  test("idle penalty makes it cheaper to use a source than to leave it idle", () => {
    const p = twoEqual();
    p.sources[1].idlePenaltyBps = 5; // B: 22bp used vs 5bp if idle → effective 17bp
    expect(flow(feasible(p), "A", "X")).toBeCloseTo(80, 6);
    const r = feasible(p, { ...PLAIN, idleEnabled: true });
    expect(flow(r, "B", "X")).toBeCloseTo(80, 6);
    expect(r.capacityDualBps.B).toBeLessThan(0);
    expect(feasible(p, { ...PLAIN, idleEnabled: true, idleOverrides: { B: 0 } }).flows.find((f) => f.sourceId === "A")!.nominal).toBeCloseTo(80, 6);
  });

  test("minimum draw keeps a costly source at its floor while the penalty exceeds the saving", () => {
    const p: SimProblem = {
      sources: [source("A", 10), source("CP", 50, { minDraw: 30, minDrawPenaltyBps: 100 })],
      uses: [use("X", 80)],
      lanes: lanes([["A", "X"], ["CP", "X"]]),
    };
    expect(flow(feasible(p), "CP", "X")).toBe(0);
    const r = feasible(p, { ...PLAIN, minDrawEnabled: true });
    expect(flow(r, "CP", "X")).toBeCloseTo(30, 6);
    expect(r.minDrawGap.CP).toBeCloseTo(0, 6);
    p.sources[1].minDrawPenaltyBps = 20; // cheaper to pay the floor penalty
    const cheap = feasible(p, { ...PLAIN, minDrawEnabled: true });
    expect(cheap.minDrawGap.CP).toBeCloseTo(30, 6);
  });

  test("a soft shortfall override changes what is shed (weighted priority)", () => {
    const p: SimProblem = {
      sources: [source("A", 100)],
      uses: [use("X", 100, { policy: "soft", penaltyBps: 50 })],
      lanes: lanes([["A", "X"]]),
    };
    const weighted: PenaltyConfig = { ...PLAIN, priorityMode: "weighted" };
    expect(feasible(p, weighted).shortfall.X).toBeCloseTo(100, 6);
    expect(feasible(p, { ...weighted, shortfallOverrides: { X: 500 } }).shortfall.X).toBeCloseTo(0, 6);
  });
});

describe("priority modes (AC-004)", () => {
  const tiers = (): SimProblem => ({
    sources: [source("A", 1)],
    uses: [
      use("T1", 100, { tier: 1, policy: "soft", penaltyBps: 1 }),
      use("T2", 100, { tier: 2, policy: "soft", penaltyBps: 1_000_000 }),
    ],
    lanes: lanes([["A", "T1"], ["A", "T2"]]),
  });

  test("lexicographic: a higher tier cannot be outbid by a lower tier with huge economics", () => {
    const r = feasible(tiers());
    expect(r.shortfall.T1).toBeCloseTo(0, 6);
    expect(r.shortfall.T2).toBeCloseTo(100, 6);
  });

  test("weighted: one penalised transport lets the large penalty win", () => {
    const r = feasible(tiers(), { ...PLAIN, priorityMode: "weighted" });
    expect(r.shortfall.T1).toBeCloseTo(100, 6);
    expect(r.shortfall.T2).toBeCloseTo(0, 6);
    expect(r.stages).toEqual([]);
  });
});

describe("SU-SIM scenarios & verifier (SIM-AC-003/004/005)", () => {
  test("six named scenarios exist", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(["base", "repo-squeeze", "haircut-shock", "margin-surge", "rate-shock", "cascade"]);
  });

  for (const scenario of SCENARIOS.filter((s) => s.id !== "cascade")) {
    for (const priorityMode of ["lexicographic", "weighted"] as const) {
      test(`${scenario.id} (${priorityMode}): solves and passes every verification check`, () => {
        const r = feasible(scenario.build(), { ...DEFAULT_PENALTIES, priorityMode });
        expect(r.totals.coverage + r.totals.shortfall).toBeCloseTo(r.totals.demand, 6);
        const sumUsed = Object.values(r.sourceUsed).reduce((a, v) => a + v, 0);
        expect(sumUsed).toBeCloseTo(r.totals.nominal, 6);
        expect(r.totals.totalCostMm).toBeCloseTo(r.objectiveBpsMm / 10_000, 9);
      });
    }
  }

  test("cascade is infeasible and names the short hard uses without a solution", () => {
    const r = solveSim(SCENARIOS.find((s) => s.id === "cascade")!.build());
    expect(r.status).toBe("infeasible");
    if (r.status !== "infeasible") return;
    expect(r.shortUses.length).toBeGreaterThan(0);
    expect(r.totalGap).toBeGreaterThan(0);
    const hardIds = new Set(r.problem.uses.filter((u) => u.policy === "hard").map((u) => u.id));
    expect(r.shortUses.every((u) => hardIds.has(u.useId))).toBe(true);
    expect("flows" in r).toBe(false);
  });

  test("margin surge keeps tier 1 whole and pushes shortfall to lower tiers", () => {
    const base = feasible(baseProblem(), DEFAULT_PENALTIES);
    const surge = feasible(SCENARIOS.find((s) => s.id === "margin-surge")!.build(), DEFAULT_PENALTIES);
    const lowShort = (r: FeasibleResult) => r.problem.uses.filter((u) => u.tier >= 3).reduce((a, u) => a + r.shortfall[u.id], 0);
    expect(lowShort(surge)).toBeGreaterThan(lowShort(base));
    expect(surge.totals.totalCostMm).toBeGreaterThan(base.totals.totalCostMm);
  });

  test("every stress-control and penalty corner either certifies or reports a hard gap", () => {
    const levels = [0, 0.5, 1.5];
    let feasibleCount = 0;
    let infeasibleCount = 0;
    const configs: PenaltyConfig[] = [
      DEFAULT_PENALTIES,
      { ...DEFAULT_PENALTIES, priorityMode: "weighted", concentration: { enabled: true, thresholdPct: 40, penaltyBps: 30 }, crossEntityBps: 40 },
    ];
    for (const config of configs) for (const internal of levels) for (const secured of levels) for (const unsecured of levels)
      for (const haircutShiftPp of [0, 20]) for (const demandScale of [0.6, 1.4]) {
        const problem = applyKnobs(baseProblem(), { ...NEUTRAL_KNOBS, capacity: { internal, secured, unsecured }, haircutShiftPp, demandScale, unsecuredCostShiftBps: 150 });
        const r = solveSim(problem, config);
        if (r.status === "optimal") {
          feasibleCount++;
          const failed = verifySim(r).filter((c) => !c.passed);
          expect(failed, JSON.stringify({ internal, secured, unsecured, haircutShiftPp, demandScale, mode: config.priorityMode, failed })).toEqual([]);
        } else {
          infeasibleCount++;
          expect(r.totalGap).toBeGreaterThan(0);
        }
      }
    expect(feasibleCount).toBeGreaterThan(0);
    expect(infeasibleCount).toBeGreaterThan(0);
  });

  test("a tampered flow fails verification", () => {
    const r = feasible(baseProblem(), DEFAULT_PENALTIES);
    const tampered: FeasibleResult = { ...r, flows: r.flows.map((f, i) => (i === 0 ? { ...f, nominal: f.nominal + 25 } : f)) };
    expect(verifySim(tampered).some((c) => !c.passed)).toBe(true);
  });

  test("a tampered dual fails the optimality certificate", () => {
    const r = feasible(baseProblem(), DEFAULT_PENALTIES);
    const duals = r.lp.duals.map((d, i) => (i === 0 ? d + 50 : d));
    const failed = verifySim({ ...r, lp: { ...r.lp, duals } }).filter((c) => !c.passed).map((c) => c.id);
    expect(failed.some((id) => id === "dual" || id === "gap" || id === "cs")).toBe(true);
  });

  test("a scenario copies into a valid workspace configuration (SIM-008)", () => {
    const config = toWorkspaceConfiguration(baseProblem(), "SIM · Balanced book", "cfg-sim-test");
    expect(validateConfiguration(config)).toEqual([]);
    expect(config.compatibility).toHaveLength(80);
    expect(config.sources.every((s) => s.tags.includes("SIM"))).toBe(true);
  });
});
