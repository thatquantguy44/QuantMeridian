import { Rng } from "@/lib/rng";
import { etlCountryMacro, etlInflationTimeseries, type EtlCountryMacro } from "@/data/etlMacro";
import type { DataSource } from "@/lib/useEcon";

/**
 * Global inflation & policy-rate monitors.
 *
 * For each country we compute the latest YoY/MoM print, the trend vs the prior
 * print, and the number of consecutive prints moving in the same direction
 * ("streak") — derived from a deterministic recent history so it is stable.
 */

export type Trend = "RISING" | "FALLING" | "FLAT";
export type Region = "AMER" | "EMEA" | "APAC";

export interface CountryInflation {
  country: string;
  flag: string;
  region: Region;
  fredId: string;
  yoy: number;
  priorYoy: number;
  mom: number | null;
  momDelta: number | null;
  yoyDelta: number | null;
  trend: Trend;
  streak: number; // consecutive prints in same YoY direction
  target: number;
  vsTarget: number; // yoy - target
  history: number[]; // recent YoY prints (oldest -> newest)
  source: DataSource;
  asOf: string | null;
}

export interface PolicyRate {
  country: string;
  flag: string;
  region: Region;
  centralBank: string;
  rate: number;
  priorRate: number;
  lastMoveBps: number;
  lastMeeting: string;
  cycle: "HIKING" | "CUTTING" | "HOLD";
  streak: number; // consecutive meetings of the same action
  nextMeeting: string;
  realRate: number; // rate - cpi yoy
  bias: "HAWKISH" | "NEUTRAL" | "DOVISH";
  history: number[];
  fredId?: string; // OECD central-bank-rate / ECB series where available
  source: DataSource;
  asOf: string | null;
  rateAsOf: string | null;
  decisionDate: string | null;
  decisionSource: "GOLD_CALENDAR" | "OFFICIAL" | "UNAVAILABLE";
}

// country, flag, region, fredId, current CPI YoY, target
const CPI_DEFS: [string, string, Region, string, number, number][] = [
  ["United States", "🇺🇸", "AMER", "CPIAUCSL", 2.6, 2.0],
  ["Euro Area", "🇪🇺", "EMEA", "CP0000EZ19M086NEST", 2.1, 2.0],
  ["United Kingdom", "🇬🇧", "EMEA", "GBRCPIALLMINMEI", 2.8, 2.0],
  ["Japan", "🇯🇵", "APAC", "JPNCPIALLMINMEI", 2.5, 2.0],
  ["Germany", "🇩🇪", "EMEA", "DEUCPIALLMINMEI", 2.2, 2.0],
  ["France", "🇫🇷", "EMEA", "FRACPIALLMINMEI", 1.8, 2.0],
  ["Italy", "🇮🇹", "EMEA", "ITACPIALLMINMEI", 1.9, 2.0],
  ["Canada", "🇨🇦", "AMER", "CANCPIALLMINMEI", 2.0, 2.0],
  ["China", "🇨🇳", "APAC", "CHNCPIALLMINMEI", 0.6, 3.0],
  ["India", "🇮🇳", "APAC", "INDCPIALLMINMEI", 4.2, 4.0],
  ["Brazil", "🇧🇷", "AMER", "BRACPIALLMINMEI", 4.5, 3.0],
  ["Mexico", "🇲🇽", "AMER", "MEXCPIALLMINMEI", 3.8, 3.0],
  ["Australia", "🇦🇺", "APAC", "AUSCPIALLQINMEI", 2.9, 2.5],
  ["South Korea", "🇰🇷", "APAC", "KORCPIALLMINMEI", 2.0, 2.0],
  ["Switzerland", "🇨🇭", "EMEA", "CHECPIALLMINMEI", 0.6, 2.0],
  ["Spain", "🇪🇸", "EMEA", "ESPCPIALLMINMEI", 2.3, 2.0],
  ["Turkey", "🇹🇷", "EMEA", "TURCPIALLMINMEI", 32.0, 5.0],
  ["Indonesia", "🇮🇩", "APAC", "IDNCPIALLMINMEI", 2.7, 3.0],
  ["South Africa", "🇿🇦", "EMEA", "ZAFCPIALLMINMEI", 4.4, 4.5],
  ["Saudi Arabia", "🇸🇦", "EMEA", "SAUCPIALLMINMEI", 1.9, 2.0],
];


const RATE_ISO: Record<string, string> = {
  "United States": "USA",
  "Euro Area": "EMU",
  "United Kingdom": "GBR",
  Japan: "JPN",
  Canada: "CAN",
  Australia: "AUS",
  Switzerland: "CHE",
  China: "CHN",
  India: "IND",
  Brazil: "BRA",
  Mexico: "MEX",
  "South Korea": "KOR",
  Sweden: "SWE",
  Norway: "NOR",
  "New Zealand": "NZL",
  Turkey: "TUR",
  Indonesia: "IDN",
  "South Africa": "ZAF",
};

const CPI_ISO: Record<string, string> = {
  "United States": "USA",
  "Euro Area": "EMU",
  "United Kingdom": "GBR",
  Japan: "JPN",
  Germany: "DEU",
  France: "FRA",
  Italy: "ITA",
  Canada: "CAN",
  China: "CHN",
  India: "IND",
  Brazil: "BRA",
  Mexico: "MEX",
  Australia: "AUS",
  "South Korea": "KOR",
  Switzerland: "CHE",
  Spain: "ESP",
  Turkey: "TUR",
  Indonesia: "IDN",
  "South Africa": "ZAF",
  "Saudi Arabia": "SAU",
};

/** ISO3 code for a country name used in the CPI or policy-rate tables. */
export function countryIso3(country: string): string | undefined {
  return CPI_ISO[country] ?? RATE_ISO[country];
}

// country, flag, region, central bank, current rate, bias dir (-1 cut/+1 hike/0 hold), FRED id
const RATE_DEFS: [string, string, Region, string, number, number, string | undefined][] = [
  ["United States", "🇺🇸", "AMER", "Federal Reserve", 4.13, -1, "IRSTCB01USM156N"],
  ["Euro Area", "🇪🇺", "EMEA", "ECB", 2.15, -1, "ECBDFR"],
  ["United Kingdom", "🇬🇧", "EMEA", "Bank of England", 4.00, -1, "IRSTCB01GBM156N"],
  ["Japan", "🇯🇵", "APAC", "Bank of Japan", 0.75, 1, "IRSTCB01JPM156N"],
  ["Canada", "🇨🇦", "AMER", "Bank of Canada", 2.50, -1, "IRSTCB01CAM156N"],
  ["Australia", "🇦🇺", "APAC", "Reserve Bank of Australia", 3.60, -1, "IRSTCB01AUM156N"],
  ["Switzerland", "🇨🇭", "EMEA", "Swiss National Bank", 0.25, -1, "IRSTCB01CHM156N"],
  ["China", "🇨🇳", "APAC", "People's Bank of China", 2.90, -1, undefined],
  ["India", "🇮🇳", "APAC", "Reserve Bank of India", 5.50, -1, undefined],
  ["Brazil", "🇧🇷", "AMER", "Banco Central do Brasil", 12.00, 1, "IRSTCB01BRM156N"],
  ["Mexico", "🇲🇽", "AMER", "Banco de México", 7.75, -1, "IRSTCB01MXM156N"],
  ["South Korea", "🇰🇷", "APAC", "Bank of Korea", 2.50, -1, "IRSTCB01KRM156N"],
  ["Sweden", "🇸🇪", "EMEA", "Riksbank", 2.00, 0, "IRSTCB01SEM156N"],
  ["Norway", "🇳🇴", "EMEA", "Norges Bank", 4.00, -1, "IRSTCB01NOM156N"],
  ["New Zealand", "🇳🇿", "APAC", "Reserve Bank of NZ", 3.25, -1, "IRSTCB01NZM156N"],
  ["Turkey", "🇹🇷", "EMEA", "CBRT", 42.00, -1, "IRSTCB01TRM156N"],
  ["Indonesia", "🇮🇩", "APAC", "Bank Indonesia", 5.25, -1, undefined],
  ["South Africa", "🇿🇦", "EMEA", "South African Reserve Bank", 7.25, -1, undefined],
];

function trendOf(curr: number, prev: number): Trend {
  if (curr > prev + 0.05) return "RISING";
  if (curr < prev - 0.05) return "FALLING";
  return "FLAT";
}

export function getGlobalCPI(): CountryInflation[] {
  return CPI_DEFS.map(([country, flag, region, fredId, yoy, target]) => {
    const rng = new Rng(`gcpi-${country}`);
    // build recent YoY history walking back toward higher (disinflation) with noise
    const hist: number[] = [];
    let v = yoy;
    for (let i = 0; i < 10; i++) {
      hist.unshift(Number(v.toFixed(1)));
      v = v + rng.float(0.0, 0.35) * (country === "Turkey" ? 4 : 1) + rng.normal(0, 0.12);
    }
    hist.push(Number(yoy.toFixed(1)));
    const priorYoy = hist[hist.length - 2];
    const trend = trendOf(yoy, priorYoy);
    // streak: count consecutive same-direction moves at the tail
    let streak = 1;
    for (let i = hist.length - 1; i > 0; i--) {
      const t = trendOf(hist[i], hist[i - 1]);
      if (t === trend && t !== "FLAT") streak++;
      else break;
    }
    return {
      country, flag, region, fredId,
      yoy, priorYoy,
      mom: Number((yoy / 12 + rng.normal(0, 0.1)).toFixed(2)),
      momDelta: Number(rng.normal(0, 0.08).toFixed(2)),
      yoyDelta: Number((yoy - priorYoy).toFixed(2)),
      trend,
      streak: trend === "FLAT" ? 0 : streak,
      target,
      vsTarget: Number((yoy - target).toFixed(1)),
      history: hist,
      source: "SIM" as const,
      asOf: null,
    };
  });
}

function etlRowFor(base: CountryInflation): EtlCountryMacro | undefined {
  const iso = CPI_ISO[base.country];
  if (!iso) return undefined;
  return etlCountryMacro.find((r) => r.country_iso3 === iso);
}

function etlHistory(iso: string): number[] {
  return etlInflationTimeseries
    .map((r) => (typeof r[iso] === "number" ? Number(r[iso]) : null))
    .filter((v): v is number => v != null && Number.isFinite(v))
    .slice(-12)
    .map((v) => Number(v.toFixed(1)));
}

export function getEtlInflationObservations(fredId: string, n?: number): { date: string; value: number }[] | null {
  const iso = Object.entries(CPI_ISO).find(([country]) => CPI_DEFS.some(([name, , , id]) => name === country && id === fredId))?.[1];
  if (!iso) return null;
  const obs = etlInflationTimeseries
    .map((r) => (typeof r[iso] === "number" ? { date: String(r.date), value: Number(Number(r[iso]).toFixed(2)) } : null))
    .filter((v): v is { date: string; value: number } => v != null);
  if (!obs.length) return null;
  return typeof n === "number" && n < obs.length ? obs.slice(obs.length - n) : obs;
}

/** Overlay the committed macro ETL gold snapshot before falling back to SIM. */
export function etlCountryCPI(base: CountryInflation): CountryInflation {
  const row = etlRowFor(base);
  if (!row || row.cpi_yoy == null) return base;
  const yoy = Number(row.cpi_yoy.toFixed(1));
  const priorYoy = row.cpi_prior != null ? Number(row.cpi_prior.toFixed(1)) : base.priorYoy;
  const trend = row.cpi_trend === "RISING" || row.cpi_trend === "FALLING" || row.cpi_trend === "FLAT" ? row.cpi_trend : trendOf(yoy, priorYoy);
  const history = etlHistory(row.country_iso3);
  return {
    ...base,
    yoy,
    priorYoy,
    mom: null,
    momDelta: null,
    yoyDelta: Number((yoy - priorYoy).toFixed(2)),
    trend,
    streak: row.cpi_streak ?? (trend === "FLAT" ? 0 : 1),
    target: row.vs_target != null ? Number((yoy - row.vs_target).toFixed(1)) : base.target,
    vsTarget: row.vs_target != null ? Number(row.vs_target.toFixed(1)) : Number((yoy - base.target).toFixed(1)),
    history: history.length >= 2 ? history : base.history,
    source: "ETL",
    asOf: row.last_updated,
  };
}

/**
 * Recompute a country's CPI row from a live FRED *index-level* series (units=lin):
 * derives YoY, MoM, trend-vs-prior, the consecutive-print streak and the YoY
 * sparkline. Falls back to the simulation `base` when history is too short.
 */
export function liveCountryCPI(base: CountryInflation, obs: { date: string; value: number }[]): CountryInflation {
  const v = obs.map((o) => o.value);
  const isQuarterly = base.fredId.includes("QINMEI") || base.fredId.includes("QOQ");
  const yoyLag = isQuarterly ? 4 : 12;
  if (v.length < yoyLag + 2) return base;
  const pct = (a: number, b: number, dp = 1) => (b ? Number(((a / b - 1) * 100).toFixed(dp)) : 0);
  const yoyArr: number[] = [];
  for (let i = yoyLag; i < v.length; i++) yoyArr.push(pct(v[i], v[i - yoyLag]));
  if (yoyArr.length < 2) return base;
  const yoy = yoyArr[yoyArr.length - 1];
  const priorYoy = yoyArr[yoyArr.length - 2];
  const mom = isQuarterly ? null : pct(v[v.length - 1], v[v.length - 2], 2);
  const priorMom = isQuarterly ? null : (v.length >= 3 ? pct(v[v.length - 2], v[v.length - 3], 2) : null);
  const trend = trendOf(yoy, priorYoy);
  let streak = 1;
  for (let i = yoyArr.length - 1; i > 0; i--) {
    const t = trendOf(yoyArr[i], yoyArr[i - 1]);
    if (t === trend && t !== "FLAT") streak++;
    else break;
  }
  return {
    ...base,
    yoy, priorYoy,
    mom,
    momDelta: mom == null || priorMom == null ? null : Number((mom - priorMom).toFixed(2)),
    yoyDelta: Number((yoy - priorYoy).toFixed(2)),
    trend,
    streak: trend === "FLAT" ? 0 : streak,
    vsTarget: Number((yoy - base.target).toFixed(1)),
    history: yoyArr.slice(-11),
    asOf: obs[obs.length - 1]?.date ?? base.asOf,
  };
}

export function getGlobalPolicyRates(): PolicyRate[] {
  const cpi = getGlobalCPI();
  return RATE_DEFS.map(([country, flag, region, centralBank, rate, dir, fredId]) => {
    const rng = new Rng(`grate-${country}`);
    const cycle: PolicyRate["cycle"] = dir > 0 ? "HIKING" : dir < 0 ? "CUTTING" : "HOLD";
    const step = country === "Turkey" || country === "Brazil" ? 2.5 : 0.25;
    // history of recent rates
    const hist: number[] = [];
    let v = rate;
    const nMoves = rng.int(2, 5);
    for (let i = 0; i < 8; i++) {
      hist.unshift(Number(v.toFixed(2)));
      if (i < nMoves) v = v - dir * step * (rng.bool(0.7) ? 1 : 0);
    }
    hist.push(Number(rate.toFixed(2)));
    const priorRate = hist[hist.length - 2];
    const lastMoveBps = Math.round((rate - priorRate) * 100);
    let streak = 0;
    for (let i = hist.length - 1; i > 0; i--) {
      const d = hist[i] - hist[i - 1];
      const act = d > 0.01 ? 1 : d < -0.01 ? -1 : 0;
      if (act === dir) streak++;
      else if (act === 0 && cycle === "HOLD") streak++;
      else break;
    }
    const cpiYoY = cpi.find((c) => c.country === country)?.yoy ?? 2;
    const realRate = rate - cpiYoY;
    const bias: PolicyRate["bias"] = realRate > 1.5 ? "HAWKISH" : realRate < 0 ? "DOVISH" : "NEUTRAL";
    return {
      country, flag, region, centralBank,
      rate, priorRate, lastMoveBps,
      // No approved global central-bank meeting calendar is connected yet.
      // Never present generated dates as scheduled meetings.
      lastMeeting: "—",
      cycle,
      streak: Math.max(1, streak),
      nextMeeting: "—",
      realRate: Number(realRate.toFixed(1)),
      bias,
      history: hist,
      fredId,
      source: "SIM" as const,
      asOf: null,
      rateAsOf: null,
      decisionDate: null,
      decisionSource: "UNAVAILABLE" as const,
    };
  }).sort((a, b) => b.rate - a.rate);
}


function etlRateRowFor(base: PolicyRate): EtlCountryMacro | undefined {
  const iso = RATE_ISO[base.country];
  if (!iso) return undefined;
  return etlCountryMacro.find((r) => r.country_iso3 === iso);
}

function rateCycleFromEtl(cycle: string | null): PolicyRate["cycle"] | null {
  if (cycle === "RISING") return "HIKING";
  if (cycle === "FALLING") return "CUTTING";
  if (cycle === "FLAT") return "HOLD";
  return null;
}

/** Overlay the committed macro ETL gold snapshot before falling back to SIM. */
export function etlPolicyRate(base: PolicyRate): PolicyRate {
  const row = etlRateRowFor(base);
  if (!row || row.policy_rate == null) return base;
  const rate = Number(row.policy_rate.toFixed(2));
  const priorRate = row.rate_prior != null ? Number(row.rate_prior.toFixed(2)) : base.priorRate;
  const cycle = rateCycleFromEtl(row.rate_cycle) ?? (rate > priorRate ? "HIKING" : rate < priorRate ? "CUTTING" : "HOLD");
  const realRate = row.real_rate != null ? Number(row.real_rate.toFixed(1)) : Number((rate - (base.rate - base.realRate)).toFixed(1));
  const bias: PolicyRate["bias"] = realRate > 1.5 ? "HAWKISH" : realRate < 0 ? "DOVISH" : "NEUTRAL";
  const history = [...base.history.slice(0, -1), priorRate, rate].slice(-10);
  return {
    ...base,
    rate,
    priorRate,
    lastMoveBps: Math.round((rate - priorRate) * 100),
    cycle,
    streak: Math.max(1, row.rate_streak ?? base.streak),
    realRate,
    bias,
    history,
    source: "ETL",
    asOf: row.last_updated,
  };
}

/**
 * Recompute a central bank's policy-rate row from a live FRED rate series
 * (units lin, %). Derives the current level, last move, cycle, streak and real
 * rate (vs the simulated CPI). Falls back to `base` when history is too short.
 */
export function livePolicyRate(base: PolicyRate, obs: { date: string; value: number }[]): PolicyRate {
  const v = obs.map((o) => o.value);
  if (v.length < 2) return base;
  const rate = Number(v[v.length - 1].toFixed(2));
  const priorRate = Number(v[v.length - 2].toFixed(2));
  let dir = 0;
  for (let i = v.length - 1; i > 0; i--) {
    const d = v[i] - v[i - 1];
    if (Math.abs(d) > 0.005) { dir = d > 0 ? 1 : -1; break; }
  }
  const cycle: PolicyRate["cycle"] = dir > 0 ? "HIKING" : dir < 0 ? "CUTTING" : "HOLD";
  let streak = 0;
  for (let i = v.length - 1; i > 0; i--) {
    const d = v[i] - v[i - 1];
    const act = d > 0.005 ? 1 : d < -0.005 ? -1 : 0;
    if (act === dir && dir !== 0) streak++;
    else if (act === 0 && dir === 0) streak++;
    else break;
  }
  const cpi = base.rate - base.realRate; // implied CPI from the base row
  const realRate = Number((rate - cpi).toFixed(1));
  const bias: PolicyRate["bias"] = realRate > 1.5 ? "HAWKISH" : realRate < 0 ? "DOVISH" : "NEUTRAL";
  return {
    ...base,
    rate, priorRate,
    lastMoveBps: Math.round((rate - priorRate) * 100),
    cycle,
    streak: Math.max(1, streak),
    realRate, bias,
    history: v.map((x) => Number(x.toFixed(2))),
    source: obs.length ? ("FRED" as const) : base.source,
    asOf: obs[obs.length - 1]?.date ?? base.asOf,
  };
}

export interface GlobalSummary {
  avgCpi: number;
  medianCpi: number;
  aboveTarget: number;
  risingCount: number;
  fallingCount: number;
  avgPolicyRate: number;
  cuttingCount: number;
  hikingCount: number;
  holdCount: number;
}

export function getGlobalSummary(): GlobalSummary {
  const cpi = getGlobalCPI();
  const rates = getGlobalPolicyRates().map(etlPolicyRate);
  const ys = cpi.map((c) => c.yoy).sort((a, b) => a - b);
  return {
    avgCpi: Number((cpi.reduce((a, c) => a + c.yoy, 0) / cpi.length).toFixed(1)),
    medianCpi: ys[Math.floor(ys.length / 2)],
    aboveTarget: cpi.filter((c) => c.vsTarget > 0).length,
    risingCount: cpi.filter((c) => c.trend === "RISING").length,
    fallingCount: cpi.filter((c) => c.trend === "FALLING").length,
    avgPolicyRate: Number((rates.reduce((a, r) => a + r.rate, 0) / rates.length).toFixed(2)),
    cuttingCount: rates.filter((r) => r.cycle === "CUTTING").length,
    hikingCount: rates.filter((r) => r.cycle === "HIKING").length,
    holdCount: rates.filter((r) => r.cycle === "HOLD").length,
  };
}
