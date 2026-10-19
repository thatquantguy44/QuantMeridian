import { describe, expect, it } from "vitest";
import { getReinvestmentScenarios } from "./reinvestment";

describe("getReinvestmentScenarios", () => {
  const book = { cashCollateral: 10_000_000_000, netSpreadBps: 40 };
  const byName = Object.fromEntries(getReinvestmentScenarios(book).map((s) => [s.scenario, s]));

  it("prices scenarios off the book it is given, so they match the KPI strip", () => {
    expect(byName.Hold.incomeImpact).toBe(0);
    expect(byName.Hold.netSpreadBps).toBe(40);
  });

  it("scales the annual impact with the rate move through the documented pass-through", () => {
    // move × 0.82 × 0.42 bp of spread on $10bn, per year
    expect(byName["25bp Cut"].incomeImpact).toBeCloseTo(10e9 * (-25 * 0.82 * 0.42) / 10_000, 2);
    expect(byName["100bp Cut"].incomeImpact).toBeLessThan(byName["25bp Cut"].incomeImpact);
  });

  it("falls back to the simulated book when none is passed", () => {
    expect(getReinvestmentScenarios()).toHaveLength(5);
  });
});
