import { describe, test, expect } from "vitest";
import { worstSource } from "@/lib/provenance";

const pct = (now: number | undefined, then: number | undefined, decimals = 1): number | null => {
  if (now == null || then == null || then === 0) return null;
  return Number((((now - then) / Math.abs(then)) * 100).toFixed(decimals));
};

const ppDelta = (now: number | null, then: number | null, decimals = 2): number | null =>
  now != null && then != null ? Number((now - then).toFixed(decimals)) : null;

describe("pct helper", () => {
  test("computes percent change correctly for level series", () => {
    expect(pct(100, 95)).toBe(5.3);
  });

  test("computes percent change with custom decimals", () => {
    expect(pct(100, 95, 2)).toBe(5.26);
  });

  test("returns null when prior is zero", () => {
    expect(pct(100, 0)).toBeNull();
  });

  test("returns null when either value is undefined", () => {
    expect(pct(undefined, 100)).toBeNull();
    expect(pct(100, undefined)).toBeNull();
  });

  test("handles negative changes", () => {
    expect(pct(90, 100)).toBe(-10);
  });
});

describe("ppDelta helper", () => {
  test("computes percentage point delta", () => {
    expect(ppDelta(4.17, 3.78)).toBe(0.39);
  });

  test("returns null when either input is null", () => {
    expect(ppDelta(null, 3.78)).toBeNull();
    expect(ppDelta(4.17, null)).toBeNull();
  });
});

describe("buildPoint MoM derivation", () => {
  test("derives MoM from raw levels when two consecutive values exist", () => {
    const rawValues = [320, 325];
    const mom = pct(rawValues[rawValues.length - 1], rawValues[rawValues.length - 2], 2);
    expect(mom).toBe(1.56);
  });

  test("derives YoY from raw levels when 13 values exist for monthly", () => {
    const rawValues = Array.from({ length: 13 }, (_, i) => 100 + i);
    const yoy = pct(rawValues[rawValues.length - 1], rawValues[rawValues.length - 13], 1);
    expect(yoy).toBe(12);
  });

  test("returns null for YoY when insufficient history", () => {
    const rawValues = Array.from({ length: 5 }, (_, i) => 100 + i);
    const yoy = rawValues.length >= 13
      ? pct(rawValues[rawValues.length - 1], rawValues[rawValues.length - 13], 1)
      : null;
    expect(yoy).toBeNull();
  });
});

describe("FRED_CATALOG contract", () => {
  test("catalog has entries", () => {
    expect(FRED_CATALOG.length).toBeGreaterThan(20);
  });

  test("each catalog entry has required fields", () => {
    for (const s of FRED_CATALOG) {
      expect(s.id).toBeTruthy();
      expect(s.label).toBeTruthy();
      expect(s.category).toBeTruthy();
      expect(s.freq).toMatch(/^[DWMQYA]$/);
      expect(typeof s.level).toBe("number");
      expect(typeof s.decimals).toBe("number");
    }
  });

  test("catalog series IDs are unique", () => {
    const ids = FRED_CATALOG.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("per-indicator source independence", () => {
  test("overall source reflects worst tier present (SIM when any are SIM)", () => {
    expect(worstSource(["FRED", "SIM", "SIM", "SNAPSHOT", "SIM"])).toBe("SIM");
  });

  test("overall source is SNAPSHOT when worst tier is SNAPSHOT", () => {
    expect(worstSource(["FRED", "FRED", "SNAPSHOT"])).toBe("SNAPSHOT");
  });

  test("overall source is FRED when all indicators are FRED", () => {
    expect(worstSource(["FRED", "FRED", "FRED"])).toBe("FRED");
  });

  test("overall source is SIM when all indicators are SIM", () => {
    expect(worstSource(["SIM", "SIM", "SIM"])).toBe("SIM");
  });

  test("overall source defaults to SIM for empty array", () => {
    expect(worstSource([])).toBe("SIM");
  });
});
