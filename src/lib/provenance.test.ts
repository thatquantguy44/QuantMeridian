import { describe, it, expect, test } from "vitest";
import { classifyFreshness, PROVENANCE_META, provenanceMeta, resolveBadgeSource, worstSource, type ProvenanceSource, PROVENANCE_TONE_CLASS } from "./provenance";

const NOW = new Date("2026-06-23T12:00:00Z");

describe("classifyFreshness", () => {
  it("treats recent data (within a few days) as fresh, with no marker", () => {
    const info = classifyFreshness("2026-06-22", { now: NOW });
    expect(info.status).toBe("FRESH");
    expect(info.ageDays).toBe(1);
    expect(info.label).toBe("");
  });

  it("flags data past the fresh window as aging", () => {
    const info = classifyFreshness("2026-06-16", { now: NOW });
    expect(info.status).toBe("AGING");
    expect(info.ageDays).toBe(7);
    expect(info.label).toBe("7d");
  });

  it("flags data past the aging window as stale", () => {
    const info = classifyFreshness("2026-05-20", { now: NOW });
    expect(info.status).toBe("STALE");
    expect(info.label).toMatch(/^STALE · \d+d$/);
  });

  it("respects custom thresholds", () => {
    expect(classifyFreshness("2026-06-21", { now: NOW, freshDays: 1 }).status).toBe("AGING");
  });

  it("returns UNKNOWN with no marker for missing or unparseable dates", () => {
    expect(classifyFreshness(null, { now: NOW }).status).toBe("UNKNOWN");
    expect(classifyFreshness(null, { now: NOW }).label).toBe("");
    expect(classifyFreshness("not-a-date", { now: NOW }).status).toBe("UNKNOWN");
  });

  it("accepts ISO timestamps as well as plain dates", () => {
    expect(classifyFreshness("2026-06-23T09:00:00Z", { now: NOW }).status).toBe("FRESH");
  });
});

// --- New tests ---

test("PROVENANCE_META covers all source tiers", () => {
  const sources: ProvenanceSource[] = ["FRED", "LIVE", "DB", "FILE", "ETL", "SNAPSHOT", "ECON", "SIM", "LOADING", "ERR"];
  for (const s of sources) {
    const meta = PROVENANCE_META[s];
    expect(meta).toBeDefined();
    expect(meta.label).toBeTruthy();
    expect(typeof meta.live).toBe("boolean");
    expect(meta.tone).toBeTruthy();
    expect(meta.title).toBeTruthy();
  }
});

test("live sources are correctly classified", () => {
  const liveSources: ProvenanceSource[] = ["FRED", "LIVE", "POLY", "DB", "FILE"];
  // ETL is a frozen committed JSON snapshot (macro_data_etl, cut 2026-06-24), so it is not live.
  const offlineSources: ProvenanceSource[] = ["ETL", "SNAPSHOT", "ECON", "SIM", "LOADING", "UNAVAILABLE", "ERR"];
  for (const s of liveSources) expect(PROVENANCE_META[s].live).toBe(true);
  for (const s of offlineSources) expect(PROVENANCE_META[s].live).toBe(false);
});

test("provenanceMeta returns SIM meta for unknown sources", () => {
  const meta = provenanceMeta("UNKNOWN_GARBAGE");
  expect(meta).toEqual(PROVENANCE_META.SIM);
});

test("PROVENANCE_TONE_CLASS covers all tones", () => {
  const tones = ["live", "snapshot", "model", "etl", "loading", "error"] as const;
  for (const t of tones) {
    expect(PROVENANCE_TONE_CLASS[t]).toBeDefined();
    expect(PROVENANCE_TONE_CLASS[t].pill).toBeTruthy();
    expect(PROVENANCE_TONE_CLASS[t].dot).toBeTruthy();
  }
});

test("classifyFreshness handles future dates as FRESH", () => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const result = classifyFreshness(tomorrow);
  expect(result.status).toBe("FRESH");
});

test("classifyFreshness handles empty string as UNKNOWN", () => {
  const result = classifyFreshness("");
  expect(result.status).toBe("UNKNOWN");
});

describe("worstSource", () => {
  test("returns the lowest-tier source from a mixed array", () => {
    expect(worstSource(["FRED", "SNAPSHOT", "SIM"])).toBe("SIM");
  });

  test("returns FRED when all sources are FRED", () => {
    expect(worstSource(["FRED", "FRED", "FRED"])).toBe("FRED");
  });

  test("returns SNAPSHOT when worst is SNAPSHOT", () => {
    expect(worstSource(["FRED", "LIVE", "SNAPSHOT"])).toBe("SNAPSHOT");
  });

  test("returns SIM for empty array", () => {
    expect(worstSource([])).toBe("SIM");
  });

  test("treats unknown source strings as SIM tier", () => {
    expect(worstSource(["FRED", "GARBAGE" as any])).toBe("GARBAGE");
  });

  test("handles single-element arrays", () => {
    expect(worstSource(["FRED"])).toBe("FRED");
    expect(worstSource(["SIM"])).toBe("SIM");
  });

  test("respects full tier ordering", () => {
    expect(worstSource(["FRED", "LIVE"])).toBe("LIVE");
    expect(worstSource(["LIVE", "DB"])).toBe("DB");
    expect(worstSource(["DB", "FILE"])).toBe("FILE");
    expect(worstSource(["FILE", "ETL"])).toBe("ETL");
    expect(worstSource(["ETL", "SNAPSHOT"])).toBe("SNAPSHOT");
    expect(worstSource(["SNAPSHOT", "ECON"])).toBe("ECON");
    expect(worstSource(["ECON", "SIM"])).toBe("SIM");
  });
});

describe("resolveBadgeSource", () => {
  const off = { simEnabled: false, snapshotFallbackEnabled: false };
  test("SIM shows as ERR while global SIM mode is off", () => {
    expect(resolveBadgeSource("SIM", off)).toBe("ERR");
    expect(resolveBadgeSource("SIM", { ...off, simEnabled: true })).toBe("SIM");
  });
  test("a module's explicitly selected SIM stays SIM regardless of the global switch", () => {
    expect(resolveBadgeSource("SIM", { ...off, simSelected: true })).toBe("SIM");
  });
  test("simSelected does not affect other sources", () => {
    expect(resolveBadgeSource("SNAPSHOT", { ...off, simSelected: true })).toBe("ERR");
    expect(resolveBadgeSource("UNAVAILABLE", { ...off, simSelected: true })).toBe("UNAVAILABLE");
    expect(resolveBadgeSource("DB", off)).toBe("DB");
  });
});
