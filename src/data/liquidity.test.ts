import { describe, expect, it } from "vitest";
import { getEarlyWarningSignals, mergeLiveEWS } from "./liquidity";

const series = (values: number[]) => ({ source: "FRED", observations: values.map((value, i) => ({ date: `2026-10-${10 + i}`, value })) });

describe("early-warning signal provenance", () => {
  it("labels every signal SIM until live data replaces it", () => {
    expect(getEarlyWarningSignals().every((s) => s.source === "SIM")).toBe(true);
    expect(mergeLiveEWS(getEarlyWarningSignals(), {}).every((s) => s.source === "SIM")).toBe(true);
  });

  it("marks only the two signals that FRED actually updated as FRED", () => {
    const merged = mergeLiveEWS(getEarlyWarningSignals(), {
      SOFR: series([4.31]), EFFR: series([4.08]), BAMLH0A0HYM2: series([3.0, 3.1, 3.2, 3.3, 3.4, 3.6]),
    });
    const live = merged.filter((s) => s.source === "FRED").map((s) => s.signal);
    expect(live).toEqual(["SOFR - EFFR spread", "HY OAS 5d move"]);
    expect(merged.find((s) => s.signal === "SOFR - EFFR spread")!.latest).toBeCloseTo(23, 5);
    expect(merged.find((s) => s.signal === "SOFR - EFFR spread")!.status).toBe("RISK");
  });
});
