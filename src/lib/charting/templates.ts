/**
 * Chart templates — preset and user-saved ChartSpec configurations.
 * Persisted to localStorage; URL sharing via encodeSpec/decodeSpec.
 */
import type { ChartSpec, SeriesRef, Transform, RangePreset, ChartType } from "./spec";
import type { IndicatorSpec } from "./indicators";
import type { StudySpec } from "./studies";

export interface ChartTemplate {
  id: string;
  name: string;
  desc: string;
  studio: "MGC" | "MKC" | "both";
  refs: SeriesRef[];
  range: RangePreset;
  transform: Transform;
  chartType: ChartType;
  indicators: IndicatorSpec[];
  studies: StudySpec[];
  showRecession?: boolean;
  showSeasonality?: boolean;
  builtIn?: boolean;
}

const LS_KEY = "chart-templates";

export const MGC_PRESETS: ChartTemplate[] = [
  {
    id: "mgc-inflation-monitor",
    name: "Inflation Monitor",
    desc: "CPI, PCE & breakevens overlay",
    studio: "MGC",
    refs: [
      { source: "econ", id: "CPIAUCSL" },
      { source: "econ", id: "PCEPI" },
      { source: "econ", id: "T10YIE" },
    ],
    range: "5Y",
    transform: "yoy",
    chartType: "line",
    indicators: [],
    studies: [],
    showRecession: true,
    builtIn: true,
  },
  {
    id: "mgc-policy-rates",
    name: "Policy & Rates",
    desc: "Fed Funds, 2Y & 10Y Treasury",
    studio: "MGC",
    refs: [
      { source: "econ", id: "FEDFUNDS" },
      { source: "econ", id: "DGS2" },
      { source: "econ", id: "DGS10" },
    ],
    range: "5Y",
    transform: "none",
    chartType: "line",
    indicators: [],
    studies: [],
    showRecession: true,
    builtIn: true,
  },
  {
    id: "mgc-curve-spreads",
    name: "Curve & Spreads",
    desc: "2s10s spread & term structure",
    studio: "MGC",
    refs: [
      { source: "econ", id: "DGS10" },
      { source: "econ", id: "DGS2" },
    ],
    range: "5Y",
    transform: "none",
    chartType: "line",
    indicators: [],
    studies: [{ id: "spread-curve", type: "spread" }],
    showRecession: true,
    builtIn: true,
  },
  {
    id: "mgc-financial-conditions",
    name: "Financial Conditions",
    desc: "Credit spreads, VIX & dollar",
    studio: "MGC",
    refs: [
      { source: "econ", id: "BAMLH0A0HYM2" },
      { source: "econ", id: "VIXCLS" },
      { source: "econ", id: "DTWEXBGS" },
    ],
    range: "5Y",
    transform: "zscore",
    chartType: "line",
    indicators: [],
    studies: [],
    showRecession: true,
    builtIn: true,
  },
  {
    id: "mgc-labor-market",
    name: "Labor Market",
    desc: "Unemployment, payrolls & claims",
    studio: "MGC",
    refs: [
      { source: "econ", id: "UNRATE" },
      { source: "econ", id: "PAYEMS" },
      { source: "econ", id: "ICSA" },
    ],
    range: "5Y",
    transform: "none",
    chartType: "line",
    indicators: [],
    studies: [],
    showRecession: true,
    builtIn: true,
  },
  {
    id: "mgc-growth-nowcast",
    name: "Growth Nowcast",
    desc: "GDP, ISM & industrial production",
    studio: "MGC",
    refs: [
      { source: "econ", id: "GDP" },
      { source: "econ", id: "MANEMP" },
      { source: "econ", id: "INDPRO" },
    ],
    range: "5Y",
    transform: "yoy",
    chartType: "line",
    indicators: [],
    studies: [],
    showRecession: true,
    builtIn: true,
  },
];

export const MKC_PRESETS: ChartTemplate[] = [
  {
    id: "mkc-trend-momentum",
    name: "Trend & Momentum",
    desc: "SPY with moving averages & RSI",
    studio: "MKC",
    refs: [{ source: "market", id: "SPY", assetClass: "EQUITY" }],
    range: "2Y",
    transform: "none",
    chartType: "candles",
    indicators: [
      { id: "sma-50", type: "sma", length: 50 },
      { id: "sma-200", type: "sma", length: 200 },
      { id: "rsi-14", type: "rsi", length: 14 },
    ],
    studies: [],
    builtIn: true,
  },
  {
    id: "mkc-volatility",
    name: "Volatility",
    desc: "SPY with Bollinger Bands & MACD",
    studio: "MKC",
    refs: [{ source: "market", id: "SPY", assetClass: "EQUITY" }],
    range: "1Y",
    transform: "none",
    chartType: "candles",
    indicators: [
      { id: "boll-20", type: "bollinger", length: 20, k: 2 },
      { id: "macd-d", type: "macd", fast: 12, slow: 26, signal: 9 },
    ],
    studies: [],
    builtIn: true,
  },
  {
    id: "mkc-relative-strength",
    name: "Relative Strength",
    desc: "SPY vs QQQ ratio & rolling correlation",
    studio: "MKC",
    refs: [
      { source: "market", id: "SPY", assetClass: "EQUITY" },
      { source: "market", id: "QQQ", assetClass: "EQUITY" },
    ],
    range: "2Y",
    transform: "index100",
    chartType: "line",
    indicators: [],
    studies: [
      { id: "ratio-rs", type: "ratio" },
      { id: "corr-63", type: "roll_corr", window: 63 },
    ],
    builtIn: true,
  },
  {
    id: "mkc-mean-reversion",
    name: "Mean Reversion",
    desc: "SPY with percentile rank & z-score",
    studio: "MKC",
    refs: [{ source: "market", id: "SPY", assetClass: "EQUITY" }],
    range: "5Y",
    transform: "none",
    chartType: "line",
    indicators: [
      { id: "boll-20-mr", type: "bollinger", length: 20, k: 2 },
    ],
    studies: [{ id: "pctile-252", type: "percentile", window: 252 }],
    builtIn: true,
  },
];

export function getPresetsForStudio(studio: "MGC" | "MKC"): ChartTemplate[] {
  const presets = studio === "MGC" ? MGC_PRESETS : MKC_PRESETS;
  return presets;
}

export function getSavedTemplates(): ChartTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveTemplate(t: ChartTemplate): void {
  const existing = getSavedTemplates().filter((x) => x.id !== t.id);
  localStorage.setItem(LS_KEY, JSON.stringify([...existing, t]));
}

export function deleteTemplate(id: string): void {
  const remaining = getSavedTemplates().filter((x) => x.id !== id);
  localStorage.setItem(LS_KEY, JSON.stringify(remaining));
}

/**
 * Optional shared persistence via /api/chart/templates (DB-backed when
 * CHART_DB_URL / MACRO_DB_URL is configured). localStorage stays the offline
 * tier; these calls are best-effort and never throw to the caller.
 */
export async function fetchRemoteTemplates(studio: "MGC" | "MKC"): Promise<ChartTemplate[]> {
  try {
    const res = await fetch(`/api/chart/templates?studio=${studio}`);
    const j = await res.json();
    return Array.isArray(j?.templates) ? (j.templates as ChartTemplate[]) : [];
  } catch {
    return [];
  }
}

export async function saveTemplateRemote(t: ChartTemplate): Promise<void> {
  try {
    await fetch("/api/chart/templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ template: t }),
    });
  } catch {
    /* offline — localStorage already holds it */
  }
}

export async function deleteTemplateRemote(id: string): Promise<void> {
  try {
    await fetch(`/api/chart/templates?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    /* offline */
  }
}

/** Merge two template lists by id (DB/remote wins on conflict). */
export function mergeTemplates(local: ChartTemplate[], remote: ChartTemplate[]): ChartTemplate[] {
  const byId = new Map<string, ChartTemplate>();
  for (const t of local) byId.set(t.id, t);
  for (const t of remote) byId.set(t.id, t);
  return [...byId.values()];
}

/** Encode a template's chart state into a URL-safe query string. */
export function templateToURL(t: Omit<ChartTemplate, "id" | "name" | "desc" | "studio" | "builtIn">): string {
  const payload = JSON.stringify({
    refs: t.refs,
    range: t.range,
    transform: t.transform,
    chartType: t.chartType,
    indicators: t.indicators,
    studies: t.studies,
    showRecession: t.showRecession,
    showSeasonality: t.showSeasonality,
  });
  if (typeof window === "undefined") return Buffer.from(payload).toString("base64url");
  return btoa(unescape(encodeURIComponent(payload)));
}

export interface ChartState {
  refs: SeriesRef[];
  range: RangePreset;
  transform: Transform;
  chartType: ChartType;
  indicators: IndicatorSpec[];
  studies: StudySpec[];
  showRecession?: boolean;
  showSeasonality?: boolean;
}

/** Decode a URL-safe state param back into chart state. */
export function urlToChartState(s: string): ChartState | null {
  try {
    const json =
      typeof window === "undefined"
        ? Buffer.from(s, "base64url").toString("utf8")
        : decodeURIComponent(escape(atob(s)));
    const obj = JSON.parse(json);
    if (!obj || !Array.isArray(obj.refs)) return null;
    return obj as ChartState;
  } catch {
    return null;
  }
}
