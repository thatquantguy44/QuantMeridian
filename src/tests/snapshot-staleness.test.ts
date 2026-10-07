import fs from "node:fs";
import path from "node:path";
import { describe, test, expect } from "vitest";

/**
 * The Gold DB migration (Phase 5-6) deleted the market and econ snapshot fixtures
 * (market_snapshot.json, econSnapshot.json) and emptied bilello's daily prices; those values now
 * come from the database. What is still committed under src/data/market is a set of view
 * snapshots, and the invariant worth keeping is that each one says when it was cut.
 */
const DIR = path.resolve(__dirname, "../data/market");
const load = (file: string) => JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));

// eda.json (cross-correlation tables) and inflation.json (cards) carry no top-level as-of.
const UNDATED = new Set(["eda.json", "inflation.json"]);
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();

describe("snapshot staleness", () => {
  test("committed view snapshots exist", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files.filter((f) => !UNDATED.has(f)))("%s has an asof date", (file) => {
    const snap = load(file);
    expect(typeof snap.asof).toBe("string");
    expect(snap.asof).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  test("no snapshot is dated in the future", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const file of files) {
      const asof = load(file).asof;
      if (typeof asof === "string") expect(asof.slice(0, 10) <= today, `${file} asof ${asof}`).toBe(true);
    }
  });

  test("bilello snapshot has asset_class_returns_by_year", () => {
    const snap = load("bilello.json");
    expect(Array.isArray(snap.asset_class_returns_by_year)).toBe(true);
    expect(snap.asset_class_returns_by_year.length).toBeGreaterThan(100);
  });

  test("bilello daily prices are optional legacy data (emptied by the Gold migration)", () => {
    const snap = load("bilello.json");
    expect(Array.isArray(snap.asset_daily_prices)).toBe(true);
  });

  test("the deleted fixtures stay deleted", () => {
    expect(fs.existsSync(path.join(DIR, "market_snapshot.json"))).toBe(false);
    expect(fs.existsSync(path.resolve(__dirname, "../data/econSnapshot.json"))).toBe(false);
  });
});
