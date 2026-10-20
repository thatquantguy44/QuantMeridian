import { describe, expect, test } from "vitest";
import { composeRunRequest, bookSummary } from "@/lib/indemnificationCompose";
import {
  MODE_DEFAULTS, PREVIEW_PATHS, defaultUi, describeRun, effectivePaths, toRunInput, uiIssues, willBePriced, withMode,
} from "./state";

const today = () => "2026-10-20";

describe("INDEM page state", () => {
  test("starts as a labelled desk preview built from the documented defaults", async () => {
    const book = await bookSummary(today);
    const ui = defaultUi(book);
    expect(ui).toMatchObject({ mode: "desk", preview: true, paths: 50000, horizonDays: 21, step: "daily", rhoD: 0.25, rhoW: 0.3, studentNu: 5, costOfCapital: 0.1, flagThreshold: 0.5, seed: 1 });
    expect(effectivePaths(ui)).toBe(PREVIEW_PATHS);
    expect(uiIssues(ui)).toEqual([]);
    expect(ui.profile.name).toBe("default");
    expect(ui.profile).not.toBe(book.defaults.profile);              // a copy: editing it never touches the defaults
  });

  test("a reported run uses the chosen path count, a preview never more than 5,000", async () => {
    const ui = defaultUi(await bookSummary(today));
    expect(effectivePaths({ ...ui, preview: false })).toBe(50000);
    expect(effectivePaths({ ...ui, preview: true, paths: 2000 })).toBe(2000);
    expect(effectivePaths({ ...ui, preview: true, paths: 200000 })).toBe(PREVIEW_PATHS);
  });

  test("switching mode moves the horizon and step to that mode's defaults", async () => {
    const ui = defaultUi(await bookSummary(today));
    expect(withMode(ui, "annual")).toMatchObject({ mode: "annual", ...MODE_DEFAULTS.annual });
    expect(withMode(withMode(ui, "annual"), "desk")).toMatchObject({ mode: "desk", ...MODE_DEFAULTS.desk });
    expect(willBePriced(withMode(ui, "annual"))).toBe(true);
    expect(willBePriced(ui)).toBe(false);
    expect(willBePriced({ ...withMode(ui, "annual"), horizonDays: 126 })).toBe(false);
  });

  test("explains every problem with the current choices", async () => {
    const ui = defaultUi(await bookSummary(today));
    const bad = { ...ui, paths: 10, seed: -1, horizonDays: 5, rhoD: 0.25, rhoW: 0.9, studentNu: 2, costOfCapital: 2, flagThreshold: -1, sweepPaths: 10 };
    const text = uiIssues(bad).join(" | ");
    for (const part of ["Paths", "Seed", "Horizon", "Wrong-way correlation squared", "Student-t", "Cost of capital", "Flag threshold", "Paths per sweep point"]) expect(text).toContain(part);
    expect(uiIssues({ ...bad, sweeps: false }).join(" ")).not.toContain("per sweep point");
    expect(uiIssues({ ...ui, credit: { B1: { spread_bps: 0, recovery: 1 } } }).join(" ")).toMatch(/spread for B1.*recovery for B1/i);
    const edited = JSON.parse(JSON.stringify(ui)); edited.profile.defaults.impact_alpha = 0;
    expect(uiIssues(edited).join(" ")).toMatch(/Close-out profile.*Impact exponent/);
  });

  test("the request carries choices only, and the server accepts what the page sends", async () => {
    const book = await bookSummary(today);
    const ui = { ...withMode(defaultUi(book), "annual"), seed: 7, credit: { [book.borrowers[0].id]: { spread_bps: 250, recovery: null } } };
    const input = toRunInput(ui);
    expect(input.run).toEqual({ mode: "annual", seed: 7, paths: 5000, preview: true, horizon_days: 252, step: "weekly" });
    expect(input.options).toEqual({ sensitivity_paths: 5000, stresses: true, stress_profile_overrides: null });
    expect(Object.keys(input).sort()).toEqual(["borrower_credit", "model", "options", "pricing", "profile", "run"]);
    expect("loans" in input || "snapshot" in input).toBe(false);
    const request = await composeRunRequest(input, today);          // what the route will do
    expect(request.snapshot.run).toMatchObject({ mode: "annual", horizon_days: 252, preview: true });
    expect(request.snapshot.borrowers[0]).toMatchObject({ spread_bps: 250, credit_provenance: "user_input" });
  });

  test("turning sweeps off or adding stress overrides changes the options", async () => {
    const ui = defaultUi(await bookSummary(today));
    expect(toRunInput({ ...ui, sweeps: false, stresses: false }).options).toEqual({ sensitivity_paths: null, stresses: false, stress_profile_overrides: null });
    expect(toRunInput({ ...ui, stressOverrides: { half_spread_floor_bps: 50 } }).options?.stress_profile_overrides).toEqual({ half_spread_floor_bps: 50 });
    expect(toRunInput(ui).borrower_credit).toBeUndefined();
  });

  test("describes the run in one line", async () => {
    const ui = defaultUi(await bookSummary(today));
    expect(describeRun(ui)).toBe("Desk view · 21 business days, daily steps · 5,000 paths (preview) · seed 1");
    expect(describeRun({ ...withMode(ui, "annual"), preview: false })).toBe("Annual view · 252 business days, weekly steps · 50,000 paths (reported) · seed 1");
  });
});
