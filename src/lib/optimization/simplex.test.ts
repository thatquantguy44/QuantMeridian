import { describe, expect, test } from "vitest";
import { certifyLp, solveLp, type LpProblem } from "./simplex";

describe("two-phase simplex", () => {
  test("solves a classic 2x2 transportation problem with MODI-consistent duals", () => {
    // Supplies 35, 20; demands 25, 25; costs [[4, 6], [5, 3]].
    // Optimum: x11 = 25, x12 = 5, x22 = 20 -> 100 + 30 + 60 = 190.
    const problem: LpProblem = {
      cost: [4, 6, 5, 3],
      rows: [
        { name: "cap:A", sense: "<=", rhs: 35, coeffs: [[0, 1], [1, 1]] },
        { name: "cap:B", sense: "<=", rhs: 20, coeffs: [[2, 1], [3, 1]] },
        { name: "dem:1", sense: "=", rhs: 25, coeffs: [[0, 1], [2, 1]] },
        { name: "dem:2", sense: "=", rhs: 25, coeffs: [[1, 1], [3, 1]] },
      ],
    };
    const result = solveLp(problem);
    expect(result.status).toBe("optimal");
    expect(result.objective).toBeCloseTo(190, 9);
    expect(result.x.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([25, 5, 0, 20]);
    // Source A keeps 5 units of slack, so its capacity dual is 0.
    // Source B saves 3 per unit versus routing demand 2 from A (6 - 3).
    expect(result.duals[0]).toBeCloseTo(0, 9);
    expect(result.duals[1]).toBeCloseTo(-3, 9);
    expect(result.duals[2]).toBeCloseTo(4, 9);
    expect(result.duals[3]).toBeCloseTo(6, 9);
  });

  test("reports infeasibility when demand exceeds supply", () => {
    const result = solveLp({
      cost: [1],
      rows: [
        { name: "cap", sense: "<=", rhs: 5, coeffs: [[0, 1]] },
        { name: "dem", sense: "=", rhs: 8, coeffs: [[0, 1]] },
      ],
    });
    expect(result.status).toBe("infeasible");
  });

  test("reports unboundedness", () => {
    const result = solveLp({ cost: [-1], rows: [{ name: "floor", sense: ">=", rhs: 1, coeffs: [[0, 1]] }] });
    expect(result.status).toBe("unbounded");
  });

  test("handles negative right-hand sides and >= rows", () => {
    // min x + y  s.t.  -x - y <= -4,  x >= 1  ->  objective 4
    const result = solveLp({
      cost: [1, 1],
      rows: [
        { name: "a", sense: "<=", rhs: -4, coeffs: [[0, -1], [1, -1]] },
        { name: "b", sense: ">=", rhs: 1, coeffs: [[0, 1]] },
      ],
    });
    expect(result.status).toBe("optimal");
    expect(result.objective).toBeCloseTo(4, 9);
    expect(result.x[0]).toBeGreaterThanOrEqual(1 - 1e-9);
  });

  test("survives a redundant equality row", () => {
    const result = solveLp({
      cost: [1, 2],
      rows: [
        { name: "r1", sense: "=", rhs: 3, coeffs: [[0, 1], [1, 1]] },
        { name: "r2", sense: "=", rhs: 6, coeffs: [[0, 2], [1, 2]] },
      ],
    });
    expect(result.status).toBe("optimal");
    expect(result.objective).toBeCloseTo(3, 9);
  });

  test("certifies a solver optimum and rejects a perturbed one", () => {
    const problem: LpProblem = {
      cost: [4, 6, 5, 3],
      rows: [
        { name: "cap:A", sense: "<=", rhs: 35, coeffs: [[0, 1], [1, 1]] },
        { name: "cap:B", sense: "<=", rhs: 20, coeffs: [[2, 1], [3, 1]] },
        { name: "dem:1", sense: "=", rhs: 25, coeffs: [[0, 1], [2, 1]] },
        { name: "dem:2", sense: "=", rhs: 25, coeffs: [[1, 1], [3, 1]] },
      ],
    };
    const r = solveLp(problem);
    const ok = certifyLp(problem, r.x, r.duals);
    expect(ok.primalViolation).toBeLessThan(1e-9);
    expect(ok.dualViolation).toBeLessThan(1e-9);
    expect(ok.complementarity).toBeLessThan(1e-9);
    expect(Math.abs(ok.primalObjective - ok.dualObjective)).toBeLessThan(1e-9);
    // Feasible but suboptimal: route 5 units of demand 2 through B's costlier lane.
    const bad = certifyLp(problem, [20, 10, 5, 15], r.duals);
    expect(bad.primalObjective - bad.dualObjective).toBeGreaterThan(1);
  });
});
