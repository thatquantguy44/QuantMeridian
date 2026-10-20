import { describe, expect, test } from "vitest";
import { snapshotSchemaIssues } from "./indemnificationApi";
import { ComposeError, DEFAULT_RUN_OPTIONS, composeRunRequest } from "./indemnificationCompose";
import { snapshotHash } from "./indemnificationContract";
import DEFAULT_PROFILE from "../../contracts/indemnification/closeout-profile.default.json";

const today = () => "2026-10-20";

describe("composeRunRequest", () => {
  test("defaults give a valid desk request on the SIM book with the standard options", async () => {
    const request = await composeRunRequest({}, today);
    expect(request.api_schema_version).toBe("1.0");
    expect(request.snapshot.as_of).toBe("2026-10-20");
    expect(request.snapshot.source.label).toBe("SIM");
    expect(request.snapshot.run).toMatchObject({ mode: "desk", paths: 50000, horizon_days: 21, step: "daily" });
    expect(request.options).toEqual(DEFAULT_RUN_OPTIONS);
    expect(snapshotSchemaIssues(request.snapshot)).toEqual([]);
    expect(await snapshotHash(request.snapshot)).toBe(request.snapshot.snapshot_hash);
  });

  test("is deterministic for the same input and changes when a choice changes", async () => {
    const a = await composeRunRequest({ run: { seed: 7 } }, today);
    const b = await composeRunRequest({ run: { seed: 7 } }, today);
    const c = await composeRunRequest({ run: { seed: 8 } }, today);
    expect(a.snapshot.snapshot_hash).toBe(b.snapshot.snapshot_hash);
    expect(a.snapshot.snapshot_hash).not.toBe(c.snapshot.snapshot_hash);
  });

  test("applies run, model, pricing, profile and credit choices", async () => {
    const profile = JSON.parse(JSON.stringify(DEFAULT_PROFILE));
    profile.name = "stressed";
    profile.defaults.impact_k = 0.9;
    const base = await composeRunRequest({}, today);
    const id = base.snapshot.borrowers[0].id;
    const request = await composeRunRequest({
      run: { mode: "annual", horizon_days: 252, step: "weekly", paths: 5000, preview: true },
      model: { rho_w: 0.2 },
      pricing: { cost_of_capital: 0.12 },
      profile,
      borrower_credit: { [id]: { spread_bps: 300, recovery: 0.3 } },
      options: { sensitivity_paths: null, stresses: false },
    }, today);
    expect(request.snapshot.run).toMatchObject({ mode: "annual", horizon_days: 252, step: "weekly", paths: 5000, preview: true });
    expect(request.snapshot.model.rho_w).toBe(0.2);
    expect(request.snapshot.model.rho_d).toBe(0.25);
    expect(request.snapshot.pricing.cost_of_capital).toBe(0.12);
    expect(request.snapshot.closeout_profile.name).toBe("stressed");
    expect(request.snapshot.borrowers.find((b) => b.id === id)).toMatchObject({ spread_bps: 300, recovery: 0.3, credit_provenance: "user_input" });
    expect(request.options).toEqual({ sensitivity_paths: null, stresses: false, stress_profile_overrides: null });
  });

  const rejects = async (name: string, input: unknown, expected: RegExp) => {
    test(`rejects ${name} with the reasons`, async () => {
      const error = await composeRunRequest(input as never, today).then(() => null, (e) => e);
      expect(error, name).toBeInstanceOf(ComposeError);
      expect((error as ComposeError).issues.join("; ")).toMatch(expected);
    });
  };
  rejects("a wrong-way correlation too large for the borrower correlation", { model: { rho_w: 0.9 } }, /rho_w\^2/);
  rejects("fewer than 1000 paths", { run: { paths: 5 } }, /paths/);
  rejects("a horizon over five years", { run: { horizon_days: 5000 } }, /horizon_days/);
  rejects("an out-of-range close-out setting", { profile: { ...DEFAULT_PROFILE, defaults: { ...DEFAULT_PROFILE.defaults, impact_alpha: 0 } } }, /impact_alpha/);
  rejects("a profile naming an unknown borrower", { profile: { ...DEFAULT_PROFILE, borrower_overrides: { nobody: { addon_days: 1 } } } }, /unknown borrower nobody/);
  rejects("a spread for an unknown borrower", { borrower_credit: { nobody: { spread_bps: 100 } } }, /unknown borrower nobody/);
  rejects("a non-positive spread", { borrower_credit: { "cp-hf01": { spread_bps: 0 } } }, /spread_bps/);
  rejects("an unknown field", { not_a_field: 1 }, /unknown field not_a_field/);
  rejects("a malformed date", { as_of: "20 Oct" }, /as_of/);
  rejects("too few sweep paths", { options: { sensitivity_paths: 10 } }, /sensitivity_paths/);
  rejects("a body that is not an object", [1, 2], /JSON object/);
});
