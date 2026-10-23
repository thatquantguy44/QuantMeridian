import { describe, expect, it } from "vitest";
import { Rng } from "@/lib/rng";
import {
  MAX_ENDPOINT_GAP_DAYS, MIN_OBSERVATIONS, NORMAL_BENCHMARK, OVERLAP_LAG,
  addDays, alignForward, bucketize, buildReadout, computeVixForwardStats, erf, gradeMagnitude, impliedMovePct,
  ols, quantile, selectObservations, spearman, thin, wilsonRate, zHistogram,
  type SeriesTuple,
} from "./vixImpliedForward";
import { alternatingPath, constantSeries, gbmPath, observation, observationSet, weekdays, withGap } from "./vixImpliedForward.fixtures";

const dayDiff = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

describe("implied move", () => {
  it("scales the VIX by √(30/365)", () => {
    expect(impliedMovePct(20)).toBeCloseTo(5.7337, 3);
    expect(impliedMovePct(0)).toBe(0);
    expect(impliedMovePct(40)).toBeCloseTo(2 * impliedMovePct(20), 10);
  });
});

describe("alignForward", () => {
  const dates = weekdays("2020-01-06", 200);

  it("ends each window on the last trading day on or before date + 30 calendar days", () => {
    const { observations } = alignForward(constantSeries(dates, 20), alternatingPath(dates));
    const first = observations[0];
    expect(first.date).toBe("2020-01-06");
    expect(first.endDate).toBe("2020-02-05");
    // A Friday start lands on a Sunday target, so the window ends on the Friday before.
    const friday = observations.find((o) => o.date === "2020-01-10")!;
    expect(addDays("2020-01-10", 30)).toBe("2020-02-09");
    expect(friday.endDate).toBe("2020-02-07");
    for (const o of observations) {
      expect(dayDiff(o.date, o.endDate)).toBeLessThanOrEqual(30);
      expect(30 - dayDiff(o.date, o.endDate)).toBeLessThanOrEqual(MAX_ENDPOINT_GAP_DAYS);
    }
  });

  it("measures realized volatility exactly on a path with known daily returns", () => {
    const a = 0.01;
    const vix = a * Math.sqrt(252) * 100;
    const { observations } = alignForward(constantSeries(dates, vix), alternatingPath(dates, a));
    for (const o of observations) expect(o.realizedVolPct).toBeCloseTo(vix, 8);
    // The trailing benchmark needs a full 30-day lookback, then matches the same known volatility.
    expect(observations[0].trailingVolPct).toBeNull();
    const withLookback = observations.filter((o) => o.trailingVolPct !== null);
    expect(withLookback[0].date >= addDays(dates[0], 30)).toBe(true);
    for (const o of withLookback) expect(o.trailingVolPct!).toBeCloseTo(vix, 8);
    const o = observations[0];
    expect(o.z).toBeCloseTo(o.forwardLogReturnPct / impliedMovePct(vix), 10);
    expect(o.forwardReturnPct).toBeCloseTo((Math.exp(o.forwardLogReturnPct / 100) - 1) * 100, 10);
  });

  it("leaves out windows that run past the end of the data and reports the current reading", () => {
    const { observations, diagnostics, current } = alignForward(constantSeries(dates, 18), alternatingPath(dates));
    const last = dates[dates.length - 1];
    const tooRecent = dates.filter((d) => addDays(d, 30) > last).length;
    expect(diagnostics.incompleteWindows).toBe(tooRecent);
    expect(observations.length).toBe(dates.length - tooRecent);
    expect(current).toMatchObject({ date: last, vix: 18, horizonEnd: addDays(last, 30) });
    expect(current!.upMovePct).toBeGreaterThan(impliedMovePct(18));
    expect(current!.downMovePct).toBeGreaterThan(-impliedMovePct(18));
  });

  it("skips index dates without a VIX close and counts bad rows", () => {
    const vix: SeriesTuple[] = constantSeries(dates, 20).filter((_, i) => i % 10 !== 3);
    vix.push(["2020-13-01", 20], ["2020-02-03", Number.NaN], ["2020-02-04", 0]);
    const price = alternatingPath(dates);
    price.push(["not-a-date", 100], ["2020-02-06", -1]);
    const { diagnostics, observations } = alignForward(vix, price);
    expect(diagnostics.invalidRows).toBe(5);
    expect(diagnostics.priceDatesWithoutVix).toBeGreaterThan(0);
    expect(observations.every((o) => o.vix === 20)).toBe(true);
  });

  it("drops windows whose end falls in a data outage instead of using a stale price", () => {
    const price = withGap(alternatingPath(dates), "2020-03-02", "2020-03-23");
    const { observations, diagnostics } = alignForward(constantSeries(dates, 20), price);
    expect(diagnostics.endpointGaps).toBeGreaterThan(0);
    for (const o of observations) expect(30 - dayDiff(o.date, o.endDate)).toBeLessThanOrEqual(MAX_ENDPOINT_GAP_DAYS);
  });

  it("returns nothing, without throwing, for empty or one-sided input", () => {
    expect(alignForward([], []).observations).toEqual([]);
    expect(alignForward([], []).current).toBeNull();
    expect(alignForward(constantSeries(dates, 20), []).observations).toEqual([]);
  });

  it("deduplicates and sorts unsorted input", () => {
    const price = alternatingPath(dates);
    const shuffled = [...price].reverse();
    shuffled.push(price[5]);
    expect(alignForward(constantSeries(dates, 20), shuffled).observations).toEqual(alignForward(constantSeries(dates, 20), price).observations);
  });
});

describe("selectObservations", () => {
  const dates = weekdays("2018-01-01", 400);
  const { observations } = alignForward(constantSeries(dates, 20), alternatingPath(dates));

  it("filters by start and end date", () => {
    const picked = selectObservations(observations, { start: "2018-03-01", end: "2018-06-30", sampling: "daily" });
    expect(picked[0].date >= "2018-03-01").toBe(true);
    expect(picked[picked.length - 1].date <= "2018-06-30").toBe(true);
  });

  it("monthly sampling keeps non-overlapping windows that chain end to start", () => {
    const monthly = selectObservations(observations, { sampling: "monthly" });
    expect(monthly.length).toBeGreaterThan(10);
    for (let k = 1; k < monthly.length; k++) expect(monthly[k].date >= monthly[k - 1].endDate).toBe(true);
    expect(monthly.length).toBeLessThan(observations.length / 15);
  });
});

describe("ols with Newey–West errors", () => {
  it("recovers an exact line", () => {
    const x = [1, 2, 3, 4, 5, 6];
    const fit = ols(x, x.map((v) => 2 + 3 * v), 2)!;
    expect(fit.alpha).toBeCloseTo(2, 10);
    expect(fit.beta).toBeCloseTo(3, 10);
    expect(fit.r2).toBeCloseTo(1, 10);
    expect(fit.seBeta).toBeCloseTo(0, 8);
  });

  it("matches White (HC0) standard errors at lag 0", () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8];
    const y = [1.2, 1.9, 3.4, 3.8, 5.6, 5.9, 7.7, 7.6];
    const fit = ols(x, y, 0)!;
    const mx = 4.5;
    const sxx = x.reduce((s, v) => s + (v - mx) ** 2, 0);
    const e = x.map((v, t) => y[t] - fit.alpha - fit.beta * v);
    const hc0 = e.reduce((s, r, t) => s + r * r * (x[t] - mx) ** 2, 0) / (sxx * sxx);
    expect(fit.seBeta).toBeCloseTo(Math.sqrt(hc0), 12);
    expect(fit.lag).toBe(0);
  });

  it("widens errors when residuals are positively autocorrelated", () => {
    const rng = new Rng(11);
    const x = Array.from({ length: 400 }, (_, t) => t / 40 + rng.normal(0, 0.5));
    let e = 0;
    const y = x.map((v) => { e = 0.9 * e + rng.normal(0, 1); return 1 + 0.5 * v + e; });
    const white = ols(x, y, 0)!;
    const nw = ols(x, y, 20)!;
    expect(nw.beta).toBeCloseTo(white.beta, 12);
    expect(nw.seBeta).toBeGreaterThan(white.seBeta * 1.5);
  });

  it("returns null with no variation in x or too few points", () => {
    expect(ols([5, 5, 5, 5], [1, 2, 3, 4], 1)).toBeNull();
    expect(ols([1, 2], [1, 2], 0)).toBeNull();
  });
});

describe("rank correlation, rates and quantiles", () => {
  it("spearman is 1 for any increasing relation and handles ties", () => {
    expect(spearman([1, 2, 3, 4, 5], [1, 8, 27, 64, 125])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 2, 3], [4, 3, 3, 1])).toBeCloseTo(-1, 12);
  });

  it("wilson interval matches the textbook case and narrows with sample size", () => {
    const r = wilsonRate(50, 100, 100, 50);
    expect(r.pct).toBe(50);
    expect(r.ciLow).toBeCloseTo(40.38, 1);
    expect(r.ciHigh).toBeCloseTo(59.62, 1);
    const overlapped = wilsonRate(50, 100, 5, 50);
    expect(overlapped.ciHigh - overlapped.ciLow).toBeGreaterThan(r.ciHigh - r.ciLow);
  });

  it("quantile interpolates", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([0, 10], 0.25)).toBe(2.5);
  });
});

describe("buckets", () => {
  it("regime edges are lower-inclusive and empty regimes are omitted", () => {
    const obs = [14.99, 15, 19.99, 20, 39.99, 40].map((v, i) => observation(`2020-01-0${i + 1}`, v, 0));
    const buckets = bucketize(obs, "regime");
    expect(buckets.map((b) => [b.label, b.n])).toEqual([["VIX < 15", 1], ["15–20", 2], ["20–25", 1], ["30–40", 1], ["VIX ≥ 40", 1]]);
  });

  it("quintiles split distinct levels into equal groups", () => {
    const obs = observationSet(100, (i) => 10 + i * 0.3, () => 0.5);
    const buckets = bucketize(obs, "quintile");
    expect(buckets.map((b) => b.n)).toEqual([20, 20, 20, 20, 20]);
    expect(buckets[0].label.startsWith("Q1 · 10")).toBe(true);
  });

  it("summarizes returns and calibration per bucket", () => {
    const obs = observationSet(10, () => 20, (i) => (i < 8 ? 0.5 : 1.5), () => 16);
    const [b] = bucketize(obs, "regime");
    expect(b.within1Pct).toBe(80);
    expect(b.pctPositive).toBe(100);
    expect(b.realizedToImplied).toBeCloseTo(0.8, 12);
  });
});

describe("computeVixForwardStats", () => {
  it("needs a minimum sample", () => {
    expect(computeVixForwardStats(observationSet(MIN_OBSERVATIONS - 1, () => 20, () => 0), { sampling: "daily", scheme: "regime" })).toBeNull();
  });

  it("counts calibration bands on standardized moves", () => {
    // z cycles through 0.5, −0.5, 1.5, −2.5, 0.2: 3 of 5 inside ±1σ, 4 of 5 inside ±2σ, 1 of 5 beyond −2σ.
    const pattern = [0.5, -0.5, 1.5, -2.5, 0.2];
    const stats = computeVixForwardStats(observationSet(100, (i) => 15 + (i % 7), (i) => pattern[i % 5]), { sampling: "monthly", scheme: "regime" })!;
    expect(stats.calibration.within1.pct).toBeCloseTo(60, 10);
    expect(stats.calibration.within2.pct).toBeCloseTo(80, 10);
    expect(stats.calibration.beyondMinus2.pct).toBeCloseTo(20, 10);
    expect(stats.calibration.beyondPlus2.pct).toBe(0);
    expect(stats.calibration.within1.expectedPct).toBe(NORMAL_BENCHMARK.within1);
    expect(stats.effectiveN).toBe(100);
  });

  it("uses an effective sample of n / 21 and 21 lags for overlapping daily windows", () => {
    const stats = computeVixForwardStats(observationSet(420, (i) => 15 + (i % 7), () => 0.3), { sampling: "daily", scheme: "regime" })!;
    expect(stats.effectiveN).toBe(20);
    expect(stats.lag).toBe(OVERLAP_LAG);
    expect(buildReadout(stats).notes[0]).toMatch(/Small sample/);
  });

  it("reports no regression, not NaN, when the VIX never varies", () => {
    const stats = computeVixForwardStats(observationSet(50, () => 20, (i) => (i % 2 ? 1 : -1) * 0.4), { sampling: "monthly", scheme: "quintile" })!;
    expect(stats.magnitude.realizedOnVix).toBeNull();
    expect(stats.direction.returnOnVix).toBeNull();
    const readout = buildReadout(stats);
    expect(readout.magnitudeGrade).toBe("none");
    expect(readout.direction).toMatch(/Not enough variation/);
    expect(JSON.stringify(stats)).not.toMatch(/NaN|null,"correlation":NaN/);
  });

  it("finds a significant direction when returns rise with the VIX", () => {
    const vixAt = (i: number) => 12 + (i * 7) % 30;
    const stats = computeVixForwardStats(observationSet(200, vixAt, (i) => (vixAt(i) - 25) / 15 + ((i % 3) - 1) * 0.2), { sampling: "monthly", scheme: "regime" })!;
    const fit = stats.direction.returnOnVix!;
    expect(fit.beta).toBeGreaterThan(0);
    expect(fit.tBeta).toBeGreaterThan(2);
    expect(buildReadout(stats).directionSignificant).toBe(true);
  });
});

describe("end to end on simulated markets with known volatility", () => {
  const dates = weekdays("2000-01-03", 4200);

  it("a VIX equal to true volatility reads as calibrated", () => {
    const { observations } = alignForward(constantSeries(dates, 20), gbmPath(dates, 20, 3));
    const stats = computeVixForwardStats(observations, { sampling: "daily", scheme: "regime" })!;
    expect(stats.calibration.within1.pct).toBeGreaterThan(60);
    expect(stats.calibration.within1.pct).toBeLessThan(76);
    expect(stats.vol.ratio).toBeGreaterThan(0.93);
    expect(stats.vol.ratio).toBeLessThan(1.05);
    expect(buildReadout(stats).calibration).toMatch(/close to|overstated|understated/);
  });

  it("a VIX 25% above true volatility reads as overstated, with a positive premium", () => {
    const { observations } = alignForward(constantSeries(dates, 25), gbmPath(dates, 20, 3));
    const stats = computeVixForwardStats(observations, { sampling: "daily", scheme: "regime" })!;
    expect(stats.calibration.within1.pct).toBeGreaterThan(74);
    expect(stats.vol.meanPremiumPts).toBeGreaterThan(3);
    expect(buildReadout(stats).calibration).toMatch(/overstated/);
  });

  it("a VIX that tracks regime-switching volatility is a strong magnitude predictor", () => {
    const rng = new Rng(5);
    const volAt = (i: number) => (Math.floor(i / 160) % 2 ? 40 : 12);
    let logPx = Math.log(100);
    const price: SeriesTuple[] = dates.map((date, i) => {
      const d = volAt(i) / 100 / Math.sqrt(252);
      if (i > 0) logPx += rng.normal(0, d);
      return [date, Math.exp(logPx)];
    });
    const vix: SeriesTuple[] = dates.map((date, i) => [date, volAt(i)]);
    const { observations } = alignForward(vix, price);
    const stats = computeVixForwardStats(observations, { sampling: "daily", scheme: "regime" })!;
    const mz = stats.magnitude.realizedOnVix!;
    expect(mz.r2).toBeGreaterThan(0.5);
    expect(mz.beta).toBeGreaterThan(0.7);
    expect(gradeMagnitude(mz)).toBe("strong");
    expect(stats.magnitude.spearmanVixAbsReturn!).toBeGreaterThan(0.2);
    const bench = stats.magnitude.benchmark!;
    expect(bench.n).toBeLessThan(stats.n);
    expect(bench.trailingR2).toBeGreaterThan(0);
    expect(buildReadout(stats).magnitude).toMatch(/trailing 30-day realized volatility/);
  });
});

describe("chart helpers", () => {
  it("erf matches reference values", () => {
    expect(erf(0)).toBeCloseTo(0, 6);
    expect(erf(1)).toBeCloseTo(0.8427, 4);
    expect(erf(-2)).toBeCloseTo(-0.9953, 4);
  });

  it("z histogram counts every observation and the normal reference sums to n", () => {
    const obs = observationSet(300, () => 20, (i) => ((i % 61) - 30) / 6);
    const bins = zHistogram(obs);
    expect(bins.length).toBe(16);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(300);
    expect(bins.reduce((s, b) => s + b.normal, 0)).toBeCloseTo(300, 4);
  });

  it("thin keeps the last row", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => i);
    const out = thin(rows, 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out[out.length - 1]).toBe(999);
  });
});
