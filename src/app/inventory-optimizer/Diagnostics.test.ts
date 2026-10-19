import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { IbalInfeasibilityExplanation, IbalResult, IbalSensitivity } from "@/lib/inventoryOptimizer";
import { ExplanationSummary, SensitivityView, reasonText } from "./Diagnostics";
import { InfeasibilityTab, MipProgressView } from "./WorkbenchDiagnostics";

const sensitivity = (extra: Partial<IbalSensitivity> = {}): IbalSensitivity => ({
  available: true,
  unavailable_reason: null,
  objective_coefficients: [
    { variable: { kind: "q", scope_id: "RT-AAA-ALPHA" }, value: 80, coefficient: 10 * 0.025 / 360, coefficient_lower: 10 * 0.015 / 360, coefficient_upper: null, objective_at_lower: 0.5, objective_at_upper: null },
    { variable: { kind: "u", scope_id: "INV-AAA" }, value: 1, coefficient: 0, coefficient_lower: null, coefficient_upper: null, objective_at_lower: null, objective_at_upper: null },
  ],
  row_limits: [
    { row: { kind: "route_capacity", scope_id: "RT-AAA-BETA" }, activity: 20, binding: false, limit: "upper", limit_value: 60, limit_lower: 20, limit_upper: null, objective_at_lower: null, objective_at_upper: null },
    { row: { kind: "inventory_balance", scope_id: "INV-AAA" }, activity: 100, binding: true, limit: "upper", limit_value: 100, limit_lower: 80, limit_upper: 140, objective_at_lower: 0.5, objective_at_upper: 0.6 },
  ],
  ...extra,
});

describe("engine diagnostics views", () => {
  it("glosses a reason code and keeps the code itself visible", () => {
    expect(reasonText("formulation_has_no_integer_variables")).toBe(
      "MIP progress applies only to a model with integer variables. (formulation_has_no_integer_variables)",
    );
    expect(reasonText("a_future_code")).toBe("Unavailable. (a_future_code)");
    expect(reasonText("parameter_moves_more_than_one_model_entry")).toContain("use the scenario grid");
    expect(reasonText(null)).toBe("Unavailable.");
  });

  it("distinguishes ranges not requested from ranges the engine could not produce", () => {
    expect(renderToStaticMarkup(createElement(SensitivityView, { sensitivity: null }))).toContain("Ranges were not requested");
    const unavailable = renderToStaticMarkup(createElement(SensitivityView, {
      sensitivity: sensitivity({ available: false, unavailable_reason: "formulation_not_continuous_lp", objective_coefficients: [], row_limits: [] }),
    }));
    expect(unavailable).toContain("(formulation_not_continuous_lp)");
  });

  it("shows route coefficients only, open ends as infinities, and binding rows first", () => {
    const html = renderToStaticMarkup(createElement(SensitivityView, { sensitivity: sensitivity() }));
    expect(html).toContain("Route objective coefficients · 1");
    expect(html).toContain("RT-AAA-ALPHA");
    expect(html).not.toContain(">INV-AAA</td>");
    expect(html).toContain("+∞]");
    expect(html.indexOf("inventory balance")).toBeLessThan(html.indexOf("route capacity"));
  });

  it("states an explanation and never claims a change was applied", () => {
    const explanation = {
      request_id: "r", original_status: "infeasible", outcome: "restorable", message: "Move the cap.",
      relaxable_row_kinds: ["utilization_maximum"], relaxable_row_count: 1, elastic_status: "optimal",
      elastic_verification_passed: true, total_normalized_slack: 0.1,
      relaxations: [{
        row: { kind: "utilization_maximum", scope_id: "INV-AAA" }, inventory_id: "INV-AAA", policy_id: "UP-CORE",
        limit: "upper", original_limit_shares: 80, required_limit_shares: 90, slack_shares: 10,
        original_utilization: 0.8, required_utilization: 0.9,
      }],
      relaxed_model_status: "optimal",
    } as unknown as IbalInfeasibilityExplanation;
    const html = renderToStaticMarkup(createElement(ExplanationSummary, { explanation }));
    expect(html).toContain("Feasible if the utilization limits below move.");
    expect(html).toContain("80 → 90");
    expect(html).toContain("0.8 → 0.9");
    expect(html).toContain("Nothing has been changed.");
    expect(renderToStaticMarkup(createElement(ExplanationSummary, { explanation: null }))).toBe("");
  });

  it("explains an LP's missing MIP trace instead of an empty table", () => {
    const result = { mip_progress: { available: false, unavailable_reason: "formulation_has_no_integer_variables", points: [] } } as unknown as IbalResult;
    const html = renderToStaticMarkup(createElement(MipProgressView, { result }));
    expect(html).toContain("(formulation_has_no_integer_variables)");
    expect(html).not.toContain("<table");
    expect(renderToStaticMarkup(createElement(MipProgressView, { result: null }))).toContain("not requested");
  });

  it("offers the explanation only for an infeasible run, without a manual button", () => {
    const render = (status: string) => renderToStaticMarkup(createElement(InfeasibilityTab, {
      result: { run_id: `run-${status}`, status } as unknown as IbalResult, dataset: null, runConfig: {} as never,
    }));
    expect(render("infeasible")).toContain("This run is infeasible.");
    expect(render("infeasible")).not.toContain("<button");
    expect(render("optimal")).toContain("This run is optimal; the explanation applies to infeasible runs.");
  });
});
