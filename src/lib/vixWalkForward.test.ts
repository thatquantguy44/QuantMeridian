import { describe, expect, it } from "vitest";
import crisis from "./__fixtures__/vixr/gold-crisis_2007_2009.json";
import calm from "./__fixtures__/vixr/gold-calm_2017.json";
import expectedCrisis from "./__fixtures__/vixr/expected-crisis_2007_2009.json";
import expectedCalm from "./__fixtures__/vixr/expected-calm_2017.json";
import { addDays, alignForward, selectObservations, type ForwardObservation, type SeriesTuple, type VixForwardSampling } from "./vixImpliedForward";
import { observation, weekdays } from "./vixImpliedForward.fixtures";
import { MIN_TEST, buildWalkForwardReadout, dieboldMarianoT, walkForward, type ModelScore } from "./vixWalkForward";
import { bucketsToCsv, csvFilename, csvNum, csvText, forecastsToCsv, windowsToCsv } from "./vixrCsv";
import { bucketize } from "./vixImpliedForward";

const LAG = { daily: 21, monthly: 3 } as const;
const sample = (fixture: { vix: unknown; spy: unknown }, sampling: VixForwardSampling) =>
  selectObservations(alignForward(fixture.vix as SeriesTuple[], fixture.spy as SeriesTuple[]).observations, { sampling });

const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

type RefScore = { rmse: number; mae: number; bias: number; oosR2: number; dmVsBenchmark: number | null; dmVsTrailing: number | null };
function expectScore(actual: ModelScore, ref: RefScore) {
  close(actual.rmse, ref.rmse);
  close(actual.mae, ref.mae);
  close(actual.bias, ref.bias);
  close(actual.oosR2, ref.oosR2);
  for (const key of ["dmVsBenchmark", "dmVsTrailing"] as const) {
    if (ref[key] === null) expect(actual[key]).toBeNull();
    else close(actual[key]!, ref[key]!, 1e-5);
  }
}

/** A forward observation with every field the walk-forward needs. */
const obs = (date: string, vix: number, rv: number, ret: number, trailing = rv, endDate = date): ForwardObservation =>
  ({ ...observation(date, vix, 0, rv, endDate), forwardReturnPct: ret, trailingVolPct: trailing });

describe("walk-forward matches the independent reference (real Gold excerpts)", () => {
  const cases = [
    ["crisis daily", crisis, expectedCrisis.daily.walkForward, "daily"],
    ["crisis non-overlapping", crisis, expectedCrisis.monthly.walkForward, "monthly"],
    ["calm 2017 daily", calm, expectedCalm.daily.walkForward, "daily"],
  ] as const;

  for (const [name, fixture, ref, sampling] of cases) {
    it(name, () => {
      const wf = walkForward(sample(fixture, sampling), { minTrain: ref!.minTrain, lag: LAG[sampling] })!;
      expect(wf.n).toBe(ref!.n);
      expect(wf.firstTest).toBe(ref!.firstTest);
      expect(wf.lastTest).toBe(ref!.lastTest);
      expect(wf.trainAtFirstTest).toBe(ref!.trainAtFirstTest);
      expect(wf.trainAtLastTest).toBe(ref!.trainAtLastTest);
      for (const [id, score] of Object.entries(ref!.vol)) expectScore(wf.vol.find((m) => m.id === id)!, score as RefScore);
      for (const [id, score] of Object.entries(ref!.returns)) expectScore(wf.returns.find((m) => m.id === id)!, score as RefScore);
      const last = wf.points[wf.points.length - 1];
      close(last.vix_calibrated, ref!.lastPoint.vix_calibrated);
      close(last.hist_mean, ref!.lastPoint.hist_mean);
      close(last.ret_vix, ref!.lastPoint.ret_vix);
      close(last.ret_mean, ref!.lastPoint.ret_mean);
    });
  }

  it("is unavailable when too few test windows remain", () => {
    expect(expectedCalm.monthly.walkForward).toBeNull();
    expect(walkForward(sample(calm, "monthly"), { minTrain: 5, lag: 3 })).toBeNull();
  });

  it("finds that recalibration trained on calm years hurt in the crash", () => {
    const wf = walkForward(sample(crisis, "daily"), { minTrain: 252, lag: 21 })!;
    const get = (id: string) => wf.vol.find((m) => m.id === id)!;
    expect(get("vix_raw").oosR2).toBeGreaterThan(get("vix_calibrated").oosR2);
    expect(get("vix_raw").oosR2).toBeGreaterThan(0);
    expect(wf.returns.find((m) => m.id === "ret_vix")!.oosR2).toBeLessThan(0);
  });
});

describe("no look-ahead", () => {
  const all = sample(crisis, "daily");
  const options = { minTrain: 252, lag: 21 };
  const base = walkForward(all, options)!;

  it("changing outcomes after a date never changes forecasts made on or before it", () => {
    const cutoff = "2009-03-31";
    const tampered = all.map((o) => (o.date > cutoff ? { ...o, realizedVolPct: o.realizedVolPct * 7, forwardReturnPct: -50 } : o));
    const after = walkForward(tampered, options)!;
    const early = (wf: typeof base) => wf.points.filter((p) => p.date <= cutoff);
    expect(early(after)).toEqual(early(base));
    expect(early(base).length).toBeGreaterThan(20);
    // Sanity: the tampering does reach later forecasts, so the equality above is not vacuous.
    expect(after.points.some((p, i) => p.date > cutoff && p.hist_mean !== base.points[i].hist_mean)).toBe(true);
  });

  it("windows still open on a test date are excluded from its training (purge)", () => {
    const target = base.points[200];
    const open = (o: ForwardObservation) => o.date < target.date && o.endDate >= target.date;
    expect(all.filter(open).length).toBeGreaterThan(10);
    const tampered = all.map((o) => (open(o) ? { ...o, realizedVolPct: 999, forwardReturnPct: 999 } : o));
    const after = walkForward(tampered, options)!.points.find((p) => p.date === target.date)!;
    expect(after).toEqual(target);
  });

  it("training grows monotonically and every training window finished before the test", () => {
    for (let i = 1; i < base.points.length; i++) expect(base.points[i].trainN).toBeGreaterThanOrEqual(base.points[i - 1].trainN);
    for (const p of base.points) {
      const trained = all.slice(0, p.trainN);
      expect(trained.every((o) => o.endDate < p.date)).toBe(true);
      expect(trained.length).toBeGreaterThanOrEqual(options.minTrain);
    }
  });
});

describe("hand-computed cases", () => {
  const dates = weekdays("2020-01-06", 60);

  it("a VIX that is an exact linear predictor of volatility earns skill 1", () => {
    const rows = dates.map((d, i) => { const vix = 12 + ((i * 7) % 19); return obs(d, vix, 2 + 0.5 * vix, 0.01 * vix, 15); });
    const wf = walkForward(rows, { minTrain: 20, lag: 0 })!;
    const cal = wf.vol.find((m) => m.id === "vix_calibrated")!;
    expect(cal.rmse).toBeLessThan(1e-9);
    expect(cal.oosR2).toBeCloseTo(1, 9);
    const raw = wf.vol.find((m) => m.id === "vix_raw")!;
    // The raw VIX over-forecasts by exactly VIX − (2 + 0.5·VIX) = 0.5·VIX − 2 each time, so its bias is the mean of that.
    const testVix = wf.points.map((p) => p.vix);
    expect(raw.bias).toBeCloseTo(testVix.reduce((s, v) => s + 0.5 * v - 2, 0) / testVix.length, 9);
    expect(raw.bias).toBeGreaterThan(0);
    expect(wf.returns.find((m) => m.id === "ret_vix")!.oosR2).toBeCloseTo(1, 9);
    expect(wf.n).toBe(40);
    expect(wf.trainAtFirstTest).toBe(20);
  });

  it("the historical mean is the expanding mean of training outcomes, to the digit", () => {
    const rows = dates.map((d, i) => obs(d, 15 + (i % 5), 10 + i, 0, 12));
    const wf = walkForward(rows, { minTrain: 20, lag: 0 })!;
    // First test is row 20, trained on rows 0..19 whose realized vols are 10..29: mean 19.5.
    expect(wf.points[0].date).toBe(dates[20]);
    expect(wf.points[0].hist_mean).toBeCloseTo(19.5, 12);
    expect(wf.points[1].hist_mean).toBeCloseTo(20, 12);
  });

  it("returns null below the minimum test count and skips points without a trailing benchmark", () => {
    const make = (count: number) => dates.slice(0, count).map((d, i) => obs(d, 12 + (i % 9), 14 + (i % 4), 0.5, 14));
    expect(walkForward(make(20 + MIN_TEST - 1), { minTrain: 20, lag: 0 })).toBeNull();
    expect(walkForward(make(20 + MIN_TEST), { minTrain: 20, lag: 0 })!.n).toBe(MIN_TEST);
    const noTrailing = dates.map((d, i) => ({ ...obs(d, 12 + ((i * 3) % 11), 14, 0.5), trailingVolPct: null }));
    expect(walkForward(noTrailing, { minTrain: 5, lag: 0 })).toBeNull();
  });

  it("skips test points while the training VIX has no variation, then starts", () => {
    const rows = dates.map((d, i) => obs(d, i < 25 ? 20 : 20 + (i % 6), 15 + (i % 4), 0.2, 15));
    const wf = walkForward(rows, { minTrain: 10, lag: 0 })!;
    expect(wf.points.every((p) => p.trainN > 25 || p.vix_calibrated === p.vix_calibrated)).toBe(true);
    expect(wf.firstTest > dates[25]).toBe(true);
  });
});

describe("Diebold–Mariano", () => {
  it("is null for degenerate input and for identical forecasts", () => {
    expect(dieboldMarianoT([1, 2], [1, 2], 1)).toBeNull();
    expect(dieboldMarianoT([1, 2, 3, 4, 5], [1, 2, 3, 4, 5], 2)).toBeNull();
  });

  it("is negative when the first forecast has the smaller error and flips sign when swapped", () => {
    const good = Array.from({ length: 80 }, (_, i) => 0.2 + 0.1 * Math.sin(i));
    const bad = Array.from({ length: 80 }, (_, i) => 1.0 + 0.3 * Math.cos(i * 1.7));
    const t = dieboldMarianoT(good, bad, 3)!;
    expect(t).toBeLessThan(-5);
    expect(dieboldMarianoT(bad, good, 3)!).toBeCloseTo(-t, 10);
  });

  it("matches a hand-computed value at lag 0", () => {
    const a = [1, 2, 3, 4], b = [2, 2, 2, 2];
    // d = a² − b² = [−3, 0, 5, 12]; mean 3.5; centered [−6.5, −3.5, 1.5, 8.5]; γ0 = (42.25+12.25+2.25+72.25)/4 = 32.25.
    expect(dieboldMarianoT(a, b, 0)!).toBeCloseTo(3.5 / Math.sqrt(32.25 / 4), 12);
  });

  it("long-run variance with lags is wider under positive autocorrelation", () => {
    const e1 = Array.from({ length: 200 }, (_, i) => Math.sin(i / 40) * 1.5);
    const e2 = Array.from({ length: 200 }, () => 0.4);
    expect(Math.abs(dieboldMarianoT(e1, e2, 20)!)).toBeLessThan(Math.abs(dieboldMarianoT(e1, e2, 0)!));
  });
});

describe("readout wording", () => {
  const rows = (calibratedHelps: boolean) => weekdays("2018-01-02", 400).map((d, i) => {
    const vix = 12 + ((i * 7) % 19);
    const noise = ((i * 37) % 11) - 5;
    return obs(d, vix, calibratedHelps ? 2 + 0.5 * vix + 0.1 * noise : 18 + noise * 2, 0.02 * noise, calibratedHelps ? 10 + noise : 18);
  });

  it("reports positive skill with significance language", () => {
    const text = buildWalkForwardReadout(walkForward(rows(true), { minTrain: 60, lag: 3 })!);
    expect(text.volatility).toMatch(/recalibrated VIX beat the historical-mean forecast/);
    expect(text.versusTrailing).toMatch(/Diebold–Mariano/);
    expect(text.notes.join(" ")).toMatch(/expanding window/i);
    expect(text.notes.join(" ")).toMatch(/identical windows/);
  });

  it("reports negative skill plainly", () => {
    const text = buildWalkForwardReadout(walkForward(rows(false), { minTrain: 60, lag: 3 })!);
    expect(text.volatility).toMatch(/did not beat the historical-mean forecast/);
    expect(text.returns).toMatch(/did not beat the historical mean return/);
  });
});

describe("CSV export", () => {
  const meta = { title: "VIX forward windows", lines: [["Source", "Gold VIXCLS and SPY"], ["Note", "line one\nline two"]] as [string, string][] };
  const rows = sample(crisis, "monthly");

  it("neutralizes spreadsheet formulas and quotes special characters", () => {
    expect(csvText("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvText("+1")).toBe("'+1");
    expect(csvText("@cmd")).toBe("'@cmd");
    expect(csvText("-5")).toBe("'-5");
    expect(csvText("a,b")).toBe('"a,b"');
    expect(csvText('say "hi"')).toBe('"say ""hi"""');
    expect(csvText("VIX < 15")).toBe("VIX < 15");
    expect(csvText("Q1 · 12.8–21")).toBe("Q1 · 12.8–21");
  });

  it("writes numbers at full precision and blanks for missing or non-finite values", () => {
    expect(csvNum(0.1 + 0.2)).toBe("0.30000000000000004");
    expect(csvNum(null)).toBe("");
    expect(csvNum(undefined)).toBe("");
    expect(csvNum(Number.NaN)).toBe("");
    expect(csvNum(Number.POSITIVE_INFINITY)).toBe("");
    expect(csvNum(-0.5)).toBe("-0.5");
  });

  it("windows CSV has provenance comments, a header and one row per window that round-trips", () => {
    const lines = windowsToCsv(rows, meta).trimEnd().split("\n");
    expect(lines.slice(0, 3)).toEqual(["# VIX forward windows", "# Source: Gold VIXCLS and SPY", "# Note: line one line two"]);
    expect(lines[3]).toBe("start_date,end_date,vix,implied_1sigma_pct,forward_return_pct,forward_log_return_pct,z,realized_vol_pct,trailing_vol_pct,trading_days");
    expect(lines).toHaveLength(4 + rows.length);
    const first = lines[4].split(",");
    expect(first).toHaveLength(10);
    expect(first[0]).toBe(rows[0].date);
    expect(Number(first[2])).toBe(rows[0].vix);
    expect(Number(first[4])).toBe(rows[0].forwardReturnPct);
    expect(Number(first[6])).toBe(rows[0].z);
    // A missing trailing benchmark exports as an empty cell, not the text "null".
    expect(windowsToCsv([{ ...rows[0], trailingVolPct: null }], meta)).not.toMatch(/null|NaN|undefined/);
  });

  it("bucket CSV keeps open-ended bounds blank", () => {
    const buckets = bucketize(sample(crisis, "daily"), "regime");
    const lines = bucketsToCsv(buckets, meta).trimEnd().split("\n");
    const body = lines.slice(4).map((l) => l.split(","));
    expect(body).toHaveLength(buckets.length);
    expect(body[0][1]).toBe("");
    expect(body[body.length - 1][2]).toBe("");
    expect(body.every((r) => r.length === 15)).toBe(true);
    expect(lines.join("\n")).not.toMatch(/Infinity|NaN/);
  });

  it("forecast CSV has one row per out-of-sample point with all six forecasts", () => {
    const wf = walkForward(sample(crisis, "daily"), { minTrain: 252, lag: 21 })!;
    const lines = forecastsToCsv(wf, meta).trimEnd().split("\n");
    expect(lines).toHaveLength(4 + wf.n);
    const row = lines[4].split(",");
    expect(row).toHaveLength(12);
    expect(Number(row[2])).toBe(wf.points[0].trainN);
    expect(Number(row[7])).toBe(wf.points[0].vix_calibrated);
  });

  it("builds safe, descriptive filenames", () => {
    expect(csvFilename("windows", "spy_price")).toBe("vixr_windows_spy_price.csv");
    expect(csvFilename("buckets", "spy_total", "2008-01-01", "2009-12-31")).toBe("vixr_buckets_spy_total_2008-01-01_to_2009-12-31.csv");
    expect(csvFilename("windows", "spy_price", "2008-01-01")).toBe("vixr_windows_spy_price_2008-01-01.csv");
    expect(addDays("2020-01-01", 1)).toBe("2020-01-02");
  });
});
