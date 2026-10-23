import { describe, expect, it } from "vitest";
import { VIXR_TEX, formulaIntro, parseFormulaSections } from "./vixrFormulas";
import { loadGuide } from "./moduleGuides";
import { parseMarkdown } from "./markdown";
import { HORIZON_DAYS, MAX_ENDPOINT_GAP_DAYS, MIN_OBSERVATIONS, NON_OVERLAP_LAG, NORMAL_BENCHMARK, OVERLAP_LAG, REGIME_EDGES, TRADING_DAYS_PER_YEAR } from "./vixImpliedForward";
import { MIN_TEST, MIN_TRAIN_DAILY, MIN_TRAIN_MONTHLY } from "./vixWalkForward";

const sections = parseFormulaSections(VIXR_TEX);
const all = sections.map((s) => s.latex).join("\n");

describe("formula sheet source", () => {
  it("loads the .tex and splits it into the expected sections", () => {
    expect(VIXR_TEX.startsWith("\\documentclass")).toBe(true);
    expect(sections.map((s) => s.title)).toEqual([
      "Notation", "Implied move and band", "Forward return and standardized move", "Realized and trailing volatility",
      "Premium and ratios", "Sampling and effective sample size", "Calibration shares and Wilson intervals",
      "Distribution of standardized moves", "Regression with Newey-West errors", "Rank correlation and quantiles",
      "Predictive grade (readout)", "Expanding-window out-of-sample test",
    ]);
    expect(sections.every((s) => s.latex.length > 40)).toBe(true);
    expect(formulaIntro(VIXR_TEX)).toMatch(/Every formula below is the one the code evaluates/);
  });

  it("is well formed: balanced environments and braces in every section, no leftover markers", () => {
    for (const { title, latex } of sections) {
      const begins = [...latex.matchAll(/\\begin\{(\w+\*?)\}/g)].map((m) => m[1]);
      const ends = [...latex.matchAll(/\\end\{(\w+\*?)\}/g)].map((m) => m[1]);
      expect(begins.sort(), title).toEqual(ends.sort());
      let depth = 0;
      for (const ch of latex.replace(/\\[{}]/g, "")) { depth += ch === "{" ? 1 : ch === "}" ? -1 : 0; expect(depth, `${title}: brace closed before opened`).toBeGreaterThanOrEqual(0); }
      expect(depth, `${title}: unbalanced braces`).toBe(0);
      expect(latex, title).not.toMatch(/TODO|FIXME|undefined|NaN/);
    }
  });

  it("returns nothing for a document without sections", () => {
    expect(parseFormulaSections("no latex here")).toEqual([]);
    expect(parseFormulaSections("\\begin{document}text\\end{document}")).toEqual([]);
    expect(formulaIntro("nothing")).toBe("");
  });
});

describe("the formulas quote the constants the code uses", () => {
  it("horizon, annualization and gap rule", () => {
    expect(HORIZON_DAYS).toBe(30);
    expect(all).toContain("\\tfrac{30}{365}");
    expect(all).toContain(`h = ${HORIZON_DAYS}`);
    expect(TRADING_DAYS_PER_YEAR).toBe(252);
    expect(all).toContain("\\frac{252}{N_k}");
    expect(all).toContain("\\frac{252}{M_k}");
    expect(all).toContain(`\\le ${MAX_ENDPOINT_GAP_DAYS}$ days`);
    expect(all).toContain(`M_k \\ge 10`);
  });

  it("overlap handling and Newey-West lags", () => {
    expect(all).toContain(`\\frac{n}{${OVERLAP_LAG}}`);
    expect(all).toContain(`L = ${OVERLAP_LAG}$ for daily windows and $L = ${NON_OVERLAP_LAG}$`);
    expect(all).toContain(`up to ${OVERLAP_LAG} returns`);
  });

  it("benchmark shares, bucket edges and grade thresholds", () => {
    expect(all).toContain(NORMAL_BENCHMARK.within1.toFixed(2));
    expect(all).toContain(NORMAL_BENCHMARK.within2.toFixed(2));
    expect(all).toContain(NORMAL_BENCHMARK.beyondMinus2.toFixed(2));
    expect(all).toContain(`$${REGIME_EDGES.join(", ")}$`);
    for (const r2 of ["0.10", "0.30", "0.50"]) expect(all).toContain(r2);
    expect(all).toContain("1.96");
  });

  it("out-of-sample warm-up", () => {
    expect(all).toContain(`n_0 = ${MIN_TRAIN_MONTHLY}$ (non-overlapping) or $${MIN_TRAIN_DAILY}$ (daily)`);
    expect(MIN_TEST).toBe(10);
    expect(MIN_OBSERVATIONS).toBe(10);
  });
});

describe("white paper Formulas section", () => {
  it("is generated from the .tex: every section appears in order with identical LaTeX", async () => {
    const blocks = parseMarkdown(await loadGuide("VIXR", "whitepaper"));
    const start = blocks.findIndex((b) => b.type === "heading" && b.level === 2 && b.text === "Formulas");
    expect(start).toBeGreaterThan(0);
    const next = blocks.findIndex((b, i) => i > start && b.type === "heading" && b.level === 2);
    const slice = blocks.slice(start + 1, next);
    const headings = slice.filter((b) => b.type === "heading").map((b) => (b as { text: string }).text);
    const code = slice.filter((b) => b.type === "code").map((b) => (b as { text: string }).text);
    expect(headings).toEqual(sections.map((s) => s.title));
    expect(code).toEqual(sections.map((s) => s.latex));
  });

  it("points readers to the file and the page panel", async () => {
    const text = await loadGuide("VIXR", "whitepaper");
    expect(text).toContain("docs/guides/markets/vixr-formulas.tex");
    expect(text).toMatch(/\*\*Formulas\*\* panel/);
  });
});
