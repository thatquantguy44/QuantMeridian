/**
 * Reviewed unit mapping for the metric registry (spec009 REQ-009).
 *
 * Verified claims report the raw Gold `lin` level (`/api/chart/series?units=lin`), but the FRED
 * catalog's display `unit` describes what the terminal shows after a transform (`pc1`, `pch`,
 * `pca`, `chg`) or a display rescale. For those 46 series the catalog unit is NOT the unit of the
 * Gold level, so each is listed here with the unit of the raw level and why. Series whose
 * resolver is plain (`lin`, scale 1) take the catalog unit through CATALOG_UNITS instead.
 *
 * A series that is neither plain nor listed here is excluded from the registry
 * (`lin_unit_unreviewed`) rather than guessed at.
 */
import type { MetricUnit } from "./metricTypes";

export interface ReviewedLinUnit {
  unit: MetricUnit;
  /** Label shown after the raw value. */
  displayUnit: string;
  decimals: number;
  /** What FRED publishes for the series, and why it differs from the catalog display. */
  note: string;
}

const pp = (note = "FRED publishes spreads in percentage points; the terminal rescales to bps for display."): ReviewedLinUnit => ({
  unit: "pp", displayUnit: "pp", decimals: 2, note,
});
const idx = (decimals: number, note: string): ReviewedLinUnit => ({ unit: "index", displayUnit: "index", decimals, note });
const usd = (displayUnit: string, decimals: number, note: string): ReviewedLinUnit => ({ unit: "currency", displayUnit, decimals, note });
const cnt = (displayUnit: string, decimals: number, note: string): ReviewedLinUnit => ({ unit: "count", displayUnit, decimals, note });

export const REVIEWED_LIN_UNITS: Readonly<Record<string, ReviewedLinUnit>> = {
  // Transformed for display (catalog shows %, the Gold level is the underlying series).
  GDPC1: usd("$B (chained 2017, SAAR)", 1, "Real GDP level; the catalog shows the annualized growth rate (pca)."),
  INDPRO: idx(2, "Industrial production index (2017=100); the catalog shows % m/m (pch)."),
  CPIAUCSL: idx(3, "CPI-U index (1982-84=100); the catalog shows % y/y (pc1)."),
  CPILFESL: idx(3, "Core CPI index (1982-84=100); the catalog shows % y/y (pc1)."),
  PCEPI: idx(3, "PCE price index (2017=100); the catalog shows % y/y (pc1)."),
  PCEPILFE: idx(3, "Core PCE price index (2017=100); the catalog shows % y/y (pc1)."),
  PAYEMS: cnt("k persons", 0, "Payroll employment level in thousands; the catalog shows the monthly change (chg)."),
  CES0500000003: usd("$/hr", 2, "Average hourly earnings level; the catalog shows % y/y (pc1)."),
  RSAFS: usd("$M", 0, "Retail sales level in millions of dollars; the catalog shows % m/m (pch)."),
  M2SL: usd("$B", 1, "M2 level in billions of dollars; the catalog shows % y/y (pc1)."),
  M1SL: usd("$B", 1, "M1 level in billions of dollars; the catalog shows % y/y (pc1)."),
  REVOLSL: usd("$B", 1, "Revolving consumer credit in billions of dollars; the catalog shows % y/y (pc1)."),
  PPIACO: idx(1, "PPI all commodities index (1982=100); the catalog shows % y/y (pc1)."),
  PCE: usd("$B", 1, "Personal consumption expenditures in billions of dollars (SAAR); the catalog shows % y/y (pc1)."),
  CSUSHPINSA: idx(3, "Case-Shiller national home price index; the catalog shows % y/y (pc1)."),
  DGORDER: usd("$M", 0, "Durable goods new orders in millions of dollars; the catalog shows % m/m (pch)."),
  NEWORDER: usd("$M", 0, "Core capital goods new orders in millions of dollars; the catalog shows % m/m (pch)."),
  DGDSRG3M086SBEA: idx(3, "PCE goods price index (2017=100) (FRED RG3M086SBEA series); catalog shows % m/m."),
  DSERRG3M086SBEA: idx(3, "PCE services price index (2017=100); catalog shows % m/m."),
  DNRGRG3M086SBEA: idx(3, "PCE energy price index (2017=100); catalog shows % m/m."),
  DFXARG3M086SBEA: idx(3, "PCE food price index (2017=100); catalog shows % m/m."),
  DHLCRG3M086SBEA: idx(3, "PCE health care price index (2017=100); catalog shows % m/m."),
  DHUTRC1M027SBEA: usd("$B", 1, "PCE housing and utilities in billions of dollars (FRED RC1M027SBEA series); catalog shows % m/m."),
  DTRSRC1M027SBEA: usd("$B", 1, "PCE transportation services in billions of dollars; catalog shows % m/m."),
  DRCARC1M027SBEA: usd("$B", 1, "PCE recreation services in billions of dollars; catalog shows % m/m."),
  // Rescaled for display only (transform is lin).
  ICSA: cnt("persons", 0, "Initial claims in persons; the terminal rescales to thousands."),
  CCSA: cnt("persons", 0, "Continued claims in persons; the terminal rescales to millions."),
  JTSJOL: cnt("k", 0, "Job openings in thousands; the terminal rescales to millions."),
  HOUST: cnt("k SAAR", 0, "Housing starts in thousands of units (SAAR); the terminal rescales to millions."),
  PERMIT: cnt("k SAAR", 0, "Building permits in thousands of units (SAAR); the terminal rescales to millions."),
  EXHOSLUSM495S: cnt("homes", 0, "Existing home sales as a count of homes; the terminal rescales to millions."),
  WALCL: usd("$M", 0, "Fed balance sheet in millions of dollars; the terminal rescales to trillions."),
  WRESBAL: usd("$B", 0, "Reserve balances in billions of dollars; the terminal rescales to trillions."),
  BOGMBASE: usd("$B", 0, "Monetary base in billions of dollars; the terminal rescales to trillions."),
  T10Y2Y: pp(),
  T10Y3M: pp(),
  BAMLH0A0HYM2: pp(),
  BAMLC0A0CM: pp(),
  BAMLC0A1CAAA: pp(),
  BAMLC0A2CAA: pp(),
  BAMLC0A3CA: pp(),
  BAMLC0A4CBBB: pp(),
  BAMLH0A1HYBB: pp(),
  BAMLH0A2HYB: pp(),
  BAMLH0A3HYC: pp(),
  BAMLEMCBPIOAS: pp(),
};

/** Catalog display units that are also the unit of the Gold level when the resolver is plain. */
export const CATALOG_UNITS: Readonly<Record<string, { unit: MetricUnit; displayUnit: string }>> = {
  "%": { unit: "pct", displayUnit: "%" },
  "% y/y": { unit: "pct", displayUnit: "% y/y" },
  "% q/q ann.": { unit: "pct", displayUnit: "% q/q ann." },
  "% ann.": { unit: "pct", displayUnit: "% ann." },
  "net %": { unit: "pct", displayUnit: "net %" },
  "% m/m": { unit: "pct", displayUnit: "% m/m" },
  "k m/m": { unit: "count", displayUnit: "k m/m" },
  index: { unit: "index", displayUnit: "index" },
  bps: { unit: "bps", displayUnit: "bps" },
  hrs: { unit: "hours", displayUnit: "hrs" },
  months: { unit: "count", displayUnit: "months" },
  "M SAAR": { unit: "count", displayUnit: "M SAAR" },
  M: { unit: "count", displayUnit: "M" },
  $: { unit: "currency", displayUnit: "$" },
  "$B": { unit: "currency", displayUnit: "$B" },
  "$/oz": { unit: "currency", displayUnit: "$/oz" },
  "$/bbl": { unit: "currency", displayUnit: "$/bbl" },
  "¥": { unit: "currency", displayUnit: "¥" },
  "C$": { unit: "currency", displayUnit: "C$" },
  "MX$": { unit: "currency", displayUnit: "MX$" },
};

/**
 * Label for a series whose Gold level is not what the catalog label describes: drop the
 * transform words and say "level", so a claim never pairs "YoY" with an index value.
 */
export function levelLabel(label: string): string {
  const stripped = label
    .replace(/,?\s*\b(?:YoY|MoM|chg)\b/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${stripped} level`;
}
