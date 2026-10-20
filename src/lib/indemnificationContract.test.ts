// INDEM wire contract (spec020 IND-T03). The JSON Schemas in contracts/indemnification/ are the source of
// truth. The field maps below are typed `Fields<T>`, so `tsc` fails if one omits or invents a key of the
// TypeScript type; this test fails if those keys differ from the schema. The fixtures and hash vectors are
// shared with the Python service (IND-T13).
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, test } from "vitest";
import { COUNTERPARTIES } from "@/data/universe";
import {
  profileHash, snapshotHash, snapshotIssues,
  type BorrowerRecord, type CloseoutProfile, type CloseoutSettings, type CollateralHoldingRecord,
  type IndemnificationSnapshot, type LoanRecord, type ModelSettings, type PositionOverride,
  type RunSettings, type SecurityRecord,
} from "./indemnificationContract";

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../contracts/indemnification/${path}`, import.meta.url), "utf-8"));
const SNAPSHOT_SCHEMA = read("snapshot-1.0.schema.json");
const RESULT_SCHEMA = read("result-1.0.schema.json");
const CARD_SCHEMA = read("model-card-1.0.schema.json");
const PROFILE_SCHEMA = read("closeout-profile-1.0.schema.json");
const DEFAULT_PROFILE: CloseoutProfile = read("closeout-profile.default.json");
const SNAPSHOT: IndemnificationSnapshot = read("fixtures/snapshot.example.json");
const RESULT = read("fixtures/result.example.json");
const VECTORS = read("fixtures/hash-vectors.json");

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
type Fields<T> = { [K in keyof Required<T>]: true };
const keys = (fields: object) => Object.keys(fields).sort();
const schemaKeys = (definition: { properties: object }) => Object.keys(definition.properties).sort();

const SETTINGS: Fields<CloseoutSettings> = {
  mpor_liquid_days: true, mpor_other_days: true, mpor_concentrated_days: true, mpor_pool_forced_sale_days: true,
  mpor_fixed_days: true, addon_days: true, concentration_threshold_pct_adv: true, htb_uses_concentrated_period: true,
  impact_k: true, impact_alpha: true, half_spread_floor_bps: true, cost_cap_bps: true, stress_beta: true,
  stress_factor: true, unwind: true, margin_call_every_days: true,
};
const POSITION_OVERRIDE: Fields<PositionOverride> = { ...SETTINGS, adv_units: true, daily_vol: true };
const RUN: Fields<RunSettings> = { mode: true, seed: true, paths: true, preview: true, horizon_days: true, step: true };
const MODEL: Fields<ModelSettings> = { rho_d: true, rho_w: true, student_t_enabled: true, student_t_nu: true, default_recovery: true };
const SECURITY: Fields<SecurityRecord> = {
  id: true, label: true, asset_class: true, liquidity_class: true, hard_to_borrow: true, currency: true, price: true,
  adv_units: true, daily_vol: true, equity_beta: true, rate_duration: true, spread_duration: true,
};
const BORROWER: Fields<BorrowerRecord> = { id: true, name: true, rating: true, spread_bps: true, recovery: true, credit_provenance: true };
const LOAN: Fields<LoanRecord> = {
  id: true, borrower_id: true, owner_id: true, security_id: true, quantity: true, rate_bps: true, collateral_type: true,
  margin_pct: true, term: true, maturity_days: true, recallable: true, provenance: true,
};
const COLLATERAL: Fields<CollateralHoldingRecord> = { id: true, borrower_id: true, kind: true, security_id: true, quantity: true, cash_amount: true, provenance: true };
const SNAPSHOT_FIELDS: Fields<IndemnificationSnapshot> = {
  api_schema_version: true, snapshot_hash: true, as_of: true, source: true, currency: true, run: true, model: true,
  pricing: true, closeout_profile: true, securities: true, borrowers: true, owners: true, loans: true, collateral: true, pool: true,
};

let ajv: Ajv2020;
beforeAll(() => {
  ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  for (const schema of [PROFILE_SCHEMA, CARD_SCHEMA, SNAPSHOT_SCHEMA, RESULT_SCHEMA]) ajv.addSchema(schema);
});
const validator = (schema: { $id: string }) => ajv.getSchema(schema.$id)!;
const errors = (schema: { $id: string }, value: unknown) => {
  const validate = validator(schema);
  return validate(value) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
};

describe("schemas and fixtures", () => {
  test("every schema compiles under strict mode", () => {
    for (const schema of [PROFILE_SCHEMA, CARD_SCHEMA, SNAPSHOT_SCHEMA, RESULT_SCHEMA]) expect(validator(schema), schema.$id).toBeTypeOf("function");
  });

  test("the snapshot, result and default profile fixtures are valid", () => {
    expect(errors(SNAPSHOT_SCHEMA, SNAPSHOT)).toEqual([]);
    expect(errors(RESULT_SCHEMA, RESULT)).toEqual([]);
    expect(errors(PROFILE_SCHEMA, DEFAULT_PROFILE)).toEqual([]);
    expect(errors(CARD_SCHEMA, RESULT.model_card)).toEqual([]);
  });

  test("the snapshot fixture is internally consistent and uses only fictional counterparties", () => {
    expect(snapshotIssues(SNAPSHOT)).toEqual([]);
    const fictional = new Set(COUNTERPARTIES.map((c) => c.name));
    for (const b of SNAPSHOT.borrowers) expect(fictional.has(b.name), b.name).toBe(true);
    for (const o of SNAPSHOT.owners) expect(fictional.has(o.name), o.name).toBe(true);
    expect(SNAPSHOT.source.label).toBe("SIM");
  });

  test("the fixture's collateral and pool reconcile to its loans", () => {
    const price = new Map(SNAPSHOT.securities.map((s) => [s.id, s.price]));
    const required = SNAPSHOT.loans.reduce((a, l) => a + l.quantity * price.get(l.security_id)! * (l.margin_pct / 100), 0);
    const held = SNAPSHOT.collateral.reduce((a, c) => a + (c.kind === "CASH" ? c.cash_amount! : c.quantity! * price.get(c.security_id!)!), 0);
    expect(held).toBeCloseTo(required, 6);
    const cash = SNAPSHOT.collateral.filter((c) => c.kind === "CASH").reduce((a, c) => a + c.cash_amount!, 0);
    expect(SNAPSHOT.pool.positions.reduce((a, p) => a + p.allocation, 0)).toBeCloseTo(cash, 6);
  });

  test("the result repeats the snapshot's hash and run settings", () => {
    expect(RESULT.snapshot_hash).toBe(SNAPSHOT.snapshot_hash);
    expect(RESULT.run).toEqual(SNAPSHOT.run);
    expect(RESULT.model_card.snapshot_hash).toBe(SNAPSHOT.snapshot_hash);
  });
});

describe("TypeScript types match the schemas", () => {
  test("record types have exactly the schema's fields", () => {
    expect(keys(SETTINGS)).toEqual(schemaKeys(PROFILE_SCHEMA.$defs.Settings));
    expect(keys(SETTINGS)).toEqual(schemaKeys(PROFILE_SCHEMA.$defs.SettingsOverride));
    expect(keys(POSITION_OVERRIDE)).toEqual(schemaKeys(PROFILE_SCHEMA.$defs.PositionOverride));
    expect(keys(RUN)).toEqual(schemaKeys(SNAPSHOT_SCHEMA.$defs.Run));
    expect(keys(MODEL)).toEqual(schemaKeys(SNAPSHOT_SCHEMA.$defs.Model));
    expect(keys(SECURITY)).toEqual(schemaKeys(SNAPSHOT_SCHEMA.$defs.Security));
    expect(keys(BORROWER)).toEqual(schemaKeys(SNAPSHOT_SCHEMA.$defs.Borrower));
    expect(keys(LOAN)).toEqual(schemaKeys(SNAPSHOT_SCHEMA.$defs.Loan));
    expect(keys(COLLATERAL)).toEqual(schemaKeys(SNAPSHOT_SCHEMA.$defs.CollateralHolding));
    expect(keys(SNAPSHOT_FIELDS)).toEqual(schemaKeys(SNAPSHOT_SCHEMA));
  });
});

describe("hashes", () => {
  test("the snapshot fixture reproduces the shared vector", async () => {
    expect(VECTORS.snapshot.hash).toBe(SNAPSHOT.snapshot_hash);
    expect(await snapshotHash(SNAPSHOT)).toBe(VECTORS.snapshot.hash);
  });

  test("record order does not change the snapshot hash, but a value does", async () => {
    const shuffled = clone(SNAPSHOT);
    shuffled.loans.reverse();
    shuffled.borrowers.reverse();
    shuffled.pool.positions.reverse();
    shuffled.pool.owner_shares.reverse();
    expect(await snapshotHash(shuffled)).toBe(SNAPSHOT.snapshot_hash);
    const changed = clone(SNAPSHOT);
    changed.loans[0].quantity += 1;
    expect(await snapshotHash(changed)).not.toBe(SNAPSHOT.snapshot_hash);
    const reseeded = clone(SNAPSHOT);
    reseeded.run.seed += 1;
    expect(await snapshotHash(reseeded)).not.toBe(SNAPSHOT.snapshot_hash);
  });

  test("profiles reproduce the shared vectors", async () => {
    expect(await profileHash(DEFAULT_PROFILE)).toBe(VECTORS.profiles[0].hash);
    expect(await profileHash(SNAPSHOT.closeout_profile)).toBe(VECTORS.profiles[1].hash);
    expect(VECTORS.profiles[0].hash).not.toBe(VECTORS.profiles[1].hash);
  });
});

describe("close-out profile", () => {
  test("the default profile holds the decision 4 values, with every extra setting neutral", () => {
    expect(DEFAULT_PROFILE.defaults).toEqual({
      mpor_liquid_days: 5, mpor_other_days: 10, mpor_concentrated_days: 10, mpor_pool_forced_sale_days: 5,
      mpor_fixed_days: null, addon_days: 0, concentration_threshold_pct_adv: 25, htb_uses_concentrated_period: true,
      impact_k: 0.5, impact_alpha: 0.5, half_spread_floor_bps: 0, cost_cap_bps: null,
      stress_beta: 0, stress_factor: "equity", unwind: "end_of_period", margin_call_every_days: 1,
    });
    for (const level of [DEFAULT_PROFILE.asset_class_overrides, DEFAULT_PROFILE.pool_bucket_overrides, DEFAULT_PROFILE.borrower_overrides, DEFAULT_PROFILE.position_overrides]) {
      expect(level).toEqual({});
    }
  });

  const bad = (name: string, mutate: (p: CloseoutProfile) => void) =>
    test(`the schema rejects ${name}`, () => {
      const profile = clone(DEFAULT_PROFILE);
      mutate(profile);
      expect(errors(PROFILE_SCHEMA, profile).length, name).toBeGreaterThan(0);
    });
  bad("a close-out period of zero", (p) => { p.defaults.mpor_liquid_days = 0; });
  bad("a close-out period above 60", (p) => { p.defaults.mpor_other_days = 61; });
  bad("a fractional close-out period", (p) => { p.defaults.mpor_liquid_days = 2.5; });
  bad("an impact exponent of zero", (p) => { p.defaults.impact_alpha = 0; });
  bad("an impact exponent above one", (p) => { p.defaults.impact_alpha = 1.5; });
  bad("a negative impact coefficient", (p) => { p.defaults.impact_k = -0.1; });
  bad("margin calls less often than every 20 days", (p) => { p.defaults.margin_call_every_days = 21; });
  bad("an unknown unwind style", (p) => { (p.defaults as unknown as Record<string, unknown>).unwind = "sideways"; });
  bad("an unknown setting in defaults", (p) => { (p.defaults as unknown as Record<string, unknown>).impact_kappa = 1; });
  bad("an unknown setting in an override", (p) => { (p.borrower_overrides as Record<string, unknown>).B1 = { not_a_setting: 1 }; });
  bad("an empty override", (p) => { p.borrower_overrides.B1 = {}; });
  bad("adv_units on a non-position override", (p) => { (p.borrower_overrides as Record<string, unknown>).B1 = { adv_units: 10 }; });
  bad("a missing default setting", (p) => { delete (p.defaults as Partial<CloseoutSettings>).addon_days; });

  test("a position override may carry adv_units and daily_vol", () => {
    const profile = clone(DEFAULT_PROFILE);
    profile.position_overrides.L1 = { adv_units: 1000, daily_vol: 0.02, impact_k: 0.8 };
    expect(errors(PROFILE_SCHEMA, profile)).toEqual([]);
  });
});

describe("snapshot validation", () => {
  const bad = (name: string, mutate: (s: IndemnificationSnapshot) => void) =>
    test(`the schema rejects ${name}`, () => {
      const snapshot = clone(SNAPSHOT);
      mutate(snapshot);
      expect(errors(SNAPSHOT_SCHEMA, snapshot).length, name).toBeGreaterThan(0);
    });
  bad("fewer than 1,000 paths", (s) => { s.run.paths = 999; });
  bad("more than 500,000 paths", (s) => { s.run.paths = 500001; });
  bad("a horizon under one month", (s) => { s.run.horizon_days = 20; });
  bad("a horizon over five years", (s) => { s.run.horizon_days = 1261; });
  bad("an unknown step", (s) => { (s.run as unknown as Record<string, unknown>).step = "hourly"; });
  bad("a malformed snapshot hash", (s) => { s.snapshot_hash = "abc"; });
  bad("an unknown top-level field", (s) => { (s as unknown as Record<string, unknown>).extra = 1; });
  bad("a term loan with no maturity", (s) => { s.loans[1].maturity_days = null; });
  bad("an open loan with a maturity", (s) => { s.loans[0].maturity_days = 30; });
  bad("a margin below 100%", (s) => { s.loans[0].margin_pct = 99; });
  bad("cash collateral that names a security", (s) => { s.collateral[0].security_id = "UST1"; });
  bad("security collateral with no quantity", (s) => { s.collateral[1].quantity = null; });
  bad("a recovery of 100%", (s) => { s.model.default_recovery = 1; });
  bad("a Student-t with fewer than 3 degrees of freedom", (s) => { s.model.student_t_nu = 2; });
  bad("an unknown rating", (s) => { (s.borrowers[0] as unknown as Record<string, unknown>).rating = "AAAA"; });

  const issue = (name: string, mutate: (s: IndemnificationSnapshot) => void, expected: RegExp) =>
    test(`snapshotIssues reports ${name}`, () => {
      const snapshot = clone(SNAPSHOT);
      mutate(snapshot);
      expect(snapshotIssues(snapshot).some((m) => expected.test(m)), snapshotIssues(snapshot).join("; ")).toBe(true);
    });
  issue("rho_w squared above rho_d", (s) => { s.model.rho_w = 0.6; }, /rho_w\^2/);
  issue("a duplicate loan id", (s) => { s.loans[1].id = "L1"; }, /duplicate loan id L1/);
  issue("a loan with an unknown borrower", (s) => { s.loans[0].borrower_id = "B9"; }, /unknown borrower B9/);
  issue("a loan with an unknown owner", (s) => { s.loans[0].owner_id = "O9"; }, /unknown owner O9/);
  issue("a loan with an unknown security", (s) => { s.loans[0].security_id = "XX"; }, /unknown security XX/);
  issue("collateral with an unknown security", (s) => { s.collateral[1].security_id = "XX"; }, /unknown security XX/);
  issue("pool shares that do not sum to one", (s) => { s.pool.owner_shares[0].share = 0.5; }, /sum to 0\.9/);
  issue("a pool share for an unknown owner", (s) => { s.pool.owner_shares[0].owner_id = "O9"; }, /unknown owner O9/);
  issue("a position override for an unknown position", (s) => { s.closeout_profile.position_overrides.L9 = { impact_k: 1 }; }, /unknown position L9/);
  issue("a borrower override for an unknown borrower", (s) => { s.closeout_profile.borrower_overrides.B9 = { addon_days: 1 }; }, /unknown borrower B9/);
  issue("an unknown pool bucket override", (s) => { s.closeout_profile.pool_bucket_overrides.NOPE = { impact_k: 1 }; }, /unknown bucket NOPE/);
  issue("an unknown asset class override", (s) => { s.closeout_profile.asset_class_overrides.NOPE = { impact_k: 1 }; }, /unknown asset class NOPE/);
  issue("a cost cap below the floor", (s) => { s.closeout_profile.defaults.half_spread_floor_bps = 20; s.closeout_profile.defaults.cost_cap_bps = 10; }, /cost_cap_bps \(10\) is below/);

  test("a valid asset class override and pool bucket override are accepted", () => {
    const snapshot = clone(SNAPSHOT);
    snapshot.closeout_profile.asset_class_overrides.EQUITY = { impact_k: 0.7 };
    snapshot.closeout_profile.pool_bucket_overrides.TERM = { mpor_pool_forced_sale_days: 8 };
    expect(snapshotIssues(snapshot)).toEqual([]);
    expect(errors(SNAPSHOT_SCHEMA, snapshot)).toEqual([]);
  });
});

describe("result validation", () => {
  test("the schema rejects a result with a missing channel and one with an unknown stress id", () => {
    const missing = clone(RESULT);
    delete missing.program.gaussian.with_wrong_way.total.el.std_error;
    expect(errors(RESULT_SCHEMA, missing).length).toBeGreaterThan(0);
    const stress = clone(RESULT);
    stress.stresses[0].id = "meteor";
    expect(errors(RESULT_SCHEMA, stress).length).toBeGreaterThan(0);
  });

  test("a result may omit the Student-t block only as null", () => {
    const result = clone(RESULT);
    result.program.student_t = null;
    expect(errors(RESULT_SCHEMA, result)).toEqual([]);
    delete result.program.student_t;
    expect(errors(RESULT_SCHEMA, result).length).toBeGreaterThan(0);
  });
});
