import { describe, expect, test } from "vitest";
import { orderedStressOutcomes, type IbalStressOutcome } from "./inventoryOptimizer";

describe("engine stress ranking", () => {
  test("keeps verified engine ranks and moves failed or unchecked solves out of the ranking", () => {
    const outcome = (scenario_id: string, status: string, verification_passed: boolean, rank: number | null): IbalStressOutcome => ({
      scenario_id, scenario_name: scenario_id, status, verification_passed, rank,
      objective_delta_usd: rank === null ? null : -rank, baseline_objective_usd: 10,
      scenario_objective_usd: rank === null ? null : 10 - rank,
      driver_deltas: [], driver_reconciliations: [],
    });
    const rows = [outcome("unchecked", "optimal", false, 1), outcome("second", "optimal", true, 2),
      outcome("infeasible", "infeasible", false, null), outcome("first", "optimal", true, 1)];
    const ordered = orderedStressOutcomes(rows);
    expect(ordered.map((item) => item.scenario_id)).toEqual(["first", "second", "infeasible", "unchecked"]);
    expect(ordered[0].rank).toBe(1);
    expect(rows[0].scenario_id).toBe("unchecked");
  });
});
