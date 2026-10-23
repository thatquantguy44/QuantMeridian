/**
 * VIX implied 30-day move versus the S&P 500's realized 30-day forward move (VIXR).
 *
 * The VIX is the market's annualized expectation of S&P 500 volatility over the next 30 calendar days, so on each
 * date it implies a one-standard-deviation 30-day log move of VIX × √(30/365). Each observation pairs that implied
 * move with what the index then did over the following 30 calendar days, and the statistics ask three questions:
 *
 * 1. Calibration: how often did the realized move land inside ±1σ and ±2σ, against 68.3% and 95.4% for a normal?
 * 2. Magnitude: does a higher VIX forecast a larger move and higher subsequent realized volatility?
 * 3. Direction: does the VIX level forecast the sign or size of the forward return?
 *
 * Pure functions only: the route supplies raw Gold series and the page recomputes on every control change.
 */

export type SeriesTuple = [date: string, value: number];
export type VixForwardBasis = "spy_price" | "spy_total" | "sp500_index";
export type VixForwardSampling = "daily" | "monthly";
export type VixBucketScheme = "regime" | "quintile";

/** VIX measures expected volatility over 30 calendar days. */
export const HORIZON_DAYS = 30;
export const TRADING_DAYS_PER_YEAR = 252;
/** Trading days in a 30-calendar-day window; daily windows overlap by up to this many returns. */
export const OVERLAP_LAG = 21;
/** Newey–West lags for non-overlapping windows, which still share volatility persistence. */
export const NON_OVERLAP_LAG = 3;
/** A window whose last trading day is further than this from its 30-day target is a data gap, not a holiday. */
export const MAX_ENDPOINT_GAP_DAYS = 5;
export const MIN_OBSERVATIONS = 10;

/** Shares under a normal distribution, used as the calibration benchmark. */
export const NORMAL_BENCHMARK = { within1: 68.27, within2: 95.45, beyondMinus2: 2.28, beyondPlus2: 2.28 } as const;

export const BASIS_OPTIONS: { id: VixForwardBasis; label: string; short: string; desc: string }[] = [
  { id: "spy_price", label: "SPY price (1993+)", short: "SPY PX", desc: "SPY close, excluding dividends: the closest long-history match to the S&P 500 price index the VIX is written on" },
  { id: "spy_total", label: "SPY total return (1993+)", short: "SPY TR", desc: "SPY with dividends reinvested" },
  { id: "sp500_index", label: "S&P 500 index (FRED, 2016+)", short: "SPX", desc: "The index itself; FRED licenses only the latest ten years" },
];

const DAY_MS = 86_400_000;
const HORIZON_FRACTION = Math.sqrt(HORIZON_DAYS / 365);

export interface ForwardObservation {
  date: string;
  /** Last trading day on or before date + 30 calendar days. */
  endDate: string;
  vix: number;
  /** One-standard-deviation 30-day log move implied by the VIX, in percent. */
  impliedMovePct: number;
  forwardReturnPct: number;
  forwardLogReturnPct: number;
  /** Forward log return in implied standard deviations. */
  z: number;
  /** Annualized realized volatility of daily log returns inside the window, in vol points. */
  realizedVolPct: number;
  /** Realized volatility over the 30 calendar days before the date: the naive forecast the VIX must beat. Null without a full lookback. */
  trailingVolPct: number | null;
  tradingDays: number;
}

export interface CurrentReading {
  date: string;
  vix: number;
  impliedMovePct: number;
  /** Price-level band for ±1σ, in percent: exp(±σ) − 1. */
  upMovePct: number;
  downMovePct: number;
  horizonEnd: string;
}

export interface AlignDiagnostics {
  vixRows: number;
  priceRows: number;
  invalidRows: number;
  priceDatesWithoutVix: number;
  incompleteWindows: number;
  endpointGaps: number;
}

export interface AlignResult {
  observations: ForwardObservation[];
  current: CurrentReading | null;
  diagnostics: AlignDiagnostics;
}

const dayMs = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** YYYY-MM-DD that is a real calendar day (rejects 2020-13-01 and 2021-02-30). */
const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && isoDay(dayMs(value)) === value;
export const addDays = (date: string, days: number) => isoDay(dayMs(date) + days * DAY_MS);

/** One-standard-deviation 30-day log move implied by a VIX level, in percent. */
export function impliedMovePct(vix: number): number {
  return vix * HORIZON_FRACTION;
}

function cleanSeries(series: SeriesTuple[]): { rows: SeriesTuple[]; invalid: number } {
  const byDate = new Map<string, number>();
  let invalid = 0;
  for (const [date, value] of series) {
    if (typeof date !== "string" || !isIsoDate(date) || !Number.isFinite(value) || value <= 0) { invalid++; continue; }
    byDate.set(date, value);
  }
  const rows = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { rows, invalid };
}

/** Pair each date's VIX with the index's next 30 calendar days. Windows that run past the data are left out. */
export function alignForward(vix: SeriesTuple[], price: SeriesTuple[]): AlignResult {
  const cleanVix = cleanSeries(vix);
  const cleanPrice = cleanSeries(price);
  const vixByDate = new Map(cleanVix.rows);
  const px = cleanPrice.rows;
  const ms = px.map(([date]) => dayMs(date));
  const diagnostics: AlignDiagnostics = {
    vixRows: cleanVix.rows.length,
    priceRows: px.length,
    invalidRows: cleanVix.invalid + cleanPrice.invalid,
    priceDatesWithoutVix: 0,
    incompleteWindows: 0,
    endpointGaps: 0,
  };

  // Prefix sums of squared daily log returns give each window's realized variance in O(1).
  const squared = new Float64Array(px.length);
  for (let k = 1; k < px.length; k++) {
    const r = Math.log(px[k][1] / px[k - 1][1]);
    squared[k] = squared[k - 1] + r * r;
  }

  const observations: ForwardObservation[] = [];
  const lastMs = ms.length ? ms[ms.length - 1] : Number.NEGATIVE_INFINITY;
  let j = 0;
  let k = 0;
  for (let i = 0; i < px.length; i++) {
    const level = vixByDate.get(px[i][0]);
    if (level === undefined) { diagnostics.priceDatesWithoutVix++; continue; }
    const target = ms[i] + HORIZON_DAYS * DAY_MS;
    if (lastMs < target) { diagnostics.incompleteWindows++; continue; }
    if (j < i) j = i;
    while (j + 1 < px.length && ms[j + 1] <= target) j++;
    if (j <= i || target - ms[j] > MAX_ENDPOINT_GAP_DAYS * DAY_MS) { diagnostics.endpointGaps++; continue; }

    const logReturn = Math.log(px[j][1] / px[i][1]);
    const sigma = impliedMovePct(level);
    const days = j - i;
    const lookbackStart = ms[i] - HORIZON_DAYS * DAY_MS;
    while (ms[k] < lookbackStart) k++;
    const trailingDays = i - k;
    const trailingVolPct = ms[0] <= lookbackStart && trailingDays >= 10
      ? Math.sqrt((TRADING_DAYS_PER_YEAR * (squared[i] - squared[k])) / trailingDays) * 100
      : null;
    observations.push({
      date: px[i][0],
      endDate: px[j][0],
      vix: level,
      impliedMovePct: sigma,
      forwardReturnPct: (Math.exp(logReturn) - 1) * 100,
      forwardLogReturnPct: logReturn * 100,
      z: (logReturn * 100) / sigma,
      realizedVolPct: Math.sqrt((TRADING_DAYS_PER_YEAR * (squared[j] - squared[i])) / days) * 100,
      trailingVolPct,
      tradingDays: days,
    });
  }

  const latest = cleanVix.rows[cleanVix.rows.length - 1];
  const current: CurrentReading | null = latest ? (() => {
    const sigma = impliedMovePct(latest[1]);
    return {
      date: latest[0],
      vix: latest[1],
      impliedMovePct: sigma,
      upMovePct: (Math.exp(sigma / 100) - 1) * 100,
      downMovePct: (Math.exp(-sigma / 100) - 1) * 100,
      horizonEnd: addDays(latest[0], HORIZON_DAYS),
    };
  })() : null;

  return { observations, current, diagnostics };
}

/** Date filter, then (for monthly sampling) keep only windows that start on or after the previous window ends. */
export function selectObservations(
  observations: ForwardObservation[],
  { start, end, sampling }: { start?: string; end?: string; sampling: VixForwardSampling },
): ForwardObservation[] {
  const inRange = observations.filter((o) => (!start || o.date >= start) && (!end || o.date <= end));
  if (sampling === "daily") return inRange;
  const out: ForwardObservation[] = [];
  let nextStart = "";
  for (const o of inRange) {
    if (o.date < nextStart) continue;
    out.push(o);
    nextStart = o.endDate;
  }
  return out;
}

// ── Statistics ──────────────────────────────────────────────────────────────

export interface OlsResult {
  n: number;
  alpha: number;
  beta: number;
  r2: number;
  seAlpha: number;
  seBeta: number;
  tAlpha: number;
  tBeta: number;
  /** Newey–West lag used for the standard errors. */
  lag: number;
}

/** OLS of y on x with Newey–West (Bartlett kernel) standard errors. */
export function ols(x: number[], y: number[], lag: number): OlsResult | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  let sx = 0, sy = 0;
  for (let t = 0; t < n; t++) { sx += x[t]; sy += y[t]; }
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let t = 0; t < n; t++) {
    const dx = x[t] - mx, dy = y[t] - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  if (sxx <= 0) return null;
  const beta = sxy / sxx;
  const alpha = my - beta * mx;
  const residuals = new Float64Array(n);
  let sse = 0;
  for (let t = 0; t < n; t++) { residuals[t] = y[t] - alpha - beta * x[t]; sse += residuals[t] * residuals[t]; }
  const r2 = syy > 0 ? 1 - sse / syy : 0;

  // Sandwich on centered regressors [1, x − x̄], so the slope variance is S_bb / sxx² and the intercept follows.
  const L = Math.max(0, Math.min(lag, n - 1));
  let s00 = 0, s01 = 0, s11 = 0;
  for (let t = 0; t < n; t++) {
    const e = residuals[t], dx = x[t] - mx;
    s00 += e * e; s01 += e * e * dx; s11 += e * e * dx * dx;
  }
  for (let l = 1; l <= L; l++) {
    const w = 1 - l / (L + 1);
    let a00 = 0, a01 = 0, a11 = 0;
    for (let t = l; t < n; t++) {
      const ee = residuals[t] * residuals[t - l];
      const d0 = x[t] - mx, d1 = x[t - l] - mx;
      a00 += ee; a01 += ee * (d0 + d1) / 2; a11 += ee * d0 * d1;
    }
    s00 += 2 * w * a00; s01 += 2 * w * a01; s11 += 2 * w * a11;
  }
  const varBeta = Math.max(s11, 0) / (sxx * sxx);
  const varIntercept = Math.max(s00, 0) / (n * n);
  const cov = s01 / (n * sxx);
  const varAlpha = Math.max(varIntercept - 2 * mx * cov + mx * mx * varBeta, 0);
  const seBeta = Math.sqrt(varBeta);
  const seAlpha = Math.sqrt(varAlpha);
  return {
    n, alpha, beta, r2, seAlpha, seBeta, lag: L,
    tAlpha: seAlpha > 0 ? alpha / seAlpha : 0,
    tBeta: seBeta > 0 ? beta / seBeta : 0,
  };
}

export function pearson(x: number[], y: number[]): number | null {
  const fit = ols(x, y, 0);
  if (!fit) return null;
  const r = Math.sqrt(Math.max(fit.r2, 0));
  return fit.beta >= 0 ? r : -r;
}

function ranks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = rank;
    i = j + 1;
  }
  return out;
}

export function spearman(x: number[], y: number[]): number | null {
  return pearson(ranks(x), ranks(y));
}

export interface RateStat {
  pct: number;
  ciLow: number;
  ciHigh: number;
  expectedPct: number;
}

/** Share with a Wilson 95% interval computed on an effective (independent) sample size. */
export function wilsonRate(hits: number, n: number, effectiveN: number, expectedPct: number): RateStat {
  const p = n > 0 ? hits / n : 0;
  const m = Math.max(effectiveN, 1);
  const z = 1.96;
  const denom = 1 + (z * z) / m;
  const centre = (p + (z * z) / (2 * m)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / m + (z * z) / (4 * m * m))) / denom;
  return { pct: p * 100, ciLow: Math.max(0, centre - half) * 100, ciHigh: Math.min(1, centre + half) * 100, expectedPct };
}

const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Linear-interpolated quantile, q in [0, 1]. */
export function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface BucketStats {
  id: string;
  label: string;
  /** Inclusive lower VIX bound; null for the open-ended first bucket. */
  lo: number | null;
  /** Exclusive upper VIX bound; null for the open-ended last bucket. */
  hi: number | null;
  n: number;
  meanVix: number;
  meanImpliedMovePct: number;
  meanForwardReturnPct: number;
  medianForwardReturnPct: number;
  pctPositive: number;
  meanAbsReturnPct: number;
  meanRealizedVolPct: number;
  /** Mean realized volatility ÷ mean VIX in the bucket; below 1 means the VIX overstated what followed. */
  realizedToImplied: number;
  within1Pct: number;
  worstReturnPct: number;
  bestReturnPct: number;
}

export const REGIME_EDGES = [15, 20, 25, 30, 40] as const;

function bucketOf(vix: number, edges: readonly number[]): number {
  let k = 0;
  while (k < edges.length && vix >= edges[k]) k++;
  return k;
}

function summarizeBucket(id: string, label: string, lo: number | null, hi: number | null, rows: ForwardObservation[]): BucketStats {
  const vix = mean(rows.map((o) => o.vix));
  const rv = mean(rows.map((o) => o.realizedVolPct));
  const returns = rows.map((o) => o.forwardReturnPct);
  return {
    id, label, lo, hi, n: rows.length,
    meanVix: vix,
    meanImpliedMovePct: mean(rows.map((o) => o.impliedMovePct)),
    meanForwardReturnPct: mean(returns),
    medianForwardReturnPct: median(returns),
    pctPositive: (rows.filter((o) => o.forwardReturnPct > 0).length / rows.length) * 100,
    meanAbsReturnPct: mean(rows.map((o) => Math.abs(o.forwardReturnPct))),
    meanRealizedVolPct: rv,
    realizedToImplied: rv / vix,
    within1Pct: (rows.filter((o) => Math.abs(o.z) <= 1).length / rows.length) * 100,
    worstReturnPct: Math.min(...returns),
    bestReturnPct: Math.max(...returns),
  };
}

const fmtEdge = (v: number) => (Math.round(v * 10) / 10).toString();

export function bucketize(observations: ForwardObservation[], scheme: VixBucketScheme): BucketStats[] {
  if (!observations.length) return [];
  let edges: number[];
  let labels: string[];
  if (scheme === "regime") {
    edges = [...REGIME_EDGES];
    labels = ["VIX < 15", "15–20", "20–25", "25–30", "30–40", "VIX ≥ 40"];
  } else {
    const levels = observations.map((o) => o.vix);
    edges = [0.2, 0.4, 0.6, 0.8].map((q) => quantile(levels, q));
    const lo = Math.min(...levels), hi = Math.max(...levels);
    const bounds = [lo, ...edges, hi];
    labels = bounds.slice(0, 5).map((b, k) => `Q${k + 1} · ${fmtEdge(b)}–${fmtEdge(bounds[k + 1])}`);
  }
  const groups: ForwardObservation[][] = labels.map(() => []);
  for (const o of observations) groups[bucketOf(o.vix, edges)].push(o);
  const bounds: (number | null)[] = [null, ...edges, null];
  return groups
    .map((rows, k) => (rows.length ? summarizeBucket(`${scheme}-${k}`, labels[k], bounds[k], bounds[k + 1], rows) : null))
    .filter((b): b is BucketStats => b !== null);
}

export interface VixForwardStats {
  n: number;
  /** Approximate number of independent 30-day windows behind the statistics. */
  effectiveN: number;
  sampling: VixForwardSampling;
  lag: number;
  start: string;
  end: string;
  meanVix: number;
  meanImpliedMovePct: number;
  meanForwardReturnPct: number;
  medianForwardReturnPct: number;
  pctPositive: number;
  calibration: {
    within1: RateStat;
    within2: RateStat;
    beyondMinus2: RateStat;
    beyondPlus2: RateStat;
    zMean: number;
    zStd: number;
    zExcessKurtosis: number;
  };
  vol: {
    meanRealizedVolPct: number;
    /** Mean realized ÷ mean VIX. */
    ratio: number;
    medianRatio: number;
    /** Mean VIX − subsequent realized volatility, in vol points: the variance risk premium. */
    meanPremiumPts: number;
    pctVixAboveRealized: number;
  };
  magnitude: {
    /** Mincer–Zarnowitz: realized vol = α + β·VIX. An unbiased forecast has α = 0 and β = 1. */
    realizedOnVix: OlsResult | null;
    absReturnOnImplied: OlsResult | null;
    spearmanVixAbsReturn: number | null;
    /** Same-date comparison with trailing 30-day realized volatility as the forecast. */
    benchmark: { n: number; vixR2: number; trailingR2: number; trailing: OlsResult } | null;
  };
  direction: {
    returnOnVix: OlsResult | null;
    correlation: number | null;
  };
  buckets: BucketStats[];
}

export function computeVixForwardStats(
  observations: ForwardObservation[],
  { sampling, scheme }: { sampling: VixForwardSampling; scheme: VixBucketScheme },
): VixForwardStats | null {
  const n = observations.length;
  if (n < MIN_OBSERVATIONS) return null;
  const lag = sampling === "daily" ? OVERLAP_LAG : NON_OVERLAP_LAG;
  const effectiveN = sampling === "daily" ? Math.max(1, Math.round(n / OVERLAP_LAG)) : n;
  const z = observations.map((o) => o.z);
  const count = (pred: (v: number) => boolean) => z.filter(pred).length;
  const zMean = mean(z);
  const zVar = mean(z.map((v) => (v - zMean) ** 2));
  const zStd = Math.sqrt(zVar);
  const zKurt = zVar > 0 ? mean(z.map((v) => (v - zMean) ** 4)) / (zVar * zVar) - 3 : 0;
  const vix = observations.map((o) => o.vix);
  const rv = observations.map((o) => o.realizedVolPct);
  const returns = observations.map((o) => o.forwardReturnPct);
  const meanVix = mean(vix);
  const meanRv = mean(rv);
  const paired = observations.filter((o) => o.trailingVolPct !== null);
  const vixFit = ols(paired.map((o) => o.vix), paired.map((o) => o.realizedVolPct), lag);
  const trailingFit = ols(paired.map((o) => o.trailingVolPct as number), paired.map((o) => o.realizedVolPct), lag);
  const benchmark = vixFit && trailingFit ? { n: paired.length, vixR2: vixFit.r2, trailingR2: trailingFit.r2, trailing: trailingFit } : null;

  return {
    n, effectiveN, sampling, lag,
    start: observations[0].date,
    end: observations[n - 1].date,
    meanVix,
    meanImpliedMovePct: mean(observations.map((o) => o.impliedMovePct)),
    meanForwardReturnPct: mean(returns),
    medianForwardReturnPct: median(returns),
    pctPositive: (returns.filter((r) => r > 0).length / n) * 100,
    calibration: {
      within1: wilsonRate(count((v) => Math.abs(v) <= 1), n, effectiveN, NORMAL_BENCHMARK.within1),
      within2: wilsonRate(count((v) => Math.abs(v) <= 2), n, effectiveN, NORMAL_BENCHMARK.within2),
      beyondMinus2: wilsonRate(count((v) => v < -2), n, effectiveN, NORMAL_BENCHMARK.beyondMinus2),
      beyondPlus2: wilsonRate(count((v) => v > 2), n, effectiveN, NORMAL_BENCHMARK.beyondPlus2),
      zMean, zStd, zExcessKurtosis: zKurt,
    },
    vol: {
      meanRealizedVolPct: meanRv,
      ratio: meanRv / meanVix,
      medianRatio: median(observations.map((o) => o.realizedVolPct / o.vix)),
      meanPremiumPts: meanVix - meanRv,
      pctVixAboveRealized: (observations.filter((o) => o.vix > o.realizedVolPct).length / n) * 100,
    },
    magnitude: {
      realizedOnVix: ols(vix, rv, lag),
      absReturnOnImplied: ols(observations.map((o) => o.impliedMovePct), returns.map((r) => Math.abs(r)), lag),
      spearmanVixAbsReturn: spearman(vix, returns.map((r) => Math.abs(r))),
      benchmark,
    },
    direction: {
      returnOnVix: ols(vix, returns, lag),
      correlation: pearson(vix, returns),
    },
    buckets: bucketize(observations, scheme),
  };
}

// ── Readout ─────────────────────────────────────────────────────────────────

export type PredictiveGrade = "strong" | "moderate" | "weak" | "none";

export interface VixForwardReadout {
  magnitudeGrade: PredictiveGrade;
  magnitude: string;
  calibration: string;
  tails: string;
  direction: string;
  directionSignificant: boolean;
  notes: string[];
}

const pct = (v: number, dp = 1) => `${v.toFixed(dp)}%`;

export function gradeMagnitude(fit: OlsResult | null): PredictiveGrade {
  if (!fit || fit.beta <= 0 || fit.tBeta < 2) return "none";
  if (fit.r2 >= 0.5) return "strong";
  if (fit.r2 >= 0.3) return "moderate";
  if (fit.r2 >= 0.1) return "weak";
  return "none";
}

export function buildReadout(stats: VixForwardStats): VixForwardReadout {
  const mz = stats.magnitude.realizedOnVix;
  const grade = gradeMagnitude(mz);
  const bench = stats.magnitude.benchmark;
  const versus = bench
    ? bench.vixR2 > bench.trailingR2 + 0.02
      ? ` On the same dates that beats trailing 30-day realized volatility (${pct(bench.trailingR2 * 100, 0)}).`
      : bench.trailingR2 > bench.vixR2 + 0.02
        ? ` On the same dates trailing 30-day realized volatility does better (${pct(bench.trailingR2 * 100, 0)} versus ${pct(bench.vixR2 * 100, 0)}).`
        : ` Trailing 30-day realized volatility does about as well (${pct(bench.trailingR2 * 100, 0)}).`
    : "";
  const magnitude = mz
    ? `${grade === "none" ? "No reliable" : grade[0].toUpperCase() + grade.slice(1)} magnitude signal: the VIX explains ${pct(mz.r2 * 100, 0)} of the variation in the next 30 days' realized volatility (slope ${mz.beta.toFixed(2)}, t ${mz.tBeta.toFixed(1)}).${versus}`
    : "Not enough variation in the VIX to fit the magnitude regression.";

  const w1 = stats.calibration.within1;
  const gap = w1.pct - w1.expectedPct;
  const calibration = gap > 3
    ? `The move stayed inside ±1σ ${pct(w1.pct)} of the time versus ${pct(w1.expectedPct)} for a normal distribution: the VIX usually overstated the coming 30-day move (realized ÷ implied vol ${stats.vol.ratio.toFixed(2)}).`
    : gap < -3
      ? `The move stayed inside ±1σ only ${pct(w1.pct)} of the time versus ${pct(w1.expectedPct)} for a normal distribution: the VIX understated the coming 30-day move in this sample.`
      : `The move stayed inside ±1σ ${pct(w1.pct)} of the time, close to the ${pct(w1.expectedPct)} a normal distribution implies.`;

  const down = stats.calibration.beyondMinus2;
  const tails = `Falls beyond −2σ happened ${pct(down.pct)} of the time (normal: ${pct(down.expectedPct)}); rises beyond +2σ ${pct(stats.calibration.beyondPlus2.pct)}. Excess kurtosis of the standardized move is ${stats.calibration.zExcessKurtosis.toFixed(1)}.`;

  const fit = stats.direction.returnOnVix;
  const significant = !!fit && Math.abs(fit.tBeta) >= 2;
  const direction = !fit
    ? "Not enough variation in the VIX to fit the direction regression."
    : significant
      ? `${fit.beta > 0 ? "Higher" : "Lower"} VIX readings have been followed by higher 30-day returns (${fit.beta >= 0 ? "+" : ""}${fit.beta.toFixed(3)}% per VIX point, t ${fit.tBeta.toFixed(1)}), but the VIX explains only ${pct(fit.r2 * 100, 1)} of return variation.`
      : `No statistically reliable directional signal: slope ${fit.beta >= 0 ? "+" : ""}${fit.beta.toFixed(3)}% per VIX point, t ${fit.tBeta.toFixed(1)}, R² ${pct(fit.r2 * 100, 1)}.`;

  const notes = [
    stats.sampling === "daily"
      ? `Daily windows overlap by up to ${OVERLAP_LAG} trading days, so t-statistics use Newey–West errors with ${OVERLAP_LAG} lags and interval widths use about ${stats.effectiveN} independent windows.`
      : `Non-overlapping windows; t-statistics use Newey–West errors with ${NON_OVERLAP_LAG} lags.`,
    "These statistics are in-sample over the selected history; the Out-of-sample test panel checks how a forecast built only from past windows would have done.",
    "The implied move assumes zero drift and lognormal returns; the VIX is quoted at 4:15 pm ET and the index at the 4:00 pm close.",
  ];
  if (stats.effectiveN < 30) notes.unshift(`Small sample: about ${stats.effectiveN} independent 30-day windows.`);
  return { magnitudeGrade: grade, magnitude, calibration, tails, direction, directionSignificant: significant, notes };
}

/** Deterministic thinning for charts: every k-th row, always keeping the last. */
export function thin<T>(rows: T[], max: number): T[] {
  if (rows.length <= max) return rows;
  const step = Math.ceil(rows.length / max);
  return rows.filter((_, index) => index % step === 0 || index === rows.length - 1);
}

/** Histogram of standardized moves with the standard normal count per bin for comparison. */
export function zHistogram(observations: ForwardObservation[], { width = 0.5, limit = 4 } = {}) {
  const bins: { lo: number; hi: number; count: number; normal: number }[] = [];
  const n = observations.length;
  const cdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
  for (let lo = -limit; lo < limit - 1e-9; lo += width) bins.push({ lo, hi: lo + width, count: 0, normal: 0 });
  // The outer bins hold everything beyond ±limit.
  for (const b of bins) {
    const lo = b.lo <= -limit + 1e-9 ? Number.NEGATIVE_INFINITY : b.lo;
    const hi = b.hi >= limit - 1e-9 ? Number.POSITIVE_INFINITY : b.hi;
    b.normal = n * (cdf(hi) - cdf(lo));
  }
  for (const o of observations) {
    const k = Math.min(bins.length - 1, Math.max(0, Math.floor((o.z + limit) / width)));
    bins[k].count++;
  }
  return bins;
}

/** Abramowitz–Stegun 7.1.26 (|error| < 1.5e-7). */
export function erf(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : -1;
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return sign * y;
}
