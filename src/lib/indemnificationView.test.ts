import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, test } from "vitest";
import type { IndemnificationResult } from "./indemnificationApi";
import type { CloseoutProfile } from "./indemnificationContract";
import {
  OVERRIDE_LEVELS, SETTING_SPECS, borrowerRows, channelsFor, diffProfiles, fmtBps, fmtMetric, fmtMoney, fmtPct,
  peakOf, shortId, sortBorrowers, stressTotals, tailIsEmpty, validateSetting, wrongWayUplift,
} from "./indemnificationView";

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../contracts/indemnification/${path}`, import.meta.url), "utf-8"));
const RESULT: IndemnificationResult = read("fixtures/result.example.json");
const PROFILE_SCHEMA = read("closeout-profile-1.0.schema.json");
const DEFAULT_PROFILE: CloseoutProfile = read("closeout-profile.default.json");
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

describe("formatting", () => {
  test("money is compact with sign, and honest about non-numbers", () => {
    expect(fmtMoney(0)).toBe("$0");
    expect(fmtMoney(999)).toBe("$999");
    expect(fmtMoney(1234)).toBe("$1.2K");
    expect(fmtMoney(3_696_000)).toBe("$3.70M");
    expect(fmtMoney(6.458e9)).toBe("$6.46B");
    expect(fmtMoney(-2500)).toBe("-$2.5K");
    expect(fmtMoney(Number.NaN)).toBe("n/a");
  });
  test("basis points and percentages", () => {
    expect(fmtBps(0.16)).toBe("0.16 bp");
    expect(fmtPct(0.0006)).toBe("0.06%");
    expect(fmtPct(0.000001)).toBe("<0.01%");
    expect(fmtPct(0)).toBe("0.00%");
    expect(fmtPct(0.25, 0)).toBe("25%");
  });
  test("a metric shows its standard error or says it is missing", () => {
    expect(fmtMetric({ value: 1500, std_error: 100 })).toBe("$1.5K ± $100");
    expect(fmtMetric({ value: 1500, std_error: null })).toBe("$1.5K (SE n/a)");
    expect(fmtMetric({ value: 0.5, std_error: 0.1 }, fmtBps)).toBe("0.50 bp ± 0.10 bp");
  });
  test("ids are shortened only when long", () => {
    expect(shortId("abcdef0123456789")).toBe("abcdef01…");
    expect(shortId("B1")).toBe("B1");
  });
});

describe("results", () => {
  test("variants map to the right channels", () => {
    expect(channelsFor(RESULT.program, "with_wrong_way")).toBe(RESULT.program.gaussian.with_wrong_way);
    expect(channelsFor(RESULT.program, "without_wrong_way")).toBe(RESULT.program.gaussian.without_wrong_way);
    expect(channelsFor(RESULT.program, "student_t")).toBe(RESULT.program.student_t);
    expect(channelsFor({ ...RESULT.program, student_t: null }, "student_t")).toBeNull();
  });
  test("the wrong-way uplift is on over off minus one, and null when off is zero", () => {
    const on = RESULT.program.gaussian.with_wrong_way.total.el.value;
    const off = RESULT.program.gaussian.without_wrong_way.total.el.value;
    expect(wrongWayUplift(RESULT.program)).toBeCloseTo(on / off - 1, 12);
    const zero = clone(RESULT.program);
    zero.gaussian.without_wrong_way.total.el.value = 0;
    expect(wrongWayUplift(zero)).toBeNull();
  });
  test("an empty tail is recognised", () => {
    const channels = clone(RESULT.program.gaussian.with_wrong_way);
    expect(tailIsEmpty(channels)).toBe(false);
    for (const k of ["var99", "var999", "es99", "es999"] as const) channels.default_shortfall[k].value = 0;
    expect(tailIsEmpty(channels)).toBe(true);
  });
  test("peak of an empty series is zero", () => {
    expect(peakOf([])).toBe(0);
    expect(peakOf([1, 5, 3])).toBe(5);
  });

  const names = { B1: { name: "Alderwood Capital", rating: "A" }, B2: { name: "Harrowgate Partners", rating: "BBB" } };
  test("borrower rows join the result, the cross-check and the names", () => {
    const rows = borrowerRows(RESULT, names);
    expect(rows.map((r) => r.id)).toEqual(["B1", "B2"]);
    const b2 = rows[1];
    expect(b2).toMatchObject({ name: "Harrowgate Partners", rating: "BBB", creditSource: "USER_SPREAD", eStar: 180000, flagged: true });
    expect(b2.costBps).toBe(RESULT.borrowers[1].pricing!.indemnification_cost_bps);
    expect(borrowerRows(RESULT, {})[0].name).toBe("B1");                        // falls back to the id
  });
  test("a borrower without pricing has nulls, not zeros", () => {
    const unpriced = clone(RESULT);
    unpriced.borrowers[0].pricing = null;
    const row = borrowerRows(unpriced, names)[0];
    expect([row.feeBps, row.costBps, row.flagged]).toEqual([null, null, null]);
  });
  test("sorting is stable, either way, and puts unknowns last when descending by cost", () => {
    const unpriced = clone(RESULT);
    unpriced.borrowers[0].pricing = null;
    const rows = borrowerRows(unpriced, names);
    expect(sortBorrowers(rows, "cost", "desc").map((r) => r.id)).toEqual(["B2", "B1"]);
    expect(sortBorrowers(rows, "cost", "asc").map((r) => r.id)).toEqual(["B1", "B2"]);
    expect(sortBorrowers(rows, "borrower", "asc").map((r) => r.id)).toEqual(["B1", "B2"]);
    expect(sortBorrowers(rows, "borrower", "desc").map((r) => r.id)).toEqual(["B2", "B1"]);
    expect(sortBorrowers(rows, "pd", "desc")[0].pd).toBeGreaterThanOrEqual(sortBorrowers(rows, "pd", "desc")[1].pd);
    expect(rows.map((r) => r.id)).toEqual(["B1", "B2"]);                        // the input is not mutated
  });
  test("stress totals add the borrowers and name the worst", () => {
    const [stress] = stressTotals(RESULT.stresses);
    expect(stress.defaultShortfall).toBe(0);
    expect(stress.reinvestment).toBe(70000);
    expect(stress.worstBorrower).toEqual({ id: "B1", loss: 50000 });
    const flat = stressTotals([{ ...RESULT.stresses[0], by_borrower: [{ borrower_id: "B1", default_shortfall: 0, reinvestment: 0 }] }]);
    expect(flat[0].worstBorrower).toBeNull();
  });
});

describe("close-out setting specs", () => {
  test("cover exactly the schema's settings", () => {
    expect(SETTING_SPECS.map((s) => s.key).sort()).toEqual(Object.keys(PROFILE_SCHEMA.$defs.Settings.properties).sort());
  });

  test("agree with the JSON Schema on boundary and wrong-type values", () => {
    const ajv = new Ajv2020({ strict: true });
    const validate = ajv.compile({ ...PROFILE_SCHEMA, $id: "urn:test:profile" });
    const candidates: unknown[] = [
      null, true, false, "equity", "even", "end_of_period", "bogus", "", -1, 0, 0.5, 1, 1.5, 2, 5, 19, 20, 21, 25, 40, 41, 60, 61, 1000, 1001, 1e9, Number.NaN,
    ];
    for (const spec of SETTING_SPECS) {
      const values = [...candidates, ...(spec.options ?? [])];
      if (spec.min !== undefined) values.push(spec.min - 1, spec.min, spec.min + 0.5, spec.min + 1);
      if (spec.max !== undefined) values.push(spec.max - 1, spec.max, spec.max + 0.5, spec.max + 1);
      for (const value of values) {
        const profile = clone(DEFAULT_PROFILE) as unknown as Record<string, Record<string, unknown>>;
        profile.defaults[spec.key] = Number.isNaN(value) ? null : value;
        const accepted = validate(profile) as boolean;
        const mine = validateSetting(spec, Number.isNaN(value as number) ? Number.NaN : value);
        if (Number.isNaN(value)) { expect(mine, `${spec.key} NaN`).not.toBeNull(); continue; }
        expect(mine === null, `${spec.key} = ${JSON.stringify(value)}: schema ${accepted ? "accepts" : "rejects"}`).toBe(accepted);
      }
    }
  });

  test("the default profile passes every spec", () => {
    for (const spec of SETTING_SPECS) expect(validateSetting(spec, DEFAULT_PROFILE.defaults[spec.key]), spec.key).toBeNull();
  });
  test("messages name the setting and the problem", () => {
    const alpha = SETTING_SPECS.find((s) => s.key === "impact_alpha")!;
    expect(validateSetting(alpha, 0)).toMatch(/Impact exponent.*above 0/);
    expect(validateSetting(alpha, 1.2)).toMatch(/at most 1/);
    const days = SETTING_SPECS.find((s) => s.key === "mpor_liquid_days")!;
    expect(validateSetting(days, 2.5)).toMatch(/whole number/);
    expect(validateSetting(days, null)).toMatch(/must be set/);
  });
});

describe("profile diff", () => {
  test("identical profiles have no differences", () => {
    expect(diffProfiles(clone(DEFAULT_PROFILE), DEFAULT_PROFILE)).toEqual([]);
  });
  test("lists changed defaults and added, changed and removed overrides", () => {
    const edited = clone(DEFAULT_PROFILE);
    edited.defaults.impact_k = 0.9;
    edited.borrower_overrides.B1 = { addon_days: 2 };
    edited.position_overrides.L1 = { adv_units: 5000, impact_k: 0.1 };
    const changes = diffProfiles(edited, DEFAULT_PROFILE);
    expect(changes).toContainEqual({ level: "defaults", target: null, setting: "impact_k", from: 0.5, to: 0.9 });
    expect(changes).toContainEqual({ level: "borrower_overrides", target: "B1", setting: "addon_days", from: null, to: 2 });
    expect(changes).toContainEqual({ level: "position_overrides", target: "L1", setting: "adv_units", from: null, to: 5000 });
    expect(changes).toHaveLength(4);
    const removed = diffProfiles(DEFAULT_PROFILE, edited);
    expect(removed).toContainEqual({ level: "borrower_overrides", target: "B1", setting: "addon_days", from: 2, to: null });
  });
  test("knows the four override levels", () => {
    expect(OVERRIDE_LEVELS.map((l) => l.key)).toEqual(["asset_class_overrides", "pool_bucket_overrides", "borrower_overrides", "position_overrides"]);
  });
});
