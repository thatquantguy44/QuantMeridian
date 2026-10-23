/**
 * Reusable fixtures for the VIXR engine (src/lib/vixImpliedForward.ts): weekday calendars, price paths with known
 * realized volatility, and the edge cases the alignment must survive (gaps, missing VIX days, bad rows).
 */
import { Rng } from "@/lib/rng";
import { impliedMovePct, type ForwardObservation, type SeriesTuple } from "./vixImpliedForward";

const DAY_MS = 86_400_000;
const dayMs = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));

/** n consecutive weekdays from start (inclusive if start is a weekday). No holidays. */
export function weekdays(start: string, n: number): string[] {
  const out: string[] = [];
  for (let ms = dayMs(start); out.length < n; ms += DAY_MS) {
    const dow = new Date(ms).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

/** Daily log returns alternating +a, −a: every squared return is a², so realized vol is exactly a·√252. */
export function alternatingPath(dates: string[], a = 0.01, start = 100): SeriesTuple[] {
  let logPx = Math.log(start);
  return dates.map((date, i) => {
    if (i > 0) logPx += i % 2 ? a : -a;
    return [date, Math.exp(logPx)];
  });
}

/** Geometric Brownian motion at a constant annualized volatility (vol points), zero drift, seeded. */
export function gbmPath(dates: string[], volPts: number, seed = 7, start = 100): SeriesTuple[] {
  const rng = new Rng(seed);
  const daily = volPts / 100 / Math.sqrt(252);
  let logPx = Math.log(start);
  return dates.map((date, i) => {
    if (i > 0) logPx += rng.normal(-0.5 * daily * daily, daily);
    return [date, Math.exp(logPx)];
  });
}

export const constantSeries = (dates: string[], value: number): SeriesTuple[] => dates.map((date) => [date, value]);

/** Drop every date strictly between from and to, simulating a feed outage. */
export const withGap = (series: SeriesTuple[], from: string, to: string): SeriesTuple[] =>
  series.filter(([date]) => date <= from || date >= to);

/** A forward observation with a chosen VIX, standardized move and realized vol, for testing statistics directly. */
export function observation(date: string, vix: number, z: number, realizedVolPct = vix, endDate = date): ForwardObservation {
  const sigma = impliedMovePct(vix);
  const logPct = z * sigma;
  return {
    date, endDate, vix, impliedMovePct: sigma,
    forwardLogReturnPct: logPct,
    forwardReturnPct: (Math.exp(logPct / 100) - 1) * 100,
    z, realizedVolPct, trailingVolPct: null, tradingDays: 21,
  };
}

/** n observations on consecutive weekdays with the given z pattern repeated. */
export function observationSet(n: number, vixAt: (i: number) => number, zAt: (i: number) => number, rvAt?: (i: number) => number): ForwardObservation[] {
  return weekdays("2010-01-04", n).map((date, i) => observation(date, vixAt(i), zAt(i), rvAt ? rvAt(i) : vixAt(i)));
}
