/**
 * Golden tests: the engine against (1) real Gold excerpts whose expected statistics were produced by an independent
 * numpy/scipy implementation (scripts/fixtures/vixr_reference.py) and (2) a micro dataset worked out by hand.
 * Regenerate the expected files with `python3 scripts/fixtures/vixr_reference.py` only when the method changes on purpose.
 */
import { describe, expect, it } from "vitest";
import crisis from "./__fixtures__/vixr/gold-crisis_2007_2009.json";
import calm from "./__fixtures__/vixr/gold-calm_2017.json";
import expectedCrisis from "./__fixtures__/vixr/expected-crisis_2007_2009.json";
import expectedCalm from "./__fixtures__/vixr/expected-calm_2017.json";
import {
  alignForward, computeVixForwardStats, selectObservations, impliedMovePct,
  type SeriesTuple, type VixForwardSampling,
} from "./vixImpliedForward";

type RefBucket = { n: number; meanVix: number; meanForwardReturnPct: number; pctPositive: number; realizedToImplied: number; within1Pct: number };
// Fixtures differ in which VIX regimes occur, so the bucket map is keyed loosely.
type Summary = Omit<typeof expectedCrisis["daily"], "regimeBuckets" | "walkForward"> & { regimeBuckets: Record<string, RefBucket> };

const series = (raw: [string, number][]) => raw as SeriesTuple[];

function run(fixture: { vix: unknown; spy: unknown }, sampling: VixForwardSampling) {
  const aligned = alignForward(series(fixture.vix as [string, number][]), series(fixture.spy as [string, number][]));
  const obs = selectObservations(aligned.observations, { sampling });
  return { aligned, obs, stats: computeVixForwardStats(obs, { sampling, scheme: "regime" })! };
}

const close = (actual: number, expected: number, tol = 1e-6) => {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(expected)));
};

function expectMatches(stats: NonNullable<ReturnType<typeof computeVixForwardStats>>, e: Summary) {
  expect(stats.n).toBe(e.n);
  expect(stats.effectiveN).toBe(e.effectiveN);
  expect(stats.lag).toBe(e.lag);
  expect(stats.start).toBe(e.start);
  expect(stats.end).toBe(e.end);
  close(stats.meanVix, e.meanVix);
  close(stats.meanImpliedMovePct, e.meanImpliedMovePct);
  close(stats.meanForwardReturnPct, e.meanForwardReturnPct);
  close(stats.medianForwardReturnPct, e.medianForwardReturnPct);
  close(stats.pctPositive, e.pctPositive);

  for (const key of ["within1", "within2", "beyondMinus2", "beyondPlus2"] as const) {
    close(stats.calibration[key].pct, e[key].pct);
    // The reference uses z = 1.959964, the engine 1.96.
    close(stats.calibration[key].ciLow, e[key].ciLow, 2e-4);
    close(stats.calibration[key].ciHigh, e[key].ciHigh, 2e-4);
  }
  close(stats.calibration.zMean, e.zMean);
  close(stats.calibration.zStd, e.zStd);
  close(stats.calibration.zExcessKurtosis, e.zExcessKurtosis);

  close(stats.vol.meanRealizedVolPct, e.meanRealizedVolPct);
  close(stats.vol.ratio, e.volRatio);
  close(stats.vol.medianRatio, e.medianVolRatio);
  close(stats.vol.meanPremiumPts, e.meanPremiumPts);
  close(stats.vol.pctVixAboveRealized, e.pctVixAboveRealized);

  const regressions = [
    [stats.magnitude.realizedOnVix, e.realizedOnVix],
    [stats.magnitude.absReturnOnImplied, e.absReturnOnImplied],
    [stats.direction.returnOnVix, e.returnOnVix],
  ] as const;
  for (const [fit, ref] of regressions) {
    expect(fit).not.toBeNull();
    expect(fit!.n).toBe(ref.n);
    close(fit!.alpha, ref.alpha);
    close(fit!.beta, ref.beta);
    close(fit!.r2, ref.r2);
    close(fit!.seBeta, ref.seBeta, 1e-5);
    close(fit!.seAlpha, ref.seAlpha, 1e-5);
    close(fit!.tBeta, ref.tBeta, 1e-5);
  }
  close(stats.magnitude.spearmanVixAbsReturn!, e.spearmanVixAbsReturn);
  close(stats.direction.correlation!, e.correlationReturnVix);

  if (e.benchmark) {
    expect(stats.magnitude.benchmark!.n).toBe(e.benchmark.n);
    close(stats.magnitude.benchmark!.vixR2, e.benchmark.vixR2);
    close(stats.magnitude.benchmark!.trailingR2, e.benchmark.trailingR2);
  } else expect(stats.magnitude.benchmark).toBeNull();

  const refBuckets = Object.entries(e.regimeBuckets);
  expect(stats.buckets).toHaveLength(refBuckets.length);
  // Buckets are returned in ascending VIX order, skipping empty ones, as the reference's sorted keys are.
  stats.buckets.forEach((bucket, index) => {
    const ref = refBuckets[index][1];
    expect(bucket.n).toBe(ref.n);
    close(bucket.meanVix, ref.meanVix);
    close(bucket.meanForwardReturnPct, ref.meanForwardReturnPct);
    close(bucket.pctPositive, ref.pctPositive);
    close(bucket.realizedToImplied, ref.realizedToImplied);
    close(bucket.within1Pct, ref.within1Pct);
  });
}

describe("real Gold excerpt: 2007-06 to 2009-12 (financial crisis)", () => {
  it("builds the same windows as the independent reference", () => {
    const { aligned, obs } = run(crisis, "daily");
    expect(aligned.observations).toHaveLength(expectedCrisis.windowsBuilt);
    expect(aligned.observations[0]).toMatchObject({ date: expectedCrisis.first.date, endDate: expectedCrisis.first.end });
    const last = aligned.observations[aligned.observations.length - 1];
    expect(last).toMatchObject({ date: expectedCrisis.last.date, endDate: expectedCrisis.last.end });
    close(last.realizedVolPct, expectedCrisis.last.rv);
    close(last.z, expectedCrisis.last.z);
    expect(obs).toHaveLength(expectedCrisis.daily.n);
  });

  it("matches every daily-sampled statistic", () => expectMatches(run(crisis, "daily").stats, expectedCrisis.daily));
  it("matches every non-overlapping statistic", () => expectMatches(run(crisis, "monthly").stats, expectedCrisis.monthly));

  it("tells the story of the period: realized volatility exceeded the VIX in the crash windows", () => {
    const { obs } = run(crisis, "daily");
    const autumn2008 = obs.filter((o) => o.date >= "2008-09-02" && o.date <= "2008-10-31");
    expect(autumn2008.length).toBeGreaterThan(30);
    const meanRatio = autumn2008.reduce((s, o) => s + o.realizedVolPct / o.vix, 0) / autumn2008.length;
    expect(meanRatio).toBeGreaterThan(0.9);
    // The worst 30-day window of the sample starts in the autumn of 2008.
    const worst = [...obs].sort((a, b) => a.forwardReturnPct - b.forwardReturnPct)[0];
    expect(worst.date >= "2008-09-01" && worst.date <= "2008-12-31").toBe(true);
    expect(worst.forwardReturnPct).toBeLessThan(-25);
  });
});

describe("real Gold excerpt: 2017 (record-low volatility)", () => {
  it("matches every daily-sampled statistic", () => expectMatches(run(calm, "daily").stats, expectedCalm.daily));
  it("matches every non-overlapping statistic", () => expectMatches(run(calm, "monthly").stats, expectedCalm.monthly));

  it("shows the VIX overstating a calm market", () => {
    const { stats } = run(calm, "daily");
    expect(stats.vol.ratio).toBeLessThan(0.9);
    expect(stats.vol.pctVixAboveRealized).toBeGreaterThan(80);
    expect(stats.calibration.within1.pct).toBeGreaterThan(80);
    expect(stats.calibration.beyondMinus2.pct).toBe(0);
  });
});

describe("hand-computed micro case", () => {
  // Weekdays 2024-01-02 (Tue) to 2024-02-09 (Fri). SPY closes at 100 on every date except 2024-02-01, which closes at
  // 110 (a one-day +10% jump), and VIX is a constant 20. Every 30-day window that includes the jump has the same shape.
  const dates: string[] = [];
  for (let ms = Date.UTC(2024, 0, 2); ms <= Date.UTC(2024, 1, 9); ms += 86_400_000) {
    const dow = new Date(ms).getUTCDay();
    if (dow !== 0 && dow !== 6) dates.push(new Date(ms).toISOString().slice(0, 10));
  }
  const vix: SeriesTuple[] = dates.map((d) => [d, 20]);
  const spy: SeriesTuple[] = dates.map((d) => [d, d === "2024-02-01" ? 110 : d > "2024-02-01" ? 110 : 100]);

  it("computes the window by hand", () => {
    // Start 2024-01-02: target 2024-02-01, which is a trading day, so the window ends on 2024-02-01 (index jump included).
    const { observations } = alignForward(vix, spy);
    const first = observations[0];
    expect(first).toMatchObject({ date: "2024-01-02", endDate: "2024-02-01", vix: 20 });
    const sigma = 20 * Math.sqrt(30 / 365);
    expect(sigma).toBeCloseTo(5.7337, 3);
    expect(first.impliedMovePct).toBeCloseTo(sigma, 12);
    expect(first.forwardReturnPct).toBeCloseTo(10, 10);
    expect(first.forwardLogReturnPct).toBeCloseTo(100 * Math.log(1.1), 10);
    expect(first.z).toBeCloseTo((100 * Math.log(1.1)) / sigma, 10);
    // One non-zero daily return of ln(1.1) among the window's 22 return days (Jan 3 .. Feb 1 is 22 trading days).
    expect(first.tradingDays).toBe(22);
    expect(first.realizedVolPct).toBeCloseTo(Math.sqrt((252 * Math.log(1.1) ** 2) / 22) * 100, 10);
  });

  it("only windows that fit inside the data exist, and all of them contain the jump", () => {
    const { observations, diagnostics } = alignForward(vix, spy);
    // Data ends 2024-02-09, so the last start with a full 30 days is 2024-01-10; later dates are still open.
    expect(observations[observations.length - 1].date).toBe("2024-01-10");
    expect(observations[observations.length - 1].endDate).toBe("2024-02-09");
    expect(diagnostics.incompleteWindows).toBe(dates.filter((d) => d > "2024-01-10").length);
    for (const o of observations) expect(o.forwardReturnPct).toBeCloseTo(10, 10);
    // The one-day jump falls in every window, so realized volatility shrinks as the window gets longer.
    const [shortest, longest] = [observations[0], observations[observations.length - 1]];
    expect(longest.tradingDays).toBeGreaterThanOrEqual(shortest.tradingDays);
    expect(longest.realizedVolPct).toBeLessThanOrEqual(shortest.realizedVolPct);
  });

  it("the latest reading is the last VIX close, with the exact band", () => {
    const { current } = alignForward(vix, spy);
    expect(current).toMatchObject({ date: "2024-02-09", vix: 20, horizonEnd: "2024-03-10" });
    const sigma = 20 * Math.sqrt(30 / 365);
    expect(current!.upMovePct).toBeCloseTo((Math.exp(sigma / 100) - 1) * 100, 10);
    expect(current!.downMovePct).toBeCloseTo((Math.exp(-sigma / 100) - 1) * 100, 10);
    expect(impliedMovePct(20)).toBeCloseTo(sigma, 12);
  });
});

describe("fixture integrity", () => {
  it("fixtures are sorted, positive, aligned in length and carry provenance", () => {
    for (const fixture of [crisis, calm]) {
      expect(fixture._provenance.source).toMatch(/Gold/);
      for (const rows of [fixture.vix, fixture.spy] as [string, number][][]) {
        expect(rows.every(([d, v]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && v > 0)).toBe(true);
        expect(rows.every(([d], i) => i === 0 || rows[i - 1][0] < d)).toBe(true);
      }
      expect(fixture.vix.length).toBe(fixture.spy.length);
    }
  });
});

describe("documentation examples stay true", () => {
  it("the help page's five-day realized volatility example is 18.4 vol points", () => {
    const closes = [100, 101, 99.5, 100.5, 100, 101.5];
    const squares = closes.slice(1).map((p, k) => Math.log(p / closes[k]) ** 2);
    expect(squares.reduce((s, v) => s + v, 0)).toBeCloseTo(0.0006694, 7);
    const rv = 100 * Math.sqrt((252 * squares.reduce((s, v) => s + v, 0)) / squares.length);
    expect(rv).toBeCloseTo(18.37, 2);
    expect(rv / 22).toBeCloseTo(0.835, 2);
    // The engine's prefix-sum implementation agrees with the plain formula on the same path.
    const dates = ["2024-03-04", "2024-03-05", "2024-03-06", "2024-03-07", "2024-03-08", "2024-03-11"];
    const px: SeriesTuple[] = dates.map((d, k) => [d, closes[k]]);
    const longDates = [...dates, ...Array.from({ length: 30 }, (_, k) => new Date(Date.UTC(2024, 2, 12 + k)).toISOString().slice(0, 10))];
    const extended: SeriesTuple[] = longDates.map((d, k) => [d, k < closes.length ? closes[k] : closes[closes.length - 1]]);
    const { observations } = alignForward(longDates.map((d) => [d, 22] as SeriesTuple), extended);
    const first = observations.find((o) => o.date === "2024-03-04")!;
    // The first window spans 30 days and includes the five moves plus flat days; check the five-move sum directly.
    expect(first.realizedVolPct).toBeCloseTo(100 * Math.sqrt((252 * squares.reduce((s, v) => s + v, 0)) / first.tradingDays), 9);
    expect(px).toHaveLength(6);
  });
});
