import { describe, expect, it } from "vitest";
import { gaugeColor } from "./Radial";

const RED = "#FF3B3B", AMBER = "#FF8C00", GREEN = "#2ECC71";

describe("gaugeColor", () => {
  it("keeps the default lower-is-better bands for existing gauges", () => {
    expect(gaugeColor(50, { warn: 75, danger: 90 })).toBe(GREEN);
    expect(gaugeColor(80, { warn: 75, danger: 90 })).toBe(AMBER);
    expect(gaugeColor(95, { warn: 75, danger: 90 })).toBe(RED);
  });
  it("inverts the bands when higher is better (liquidity ratios)", () => {
    const bands = { higherIsBetter: true, danger: 100, warn: 110 };
    expect(gaugeColor(95, bands)).toBe(RED);     // below the regulatory minimum
    expect(gaugeColor(105, bands)).toBe(AMBER);  // above it but thin
    expect(gaugeColor(130, bands)).toBe(GREEN);  // comfortable
    expect(gaugeColor(100, bands)).toBe(AMBER);  // exactly at the minimum is not a breach
  });
});
