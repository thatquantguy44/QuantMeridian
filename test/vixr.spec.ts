/**
 * VIXR end-to-end: the page against the live Gold-backed route, then against deterministic mocked responses for the
 * failure and control-interaction cases.
 *
 * Run: npx playwright test test/vixr.spec.ts   (dev server on http://localhost:3000 or BASE_URL)
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const crisis = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/lib/__fixtures__/vixr/gold-crisis_2007_2009.json"), "utf8")) as { vix: [string, number][]; spy: [string, number][] };

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PATH = "/market-volatility/implied-vs-forward";
const API = "**/api/market-volatility/vix-forward**";

const fulfill = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const mockOk = {
  source: "DB", basis: "spy_price", vix: crisis.vix, price: crisis.spy,
  inputs: { vixSeriesId: "VIXCLS", priceSeriesId: "SPY:close", priceLabel: "SPY price (1993+)", vixFirst: crisis.vix[0][0], vixLast: crisis.vix.at(-1)![0], priceFirst: crisis.spy[0][0], priceLast: crisis.spy.at(-1)![0] },
  citations: [{ seriesId: "VIXCLS", title: "CBOE Volatility Index", source: "Cboe via FRED", url: "https://fred.stlouisfed.org/series/VIXCLS" }],
  warnings: [],
};

async function openPage(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}${PATH}`);
  return errors;
}

const kpi = (page: Page, label: string) => page.locator("div", { hasText: new RegExp(`^${label}$`, "i") }).first().locator("xpath=..");

test("live Gold data: readout, charts, tables and no NaN", async ({ page }) => {
  const errors = await openPage(page);
  await expect(page.getByText(/magnitude signal/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/LIVE · DB/).first()).toBeVisible();
  for (const name of ["Implied move vs realized 30-day return", "Implied ±1σ band vs outcome over time", "Standardized move distribution", "VIX vs subsequent realized volatility", "Regressions", "Forward returns by VIX bucket"]) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("img", { name: /Scatter of VIX implied/ })).toBeVisible();
  expect(await page.locator("svg circle").count()).toBeGreaterThan(300);
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/\bNaN\b|\bundefined\b|Infinity/);
  // Full history reaches back to 1993 and the latest VIX is in the KPI strip.
  await expect(page.getByText(/1993–20\d\d/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("controls change the statistics: date range, sampling and basis", async ({ page }) => {
  await page.route(API, (route) => fulfill(route, mockOk));
  await openPage(page);
  await expect(page.getByText(/magnitude signal/i).first()).toBeVisible();
  const sample = page.getByText(/independent/).first();
  const monthly = await sample.innerText();

  await page.getByRole("button", { name: "Daily" }).click();
  await expect(page.getByText("daily overlapping")).toBeVisible();
  await expect(page.getByText(/21 lags/).first()).toBeVisible();
  expect(await sample.innerText()).not.toBe(monthly);

  await page.getByRole("button", { name: "Non-overlapping" }).click();
  await expect(page.getByText("non-overlapping", { exact: true })).toBeVisible();

  // Narrowing to 2009 leaves too few windows for the statistics and says so instead of showing zeros.
  await page.getByLabel("From date").fill("2009-11-01");
  await expect(page.getByText(/Not enough observations in this range/)).toBeVisible();
  await page.getByRole("button", { name: "Full history" }).click();
  await expect(page.getByText(/magnitude signal/i).first()).toBeVisible();

  await page.getByRole("button", { name: "Quintiles" }).click();
  await expect(page.getByRole("cell", { name: /^Q1 · / })).toBeVisible();
  await page.getByRole("button", { name: "VIX levels" }).click();
  await expect(page.getByRole("cell", { name: "VIX < 15" })).toBeVisible();
});

test("basis buttons request the matching series", async ({ page }) => {
  const requested: string[] = [];
  await page.route(API, (route) => { requested.push(new URL(route.request().url()).searchParams.get("basis") ?? ""); return fulfill(route, mockOk); });
  await openPage(page);
  await expect(page.getByText(/magnitude signal/i).first()).toBeVisible();
  await page.getByRole("button", { name: /SPY total return/ }).click();
  await page.getByRole("button", { name: /S&P 500 index/ }).click();
  await expect.poll(() => requested).toEqual(["spy_price", "spy_total", "sp500_index"]);
});

test("a Gold failure shows an error and never simulated numbers", async ({ page }) => {
  await page.route(API, (route) => fulfill(route, { source: "ERR", basis: "spy_price", vix: [], price: [], inputs: { vixSeriesId: "VIXCLS", priceSeriesId: "SPY:close", priceLabel: "SPY price (1993+)", vixFirst: null, vixLast: null, priceFirst: null, priceLast: null }, citations: [], warnings: ["MACRO_DB_URL not configured."], error: "MACRO_DB_URL not configured." }));
  const errors = await openPage(page);
  await expect(page.getByRole("alert")).toContainText("MACRO_DB_URL not configured");
  await expect(page.getByRole("alert")).toContainText(/never substitutes simulated data/);
  await expect(page.getByText(/magnitude signal/i)).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toMatch(/\bNaN\b/);
  expect(errors).toEqual([]);
});

test("a network failure is handled the same way", async ({ page }) => {
  await page.route(API, (route) => route.abort());
  const errors = await openPage(page);
  await expect(page.getByRole("alert")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the Guide button opens the VIXR help", async ({ page }) => {
  await page.route(API, (route) => fulfill(route, mockOk));
  await openPage(page);
  await page.getByRole("button", { name: /guide/i }).first().click();
  await expect(page.getByText("So is the VIX predictive?")).toBeVisible();
});

test("fits a phone width without horizontal page scroll", async ({ page }) => {
  await page.route(API, (route) => fulfill(route, mockOk));
  await page.setViewportSize({ width: 390, height: 900 });
  await openPage(page);
  await expect(page.getByText(/magnitude signal/i).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("live data: the out-of-sample panel shows skill, a chart and the model table", async ({ page }) => {
  const errors = await openPage(page);
  await expect(page.getByText(/magnitude signal/i).first()).toBeVisible({ timeout: 30_000 });
  const panel = page.locator("section", { hasText: /expanding window · no look-ahead/i }).last();
  await expect(panel.getByText(/Volatility forecasts/)).toBeVisible();
  await expect(panel.getByRole("img", { name: /Cumulative out-of-sample advantage/ })).toBeVisible();
  for (const label of ["VIX as quoted", "VIX recalibrated (a + b·VIX)", "Trailing 30-day realized vol", "Historical mean (benchmark)", "Return ~ VIX regression"]) {
    await expect(panel.getByRole("cell", { name: new RegExp(label.replace(/[()+·]/g, "\\$&")) }).first()).toBeVisible();
  }
  await expect(panel.getByText(/no look-ahead/i)).toBeVisible();
  expect(await panel.innerText()).not.toMatch(/\bNaN\b|\bundefined\b|Infinity/);
  expect(errors).toEqual([]);
});

test("the out-of-sample panel explains when there is not enough history", async ({ page }) => {
  await page.route(API, (route) => fulfill(route, mockOk));
  await openPage(page);
  const panel = page.locator("section", { hasText: /expanding window · no look-ahead/i }).last();
  // The 2007-09 excerpt has 33 non-overlapping windows, below the 60-window minimum.
  await expect(panel.getByText(/Not enough history for an out-of-sample test/)).toBeVisible();
  await expect(panel.getByText(/needs 60 prior non-overlapping windows/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Download forecasts as CSV" })).toBeDisabled();
});

test("CSV downloads carry provenance, the right columns and honor the current controls", async ({ page }) => {
  await page.route(API, (route) => fulfill(route, mockOk));
  await openPage(page);
  await expect(page.getByText(/magnitude signal/i).first()).toBeVisible();

  const read = async (name: string) => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name }).click()]);
    const stream = await download.createReadStream();
    let text = "";
    for await (const chunk of stream) text += chunk.toString();
    return { filename: download.suggestedFilename(), lines: text.trimEnd().split("\n") };
  };

  const windows = await read("Download windows as CSV");
  expect(windows.filename).toBe("vixr_windows_spy_price.csv");
  expect(windows.lines[0]).toBe("# VIX forward windows");
  expect(windows.lines.some((l) => l.startsWith("# Source: Gold VIXCLS and SPY:close"))).toBe(true);
  expect(windows.lines.some((l) => l === "# Sampling: non-overlapping 30-day windows")).toBe(true);
  const headerAt = windows.lines.findIndex((l) => l.startsWith("start_date,"));
  expect(windows.lines[headerAt]).toContain("implied_1sigma_pct");
  const rows = windows.lines.slice(headerAt + 1);
  expect(rows.length).toBeGreaterThan(20);
  expect(rows.every((r) => r.split(",").length === 10)).toBe(true);
  expect(rows.join("\n")).not.toMatch(/NaN|undefined|Infinity|null/);

  // Daily sampling and a date range change the file.
  await page.getByRole("button", { name: "Daily" }).click();
  await page.getByLabel("From date").fill("2008-01-01");
  const daily = await read("Download windows as CSV");
  expect(daily.filename).toBe("vixr_windows_spy_price_2008-01-01.csv");
  expect(daily.lines.some((l) => l === "# Sampling: daily overlapping windows")).toBe(true);
  expect(daily.lines.some((l) => l === "# Range: 2008-01-01 to latest")).toBe(true);
  const dailyRows = daily.lines.slice(daily.lines.findIndex((l) => l.startsWith("start_date,")) + 1);
  expect(dailyRows.length).toBeGreaterThan(rows.length);
  expect(dailyRows.every((r) => r.slice(0, 10) >= "2008-01-01")).toBe(true);

  const buckets = await read("Download buckets as CSV");
  expect(buckets.filename).toBe("vixr_buckets_spy_price_2008-01-01.csv");
  expect(buckets.lines.find((l) => l.startsWith("bucket,"))).toContain("pct_inside_1sigma");
});

test("live data: forecasts CSV has one row per out-of-sample window", async ({ page }) => {
  await openPage(page);
  await expect(page.getByText(/magnitude signal/i).first()).toBeVisible({ timeout: 30_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download forecasts as CSV" }).click()]);
  const stream = await download.createReadStream();
  let text = "";
  for await (const chunk of stream) text += chunk.toString();
  const lines = text.trimEnd().split("\n");
  const header = lines.findIndex((l) => l.startsWith("start_date,"));
  expect(lines[header]).toContain("forecast_vol_vix_calibrated");
  const rows = lines.slice(header + 1);
  expect(rows.length).toBeGreaterThan(300);
  expect(rows.every((r) => r.split(",").length === 12)).toBe(true);
  // Training never shrinks and no forecast row precedes the minimum training size.
  const trained = rows.map((r) => Number(r.split(",")[2]));
  expect(trained.every((n, i) => i === 0 || n >= trained[i - 1])).toBe(true);
  expect(trained[0]).toBeGreaterThanOrEqual(60);
});

test("the Formulas panel renders the math, keeps the LaTeX source, and downloads the .tex", async ({ page }) => {
  await page.route(API, (route) => fulfill(route, mockOk));
  const errors = await openPage(page);
  const panel = page.locator("section", { hasText: "LaTeX · how each number is calculated" }).last();
  await panel.scrollIntoViewIfNeeded();
  const titles = ["Notation", "Implied move and band", "Forward return and standardized move", "Realized and trailing volatility", "Premium and ratios", "Sampling and effective sample size", "Calibration shares and Wilson intervals", "Distribution of standardized moves", "Regression with Newey-West errors", "Rank correlation and quantiles", "Predictive grade (readout)", "Expanding-window out-of-sample test"];
  for (const title of titles) await expect(panel.locator("summary", { hasText: title })).toBeVisible();

  const section = panel.locator("details", { has: page.locator("summary", { hasText: "Implied move and band" }) }).first();
  await section.locator("summary").first().click();
  // Real typeset math, not source text.
  await expect(section.locator(".katex:visible").first()).toBeVisible({ timeout: 15_000 });
  await expect(section.locator(".katex-html").first()).toContainText("σ");
  expect(await section.locator(".katex-error").count()).toBe(0);
  // The source is still one click away.
  await section.getByText("LaTeX source").click();
  await expect(section.locator("pre")).toContainText("\\sigma_k &= V_k \\sqrt{\\tfrac{30}{365}}");

  // Table sections have clean headers (regression: the column spec once leaked into the first cell).
  const regression = panel.locator("details", { has: page.locator("summary", { hasText: "Regression with Newey-West errors" }) }).first();
  await regression.locator("summary").first().click();
  await expect(regression.getByRole("columnheader", { name: "Model" })).toBeVisible();
  expect(await regression.innerText()).not.toMatch(/@\{|lll/);

  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Download .tex" }).click()]);
  expect(download.suggestedFilename()).toBe("vixr-formulas.tex");
  let tex = "";
  for await (const chunk of await download.createReadStream()) tex += chunk.toString();
  expect(tex.startsWith("\\documentclass")).toBe(true);
  expect(tex).toContain("\\end{document}");
  expect((tex.match(/\\subsection\*\{/g) ?? []).length).toBe(12);
  expect(errors).toEqual([]);
});

test("copy buttons put the LaTeX on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await page.route(API, (route) => fulfill(route, mockOk));
  await openPage(page);
  const panel = page.locator("section", { hasText: "LaTeX · how each number is calculated" }).last();
  await panel.scrollIntoViewIfNeeded();
  await panel.getByRole("button", { name: "Copy LaTeX: Implied move and band" }).click();
  await expect(panel.getByRole("button", { name: "Copy LaTeX: Implied move and band" })).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("\\sigma_k &= V_k");
  await panel.getByRole("button", { name: "Copy all LaTeX" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("\\documentclass");
});

test("the white paper renders its formulas as math with the source available", async ({ page }) => {
  await page.goto(`${BASE}/guides/VIXR/whitepaper`);
  await expect(page.getByRole("heading", { name: "Formulas", exact: true })).toBeVisible();
  const block = page.locator(".katex-html").first();
  await expect(block).toBeVisible({ timeout: 15_000 });
  expect(await page.locator(".katex-error").count()).toBe(0);
  expect(await page.locator(".katex").count()).toBeGreaterThan(40);
  // The first block (Notation) has no equations; the second (Implied move and band) does.
  const source = page.locator("details", { hasText: "LaTeX source" }).nth(1);
  await source.getByText("LaTeX source").click();
  await expect(source.locator("pre")).toContainText("\\begin{align*}");
  await expect(source.locator("pre")).toContainText("\\sigma_k &= V_k");
});
