import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { CloseoutProfile } from "./indemnificationContract";
import { STORAGE_KEY, deleteProfile, exportProfile, listProfiles, parseProfile, profileIssues, saveProfile } from "./indemnificationProfiles";

const DEFAULT: CloseoutProfile = JSON.parse(readFileSync(new URL("../../contracts/indemnification/closeout-profile.default.json", import.meta.url), "utf-8"));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  constructor(private readonly broken = false) {}
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { if (this.broken) throw new Error("blocked"); return this.data.get(key) ?? null; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { if (this.broken) throw new Error("full"); this.data.set(key, value); }
}
const named = (name: string, change?: (p: CloseoutProfile) => void) => { const p = clone(DEFAULT); p.name = name; change?.(p); return p; };

describe("profile validation", () => {
  test("the shipped default is valid and a copy with overrides is too", () => {
    expect(profileIssues(DEFAULT)).toEqual([]);
    const p = named("mine", (x) => { x.borrower_overrides.B1 = { addon_days: 2 }; x.position_overrides.L1 = { adv_units: 5000, impact_k: 0.2 }; });
    expect(profileIssues(p)).toEqual([]);
  });
  const bad = (what: string, mutate: (p: Record<string, any>) => void, expected: RegExp) =>
    test(`reports ${what}`, () => {
      const p = clone(DEFAULT) as unknown as Record<string, any>;
      mutate(p);
      expect(profileIssues(p).join("; ")).toMatch(expected);
    });
  bad("a missing default", (p) => { delete p.defaults.addon_days; }, /defaults\.addon_days is missing/);
  bad("an out-of-range default", (p) => { p.defaults.impact_alpha = 0; }, /Impact exponent/);
  bad("an unknown default", (p) => { p.defaults.nope = 1; }, /defaults\.nope is not a setting/);
  bad("an empty override", (p) => { p.borrower_overrides.B1 = {}; }, /must set at least one setting/);
  bad("an unknown override setting", (p) => { p.borrower_overrides.B1 = { nope: 1 }; }, /nope is not a setting/);
  bad("adv_units outside a position override", (p) => { p.borrower_overrides.B1 = { adv_units: 5 }; }, /adv_units is not a setting/);
  bad("a non-positive adv_units", (p) => { p.position_overrides.L1 = { adv_units: 0 }; }, /positive number/);
  bad("a wrong version", (p) => { p.profile_schema_version = "2.0"; }, /profile_schema_version/);
  bad("an empty name", (p) => { p.name = " "; }, /name must be/);
  bad("an extra field", (p) => { p.extra = true; }, /extra is not a profile field/);
  test("rejects non-objects", () => { expect(profileIssues([1])).toEqual(["a profile must be a JSON object"]); expect(profileIssues(null)).toHaveLength(1); });
});

describe("import and export", () => {
  test("a profile survives export then import", () => {
    const p = named("round-trip", (x) => { x.defaults.mpor_fixed_days = 7; x.defaults.cost_cap_bps = 50; });
    const parsed = parseProfile(exportProfile(p));
    expect(parsed.ok && parsed.profile).toEqual(p);
  });
  test("bad text is refused with reasons", () => {
    expect(parseProfile("{nope")).toEqual({ ok: false, issues: ["that is not valid JSON"] });
    const out = parseProfile(JSON.stringify({ ...DEFAULT, defaults: { ...DEFAULT.defaults, mpor_liquid_days: 99 } }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.issues.join(" ")).toMatch(/at most 60/);
  });
});

describe("saved profiles", () => {
  test("save, list, replace by name, and delete", () => {
    const store = new MemoryStorage();
    expect(listProfiles(store)).toEqual([]);
    expect(saveProfile(named("a"), () => "t1", store)).toBe(true);
    expect(saveProfile(named("b"), () => "t2", store)).toBe(true);
    expect(saveProfile(named("a", (p) => { p.defaults.impact_k = 0.9; }), () => "t3", store)).toBe(true);
    const saved = listProfiles(store);
    expect(saved.map((s) => s.name).sort()).toEqual(["a", "b"]);
    expect(saved.find((s) => s.name === "a")).toMatchObject({ saved_at: "t3", profile: { defaults: { impact_k: 0.9 } } });
    expect(deleteProfile("a", store)).toBe(true);
    expect(listProfiles(store).map((s) => s.name)).toEqual(["b"]);
  });
  test("refuses to save an invalid profile", () => {
    const store = new MemoryStorage();
    expect(saveProfile(named("bad", (p) => { p.defaults.impact_alpha = 5; }), () => "t", store)).toBe(false);
    expect(listProfiles(store)).toEqual([]);
  });
  test("ignores corrupt entries and survives blocked or missing storage", () => {
    const store = new MemoryStorage();
    store.setItem(STORAGE_KEY, JSON.stringify([{ name: "x", saved_at: "t", profile: { nope: 1 } }, { junk: true }, { name: "ok", saved_at: "t", profile: named("ok") }]));
    expect(listProfiles(store).map((s) => s.name)).toEqual(["ok"]);
    store.setItem(STORAGE_KEY, "not json");
    expect(listProfiles(store)).toEqual([]);
    const broken = new MemoryStorage(true);
    expect(listProfiles(broken)).toEqual([]);
    expect(saveProfile(named("a"), () => "t", broken)).toBe(false);
    expect(deleteProfile("a", broken)).toBe(false);
    expect(listProfiles(null)).toEqual([]);
    expect(saveProfile(named("a"), () => "t", null)).toBe(false);
  });
});
