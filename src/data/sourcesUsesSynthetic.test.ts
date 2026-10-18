import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  NEUTRAL_KNOBS, SCENARIOS, applyKnobs, baseProblem, solveSim, toWorkspaceConfiguration, verifySim,
  type FeasibleResult, type SimProblem,
} from "./sourcesUsesSynthetic";
import { validateConfiguration } from "./sourcesUses";

const feasible = (problem: SimProblem): FeasibleResult => {
  const result = solveSim(problem);
  if (result.status !== "optimal") throw new Error("expected a feasible solve");
  return result;
};

const tiny = (overrides: Partial<SimProblem> = {}): SimProblem => ({
  sources: [
    { id: "A", label: "A", short: "A", family: "internal", legalEntity: "E", amount: 100, costBps: 10, haircutPct: 0 },
    { id: "B", label: "B", short: "B", family: "secured", legalEntity: "E", amount: 100, costBps: 30, haircutPct: 20 },
  ],
  uses: [
    { id: "X", label: "X", short: "X", legalEntity: "E", amount: 80, tier: 1, policy: "hard", penaltyBps: 0 },
  ],
  lanes: [
    { sourceId: "A", useId: "X", frictionBps: 0, note: "" },
    { sourceId: "B", useId: "X", frictionBps: 0, note: "" },
  ],
  ...overrides,
});

describe("SU-SIM synthetic dataset", () => {
  test("is deterministic and contains no random source (SIM-AC-001)", () => {
    expect(baseProblem()).toEqual(baseProblem());
    const source = readFileSync(fileURLToPath(new URL("./sourcesUsesSynthetic.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/Math\.random|crypto\.|randomUUID/);
  });

  test("has eight sources, ten uses, three families, four tiers, single currency", () => {
    const p = baseProblem();
    expect(p.sources).toHaveLength(8);
    expect(p.uses).toHaveLength(10);
    expect(new Set(p.sources.map((s) => s.family)).size).toBe(3);
    expect(new Set(p.uses.map((u) => u.tier))).toEqual(new Set([1, 2, 3, 4]));
  });
});

describe("SU-SIM model (SIM-AC-002)", () => {
  test("prefers the cheap source and credits haircut-adjusted coverage", () => {
    const r = feasible(tiny());
    const a = r.flows.find((f) => f.sourceId === "A")!;
    expect(a.nominal).toBeCloseTo(80, 6);
    expect(r.totals.annualCostMm).toBeCloseTo((80 * 10) / 10_000, 9);
  });

  test("a haircut forces extra nominal: 100 of B at 20% covers only 80", () => {
    const p = tiny();
    p.sources[0].amount = 0;
    const r = feasible(p);
    const b = r.flows.find((f) => f.sourceId === "B")!;
    expect(b.nominal).toBeCloseTo(100, 6);
    expect(b.coverage).toBeCloseTo(80, 6);
    expect(r.totals.haircutDrag).toBeCloseTo(20, 6);
  });

  test("hand-derived duals: binding cheap source is worth the cost gap", () => {
    // Need 150 coverage. A (10bp, 100 cap) is exhausted; B covers 50 at 30bp / 0.8 = 37.5bp per $ coverage.
    const p = tiny();
    p.uses[0].amount = 150;
    const r = feasible(p);
    expect(r.useDualBps.X).toBeCloseTo(37.5, 6);
    expect(r.capacityDualBps.A).toBeCloseTo(27.5, 6);
    expect(r.capacityDualBps.B).toBeCloseTo(0, 6);
  });

  test("a higher tier cannot be outbid by a lower tier with huge economics (AC-004)", () => {
    const p: SimProblem = {
      sources: [{ id: "A", label: "A", short: "A", family: "internal", legalEntity: "E", amount: 100, costBps: 1, haircutPct: 0 }],
      uses: [
        { id: "T1", label: "T1", short: "T1", legalEntity: "E", amount: 100, tier: 1, policy: "soft", penaltyBps: 1 },
        { id: "T2", label: "T2", short: "T2", legalEntity: "E", amount: 100, tier: 2, policy: "soft", penaltyBps: 1_000_000 },
      ],
      lanes: [{ sourceId: "A", useId: "T1", frictionBps: 0, note: "" }, { sourceId: "A", useId: "T2", frictionBps: 0, note: "" }],
    };
    const r = feasible(p);
    expect(r.shortfall.T1).toBeCloseTo(0, 6);
    expect(r.shortfall.T2).toBeCloseTo(100, 6);
    expect(verifySim(r).every((c) => c.passed)).toBe(true);
  });

  test("denied lanes are unusable", () => {
    const r = feasible(applyKnobs(tiny(), { ...NEUTRAL_KNOBS, deniedLanes: ["A>X"] }));
    expect(r.flows.find((f) => f.sourceId === "A")).toBeUndefined();
    expect(r.flows.find((f) => f.sourceId === "B")!.nominal).toBeCloseTo(100, 6);
  });
});

describe("SU-SIM scenarios & verifier (SIM-AC-003/004/005)", () => {
  test("six named scenarios exist", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(["base", "repo-squeeze", "haircut-shock", "margin-surge", "rate-shock", "cascade"]);
  });

  for (const scenario of SCENARIOS.filter((s) => s.id !== "cascade")) {
    test(`${scenario.id}: solves and passes every verification check`, () => {
      const r = feasible(scenario.build());
      const checks = verifySim(r);
      expect(checks.filter((c) => !c.passed)).toEqual([]);
      // Totals reconcile: coverage + shortfall = demand.
      expect(r.totals.coverage + r.totals.shortfall).toBeCloseTo(r.totals.demand, 6);
      const sumUsed = Object.values(r.sourceUsed).reduce((a, v) => a + v, 0);
      expect(sumUsed).toBeCloseTo(r.totals.nominal, 6);
    });
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
    const base = feasible(baseProblem());
    const surge = feasible(SCENARIOS.find((s) => s.id === "margin-surge")!.build());
    const lowShort = (r: FeasibleResult) => r.problem.uses.filter((u) => u.tier >= 3).reduce((a, u) => a + r.shortfall[u.id], 0);
    expect(lowShort(surge)).toBeGreaterThan(lowShort(base));
    expect(surge.totals.annualCostMm).toBeGreaterThan(base.totals.annualCostMm);
  });

  test("every stress-control corner either certifies or reports a hard gap", () => {
    const levels = [0, 0.5, 1.5];
    let feasibleCount = 0;
    let infeasibleCount = 0;
    for (const internal of levels) for (const secured of levels) for (const unsecured of levels)
      for (const haircutShiftPp of [0, 20]) for (const demandScale of [0.6, 1.4]) for (const unsecuredCostShiftBps of [-50, 300]) {
        const problem = applyKnobs(baseProblem(), { ...NEUTRAL_KNOBS, capacity: { internal, secured, unsecured }, haircutShiftPp, demandScale, unsecuredCostShiftBps });
        const r = solveSim(problem);
        if (r.status === "optimal") {
          feasibleCount++;
          const failed = verifySim(r).filter((c) => !c.passed);
          expect(failed, JSON.stringify({ internal, secured, unsecured, haircutShiftPp, demandScale, unsecuredCostShiftBps, failed })).toEqual([]);
        } else {
          infeasibleCount++;
          expect(r.totalGap).toBeGreaterThan(0);
        }
      }
    expect(feasibleCount).toBeGreaterThan(0);
    expect(infeasibleCount).toBeGreaterThan(0);
  });

  test("a tampered flow fails verification", () => {
    const r = feasible(baseProblem());
    const tampered: FeasibleResult = { ...r, flows: r.flows.map((f, i) => (i === 0 ? { ...f, nominal: f.nominal + 25 } : f)) };
    expect(verifySim(tampered).some((c) => !c.passed)).toBe(true);
  });

  test("a scenario copies into a valid workspace configuration (SIM-008)", () => {
    const config = toWorkspaceConfiguration(baseProblem(), "SIM · Balanced book", "cfg-sim-test");
    expect(validateConfiguration(config)).toEqual([]);
    expect(config.compatibility).toHaveLength(80);
    expect(config.sources.every((s) => s.tags.includes("SIM"))).toBe(true);
  });
});
