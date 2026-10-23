/**
 * Expanding-window out-of-sample test for VIXR.
 *
 * For each test window starting on date t, every model is fitted only on windows whose 30-day outcome was already
 * complete before t (endDate < t), so no forecast sees the future. Two targets are scored:
 *
 * - Volatility: the volatility realized over the next 30 days, forecast by the raw VIX, the VIX recalibrated by an
 *   expanding regression (a + b·VIX), the trailing 30-day realized volatility, and the expanding historical mean.
 * - Return: the next 30-day return, forecast by the expanding mean and by an expanding regression on the VIX.
 *
 * Skill is the out-of-sample R² against the expanding historical mean (Campbell and Thompson), 1 − MSE/MSE_mean:
 * positive means the model beat knowing only the past average. Models are compared with a Diebold–Mariano test on
 * squared-error loss with Newey–West errors. Everything is evaluated on identical test points.
 */
import type { ForwardObservation } from "./vixImpliedForward";

export type VolModelId = "vix_raw" | "vix_calibrated" | "trailing" | "hist_mean";
export type ReturnModelId = "ret_mean" | "ret_vix";

export const VOL_MODELS: { id: VolModelId; label: string }[] = [
  { id: "vix_raw", label: "VIX as quoted" },
  { id: "vix_calibrated", label: "VIX recalibrated (a + b·VIX)" },
  { id: "trailing", label: "Trailing 30-day realized vol" },
  { id: "hist_mean", label: "Historical mean (benchmark)" },
];
export const RETURN_MODELS: { id: ReturnModelId; label: string }[] = [
  { id: "ret_mean", label: "Historical mean return (benchmark)" },
  { id: "ret_vix", label: "Return ~ VIX regression" },
];

/** Minimum training windows before the first test: about a year of overlapping daily windows, five years of monthly. */
export const MIN_TRAIN_DAILY = 504;
export const MIN_TRAIN_MONTHLY = 60;
export const MIN_TEST = 10;

export interface ForecastPoint {
  date: string;
  endDate: string;
  trainN: number;
  vix: number;
  actualVolPct: number;
  actualReturnPct: number;
  vix_raw: number;
  vix_calibrated: number;
  trailing: number;
  hist_mean: number;
  ret_mean: number;
  ret_vix: number;
}

export interface ModelScore {
  id: string;
  label: string;
  rmse: number;
  mae: number;
  /** Mean forecast minus mean outcome. */
  bias: number;
  /** 1 − MSE / MSE(benchmark); 0 for the benchmark itself. */
  oosR2: number;
  /** Diebold–Mariano t against the benchmark; negative means lower squared error. Null for the benchmark. */
  dmVsBenchmark: number | null;
  /** Diebold–Mariano t against the trailing-volatility forecast (volatility models only). */
  dmVsTrailing: number | null;
}

export interface CumulativeAdvantage {
  date: string;
  vix_raw: number;
  vix_calibrated: number;
  trailing: number;
}

export interface WalkForwardResult {
  n: number;
  minTrain: number;
  lag: number;
  firstTest: string;
  lastTest: string;
  trainAtFirstTest: number;
  trainAtLastTest: number;
  vol: ModelScore[];
  returns: ModelScore[];
  points: ForecastPoint[];
  /** Running sum of benchmark squared error minus model squared error: rising means the model keeps beating the mean. */
  advantage: CumulativeAdvantage[];
}

/** Diebold–Mariano t for equal squared-error loss: mean(e_a² − e_b²) over its Newey–West standard error. */
export function dieboldMarianoT(errA: number[], errB: number[], lag: number): number | null {
  const n = Math.min(errA.length, errB.length);
  if (n < 3) return null;
  const d = Array.from({ length: n }, (_, t) => errA[t] ** 2 - errB[t] ** 2);
  const mean = d.reduce((s, v) => s + v, 0) / n;
  const centered = d.map((v) => v - mean);
  const gamma = (l: number) => {
    let s = 0;
    for (let t = l; t < n; t++) s += centered[t] * centered[t - l];
    return s / n;
  };
  const L = Math.max(0, Math.min(lag, n - 1));
  let lrv = gamma(0);
  for (let l = 1; l <= L; l++) lrv += 2 * (1 - l / (L + 1)) * gamma(l);
  if (!(lrv > 1e-18)) return null;
  return mean / Math.sqrt(lrv / n);
}

/** Running sufficient statistics for an expanding OLS of y on x. */
class Expanding {
  n = 0; sx = 0; sy = 0; sxx = 0; sxy = 0;
  add(x: number, y: number) { this.n++; this.sx += x; this.sy += y; this.sxx += x * x; this.sxy += x * y; }
  mean() { return this.sy / this.n; }
  fit(): { alpha: number; beta: number } | null {
    const denom = this.n * this.sxx - this.sx * this.sx;
    if (this.n < 3 || !(denom > 1e-9)) return null;
    const beta = (this.n * this.sxy - this.sx * this.sy) / denom;
    return { alpha: (this.sy - beta * this.sx) / this.n, beta };
  }
}

/** Observations must be sorted by date, as selectObservations returns them. */
export function walkForward(observations: ForwardObservation[], { minTrain, lag }: { minTrain: number; lag: number }): WalkForwardResult | null {
  const volFit = new Expanding();
  const retFit = new Expanding();
  const points: ForecastPoint[] = [];
  let k = 0;
  for (const t of observations) {
    // Train on windows whose outcome completed strictly before t; endDate never decreases with date.
    while (k < observations.length && observations[k].endDate < t.date) {
      volFit.add(observations[k].vix, observations[k].realizedVolPct);
      retFit.add(observations[k].vix, observations[k].forwardReturnPct);
      k++;
    }
    if (k < minTrain || t.trailingVolPct === null) continue;
    const v = volFit.fit();
    const r = retFit.fit();
    if (!v || !r) continue;
    points.push({
      date: t.date, endDate: t.endDate, trainN: k, vix: t.vix,
      actualVolPct: t.realizedVolPct, actualReturnPct: t.forwardReturnPct,
      vix_raw: t.vix,
      vix_calibrated: v.alpha + v.beta * t.vix,
      trailing: t.trailingVolPct,
      hist_mean: volFit.mean(),
      ret_mean: retFit.mean(),
      ret_vix: r.alpha + r.beta * t.vix,
    });
  }
  if (points.length < MIN_TEST) return null;

  const n = points.length;
  const errors = (actual: (p: ForecastPoint) => number, forecast: (p: ForecastPoint) => number) => points.map((p) => actual(p) - forecast(p));
  const volErr = Object.fromEntries(VOL_MODELS.map((m) => [m.id, errors((p) => p.actualVolPct, (p) => p[m.id])])) as Record<VolModelId, number[]>;
  const retErr = Object.fromEntries(RETURN_MODELS.map((m) => [m.id, errors((p) => p.actualReturnPct, (p) => p[m.id])])) as Record<ReturnModelId, number[]>;
  const mse = (e: number[]) => e.reduce((s, v) => s + v * v, 0) / e.length;

  const score = (id: string, label: string, e: number[], benchmark: number[], trailing: number[] | null, isBenchmark: boolean): ModelScore => ({
    id, label,
    rmse: Math.sqrt(mse(e)),
    mae: e.reduce((s, v) => s + Math.abs(v), 0) / n,
    bias: -e.reduce((s, v) => s + v, 0) / n,
    oosR2: isBenchmark ? 0 : 1 - mse(e) / mse(benchmark),
    dmVsBenchmark: isBenchmark ? null : dieboldMarianoT(e, benchmark, lag),
    dmVsTrailing: trailing && id !== "trailing" ? dieboldMarianoT(e, trailing, lag) : null,
  });

  const vol = VOL_MODELS.map((m) => score(m.id, m.label, volErr[m.id], volErr.hist_mean, volErr.trailing, m.id === "hist_mean"));
  const returns = RETURN_MODELS.map((m) => score(m.id, m.label, retErr[m.id], retErr.ret_mean, null, m.id === "ret_mean"));

  let cumRaw = 0, cumCal = 0, cumTrail = 0;
  const advantage = points.map((p, i) => {
    const base = volErr.hist_mean[i] ** 2;
    cumRaw += base - volErr.vix_raw[i] ** 2;
    cumCal += base - volErr.vix_calibrated[i] ** 2;
    cumTrail += base - volErr.trailing[i] ** 2;
    return { date: p.date, vix_raw: cumRaw, vix_calibrated: cumCal, trailing: cumTrail };
  });

  return {
    n, minTrain, lag,
    firstTest: points[0].date, lastTest: points[n - 1].date,
    trainAtFirstTest: points[0].trainN, trainAtLastTest: points[n - 1].trainN,
    vol, returns, points, advantage,
  };
}

const pct = (v: number, dp = 0) => `${(v * 100).toFixed(dp)}%`;

export interface WalkForwardReadout {
  volatility: string;
  versusTrailing: string;
  returns: string;
  notes: string[];
}

export function buildWalkForwardReadout(wf: WalkForwardResult): WalkForwardReadout {
  const get = <T extends ModelScore>(rows: T[], id: string) => rows.find((r) => r.id === id)!;
  const raw = get(wf.vol, "vix_raw");
  const cal = get(wf.vol, "vix_calibrated");
  const trail = get(wf.vol, "trailing");
  const ret = get(wf.returns, "ret_vix");

  const sig = (t: number | null) => (t === null ? "inconclusive" : Math.abs(t) >= 2 ? (t < 0 ? "significantly better" : "significantly worse") : "not significantly different");
  const volatility = cal.oosR2 > 0
    ? `Out of sample, the recalibrated VIX beat the historical-mean forecast of next-month volatility: skill ${pct(cal.oosR2)} (${sig(cal.dmVsBenchmark)}). The raw VIX scored ${pct(raw.oosR2)} because it runs high (bias ${raw.bias >= 0 ? "+" : ""}${raw.bias.toFixed(1)} vol points).`
    : `Out of sample, the recalibrated VIX did not beat the historical-mean forecast (skill ${pct(cal.oosR2)}).`;
  const versusTrailing = cal.dmVsTrailing === null
    ? "The comparison with trailing realized volatility is inconclusive."
    : `Against trailing 30-day realized volatility, the recalibrated VIX had ${cal.rmse < trail.rmse ? "lower" : "higher"} error (RMSE ${cal.rmse.toFixed(2)} versus ${trail.rmse.toFixed(2)} vol points), ${sig(cal.dmVsTrailing)} by Diebold–Mariano (t ${cal.dmVsTrailing.toFixed(1)}).`;
  const returns = ret.oosR2 > 0
    ? `Return forecasts: the VIX regression beat the historical mean return out of sample (skill ${pct(ret.oosR2, 1)}, ${sig(ret.dmVsBenchmark)}).`
    : `Return forecasts: the VIX regression did not beat the historical mean return out of sample (skill ${pct(ret.oosR2, 1)}), so the VIX had no out-of-sample value as a forecast of direction.`;

  return {
    volatility, versusTrailing, returns,
    notes: [
      `Expanding window: each forecast is fitted only on windows whose 30 days had finished before the test date, starting after ${wf.minTrain} training windows (${wf.n} test windows, ${wf.firstTest} to ${wf.lastTest}).`,
      "Skill is out-of-sample R² against the expanding historical mean; positive means the model added information beyond the past average.",
      `Diebold–Mariano uses squared-error loss with Newey–West errors (${wf.lag} lags). Models are scored on identical windows; recalibration uses the whole history to date, not just recent windows.`,
    ],
  };
}
