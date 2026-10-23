import { describe, expect, it } from "vitest";
import {
  NON_OVERLAP_LAG, OVERLAP_LAG, REGIME_EDGES,
  alignForward, bucketize, buildReadout, computeVixForwardStats, gradeMagnitude, median, ols, pearson, quantile,
  selectObservations, thin, wilsonRate, zHistogram,
  type OlsResult, type VixForwardStats,
} from "./vixImpliedForward";
import { alternatingPath, constantSeries, observation, observationSet, weekdays } from "./vixImpliedForward.fixtures";

const fit = (over: Partial<OlsResult>): OlsResult => ({ n: 100, alpha: 0, beta: 1, r2: 0.6, seAlpha: 1, seBeta: 0.1, tAlpha: 0, tBeta: 10, lag: 3, ...over });

describe("gradeMagnitude thresholds", () => {
  it.each([
    [0.5, "strong"], [0.499, "moderate"], [0.3, "moderate"], [0.299, "weak"], [0.1, "weak"], [0.099, "none"],
  ] as const)("R² %s grades %s", (r2, grade) => expect(gradeMagnitude(fit({ r2 }))).toBe(grade));

  it("requires a positive, significant slope", () => {
    expect(gradeMagnitude(fit({ r2: 0.9, beta: -0.5 }))).toBe("none");
    expect(gradeMagnitude(fit({ r2: 0.9, beta: 0 }))).toBe("none");
    expect(gradeMagnitude(fit({ r2: 0.9, tBeta: 1.99 }))).toBe("none");
    expect(gradeMagnitude(fit({ r2: 0.9, tBeta: 2 }))).toBe("strong");
    expect(gradeMagnitude(null)).toBe("none");
  });
});

/** Stats from a controlled sample, for steering the readout down each wording path. */
function statsFor(zAt: (i: number) => number, opts: { vix?: (i: number) => number; rv?: (i: number) => number; sampling?: "daily" | "monthly"; n?: number } = {}): VixForwardStats {
  const n = opts.n ?? 120;
  const s = computeVixForwardStats(observationSet(n, opts.vix ?? ((i) => 12 + ((i * 7) % 25)), zAt, opts.rv), { sampling: opts.sampling ?? "monthly", scheme: "regime" });
  return s!;
}

describe("readout wording", () => {
  it("calls an overstating VIX when more than 3 points inside ±1σ above normal", () => {
    const stats = statsFor((i) => (i % 10 < 9 ? 0.3 : 1.5));
    expect(stats.calibration.within1.pct).toBeCloseTo(90, 10);
    expect(buildReadout(stats).calibration).toMatch(/overstated the coming 30-day move/);
  });

  it("calls an understating VIX when more than 3 points below normal", () => {
    const stats = statsFor((i) => (i % 2 ? 1.6 : -1.6));
    expect(stats.calibration.within1.pct).toBe(0);
    expect(buildReadout(stats).calibration).toMatch(/understated the coming 30-day move/);
  });

  it("calls a close match inside ±3 points of the normal share", () => {
    // 70 of 100 inside ±1σ: within 3 points of 68.27%.
    const stats = statsFor((i) => (i % 10 < 7 ? 0.4 : 1.7), { n: 100 });
    expect(stats.calibration.within1.pct).toBe(70);
    expect(buildReadout(stats).calibration).toMatch(/close to the 68\.3%/);
  });

  it("reports tails in both directions", () => {
    const stats = statsFor((i) => (i % 20 === 0 ? -3 : i % 20 === 1 ? 2.5 : 0.1));
    const { tails } = buildReadout(stats);
    expect(tails).toMatch(/Falls beyond −2σ happened 5\.0%/);
    expect(tails).toMatch(/rises beyond \+2σ 5\.0%/);
    expect(tails).toMatch(/Excess kurtosis/);
  });

  it("says a rising-with-VIX direction is significant but small", () => {
    const vixAt = (i: number) => 12 + ((i * 7) % 30);
    const stats = statsFor((i) => (vixAt(i) - 25) / 12 + ((i % 3) - 1) * 0.15, { vix: vixAt, n: 200 });
    const readout = buildReadout(stats);
    expect(readout.directionSignificant).toBe(true);
    expect(readout.direction).toMatch(/Higher VIX readings have been followed by higher 30-day returns/);
    expect(readout.direction).toMatch(/explains only/);
  });

  it("says a falling-with-VIX direction in the opposite wording", () => {
    const vixAt = (i: number) => 12 + ((i * 7) % 30);
    const stats = statsFor((i) => -(vixAt(i) - 25) / 12 + ((i % 3) - 1) * 0.15, { vix: vixAt, n: 200 });
    const readout = buildReadout(stats);
    expect(readout.directionSignificant).toBe(true);
    expect(readout.direction).toMatch(/Lower VIX readings have been followed by higher 30-day returns/);
  });

  it("says no reliable direction when the slope is noise", () => {
    const stats = statsFor((i) => (i % 2 ? 0.5 : -0.5), { vix: (i) => 12 + ((i * 7) % 25) });
    const readout = buildReadout(stats);
    expect(readout.directionSignificant).toBe(false);
    expect(readout.direction).toMatch(/No statistically reliable directional signal/);
  });

  it("compares the VIX with trailing volatility in all three ways", () => {
    const base = statsFor(() => 0.3);
    const withBench = (vixR2: number, trailingR2: number): VixForwardStats => ({
      ...base,
      magnitude: { ...base.magnitude, benchmark: { n: 100, vixR2, trailingR2, trailing: fit({ r2: trailingR2 }) } },
    });
    expect(buildReadout(withBench(0.5, 0.3)).magnitude).toMatch(/beats trailing 30-day realized volatility \(30%\)/);
    expect(buildReadout(withBench(0.3, 0.5)).magnitude).toMatch(/trailing 30-day realized volatility does better \(50% versus 30%\)/);
    expect(buildReadout(withBench(0.4, 0.41)).magnitude).toMatch(/does about as well \(41%\)/);
    const noBench: VixForwardStats = { ...base, magnitude: { ...base.magnitude, benchmark: null } };
    expect(buildReadout(noBench).magnitude).not.toMatch(/trailing/);
  });

  it("notes the overlap treatment that matches the sampling mode", () => {
    const daily = buildReadout(statsFor(() => 0.3, { sampling: "daily", n: 2100 })).notes.join(" ");
    expect(daily).toContain(`${OVERLAP_LAG} lags`);
    expect(daily).toMatch(/about 100 independent windows/);
    const monthly = buildReadout(statsFor(() => 0.3, { sampling: "monthly" })).notes.join(" ");
    expect(monthly).toContain(`${NON_OVERLAP_LAG} lags`);
    expect(monthly).not.toMatch(/overlap by up to/);
  });

  it("always carries the in-sample and zero-drift caveats and flags small samples first", () => {
    const small = buildReadout(statsFor(() => 0.3, { n: 15 }));
    expect(small.notes[0]).toMatch(/Small sample/);
    expect(small.notes.join(" ")).toMatch(/in-sample/);
    expect(small.notes.join(" ")).toMatch(/zero drift/);
    expect(buildReadout(statsFor(() => 0.3, { n: 120 })).notes[0]).not.toMatch(/Small sample/);
  });
});

describe("regression edge cases", () => {
  it("lag larger than the sample is clipped, not an error", () => {
    const result = ols([1, 2, 3, 4, 5], [2, 4, 5, 4, 5], 50)!;
    expect(result.lag).toBe(4);
    expect(Number.isFinite(result.seBeta)).toBe(true);
  });

  it("standard errors are never NaN or negative on degenerate residuals", () => {
    const result = ols([1, 2, 3, 4], [1, 2, 3, 4], 2)!;
    expect(result.seBeta).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(result.tBeta)).toBe(false);
  });

  it("pearson matches the sign and size of an exact relation", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});

describe("wilson, quantile and median edges", () => {
  it("handles 0% and 100% without leaving [0, 100]", () => {
    for (const hits of [0, 50]) {
      const r = wilsonRate(hits, 50, 50, 50);
      expect(r.ciLow).toBeGreaterThanOrEqual(0);
      expect(r.ciHigh).toBeLessThanOrEqual(100);
      expect(r.ciLow).toBeLessThanOrEqual(r.pct);
      expect(r.ciHigh).toBeGreaterThanOrEqual(r.pct);
    }
    expect(wilsonRate(0, 0, 0, 50).pct).toBe(0);
  });

  it("median and quantile cover odd, even and single-element input", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([7])).toBe(7);
    expect(quantile([7], 0.9)).toBe(7);
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
  });
});

describe("bucketize edge cases", () => {
  it("returns nothing for an empty sample", () => {
    expect(bucketize([], "regime")).toEqual([]);
    expect(bucketize([], "quintile")).toEqual([]);
  });

  it("puts a VIX exactly on an edge in the higher bucket", () => {
    for (const edge of REGIME_EDGES) {
      const buckets = bucketize([observation("2020-01-01", edge - 0.01, 0), observation("2020-01-02", edge, 0)], "regime");
      expect(buckets).toHaveLength(2);
      expect(buckets[0].n).toBe(1);
      expect(buckets[1].lo).toBe(edge);
    }
  });

  it("collapses quintiles when the VIX has too few distinct levels instead of emitting empty buckets", () => {
    const buckets = bucketize(observationSet(50, (i) => (i % 2 ? 20 : 30), () => 0), "quintile");
    expect(buckets.length).toBeGreaterThan(0);
    expect(buckets.length).toBeLessThanOrEqual(5);
    expect(buckets.every((b) => b.n > 0)).toBe(true);
    expect(buckets.reduce((s, b) => s + b.n, 0)).toBe(50);
  });

  it("every observation lands in exactly one bucket", () => {
    const obs = observationSet(300, (i) => 9 + ((i * 13) % 55), (i) => ((i % 9) - 4) / 3);
    for (const scheme of ["regime", "quintile"] as const) expect(bucketize(obs, scheme).reduce((s, b) => s + b.n, 0)).toBe(300);
  });
});

describe("selectObservations edge cases", () => {
  const dates = weekdays("2019-01-01", 300);
  const { observations } = alignForward(constantSeries(dates, 18), alternatingPath(dates));

  it("returns nothing for an empty or inverted range", () => {
    expect(selectObservations(observations, { start: "2030-01-01", sampling: "daily" })).toEqual([]);
    expect(selectObservations(observations, { start: "2019-06-01", end: "2019-05-01", sampling: "daily" })).toEqual([]);
    expect(selectObservations([], { sampling: "monthly" })).toEqual([]);
  });

  it("includes both endpoints of the date range", () => {
    const first = observations[10].date, last = observations[20].date;
    const picked = selectObservations(observations, { start: first, end: last, sampling: "daily" });
    expect(picked[0].date).toBe(first);
    expect(picked[picked.length - 1].date).toBe(last);
    expect(picked).toHaveLength(11);
  });

  it("monthly sampling starts at the first in-range window, not at the start of the data", () => {
    const picked = selectObservations(observations, { start: "2019-05-01", sampling: "monthly" });
    expect(picked[0].date >= "2019-05-01").toBe(true);
    expect(picked[0].date).toBe(observations.find((o) => o.date >= "2019-05-01")!.date);
  });
});

describe("zHistogram and thin edge cases", () => {
  it("clamps extreme moves into the outer bins", () => {
    const bins = zHistogram([observation("2020-01-01", 20, -9), observation("2020-01-02", 20, 9), observation("2020-01-03", 20, 0)]);
    expect(bins[0].count).toBe(1);
    expect(bins[bins.length - 1].count).toBe(1);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(3);
  });

  it("empty input yields empty counts without NaN", () => {
    const bins = zHistogram([]);
    expect(bins.every((b) => b.count === 0 && b.normal === 0)).toBe(true);
  });

  it("thin returns short input unchanged and is deterministic", () => {
    const rows = [1, 2, 3];
    expect(thin(rows, 10)).toBe(rows);
    const long = Array.from({ length: 5000 }, (_, i) => i);
    expect(thin(long, 300)).toEqual(thin(long, 300));
  });
});

describe("no NaN or Infinity leaks from any stat on a minimal valid sample", () => {
  it("serializes cleanly", () => {
    const stats = computeVixForwardStats(observationSet(10, (i) => 14 + i, (i) => (i - 5) / 4), { sampling: "monthly", scheme: "quintile" })!;
    const json = JSON.stringify(stats, (_, v) => (typeof v === "number" && !Number.isFinite(v) ? "NONFINITE" : v));
    expect(json).not.toContain("NONFINITE");
  });
});
