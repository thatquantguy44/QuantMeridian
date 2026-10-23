/**
 * CSV export for VIXR. Every file starts with `#` comment lines giving provenance and the settings that produced it,
 * then a header row. Numbers are written at full precision; text cells are quoted when needed and neutralized if a
 * spreadsheet would read them as a formula.
 */
import type { BucketStats, ForwardObservation } from "./vixImpliedForward";
import type { ForecastPoint, WalkForwardResult } from "./vixWalkForward";

export interface CsvMeta {
  /** What the file contains, e.g. "VIX forward windows". */
  title: string;
  /** Key/value lines describing source and settings. */
  lines: [string, string][];
}

/** Quote a text cell; prefix an apostrophe when it starts with a character spreadsheets treat as a formula. */
export function csvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvNum(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "" : String(value);
}

function build(meta: CsvMeta, header: string[], rows: string[][]): string {
  const comments = [`# ${meta.title}`, ...meta.lines.map(([k, v]) => `# ${k}: ${v.replace(/[\r\n]+/g, " ")}`)];
  return [...comments, header.join(","), ...rows.map((r) => r.join(","))].join("\n") + "\n";
}

export function windowsToCsv(observations: ForwardObservation[], meta: CsvMeta): string {
  return build(meta,
    ["start_date", "end_date", "vix", "implied_1sigma_pct", "forward_return_pct", "forward_log_return_pct", "z", "realized_vol_pct", "trailing_vol_pct", "trading_days"],
    observations.map((o) => [csvText(o.date), csvText(o.endDate), csvNum(o.vix), csvNum(o.impliedMovePct), csvNum(o.forwardReturnPct), csvNum(o.forwardLogReturnPct), csvNum(o.z), csvNum(o.realizedVolPct), csvNum(o.trailingVolPct), csvNum(o.tradingDays)]));
}

export function bucketsToCsv(buckets: BucketStats[], meta: CsvMeta): string {
  return build(meta,
    ["bucket", "vix_from_inclusive", "vix_to_exclusive", "n", "avg_vix", "implied_1sigma_pct", "mean_forward_return_pct", "median_forward_return_pct", "pct_up", "mean_abs_move_pct", "mean_realized_vol_pct", "realized_to_implied", "pct_inside_1sigma", "worst_return_pct", "best_return_pct"],
    buckets.map((b) => [csvText(b.label), csvNum(b.lo), csvNum(b.hi), csvNum(b.n), csvNum(b.meanVix), csvNum(b.meanImpliedMovePct), csvNum(b.meanForwardReturnPct), csvNum(b.medianForwardReturnPct), csvNum(b.pctPositive), csvNum(b.meanAbsReturnPct), csvNum(b.meanRealizedVolPct), csvNum(b.realizedToImplied), csvNum(b.within1Pct), csvNum(b.worstReturnPct), csvNum(b.bestReturnPct)]));
}

export function forecastsToCsv(wf: WalkForwardResult, meta: CsvMeta): string {
  const cols: (keyof ForecastPoint)[] = ["trainN", "vix", "actualVolPct", "actualReturnPct", "vix_raw", "vix_calibrated", "trailing", "hist_mean", "ret_mean", "ret_vix"];
  return build(meta,
    ["start_date", "end_date", "training_windows", "vix", "actual_vol_pct", "actual_return_pct", "forecast_vol_vix_raw", "forecast_vol_vix_calibrated", "forecast_vol_trailing", "forecast_vol_hist_mean", "forecast_return_hist_mean", "forecast_return_vix_regression"],
    wf.points.map((p) => [csvText(p.date), csvText(p.endDate), ...cols.map((c) => csvNum(p[c] as number))]));
}

export function csvFilename(kind: string, basis: string, start?: string, end?: string): string {
  const range = [start, end].filter(Boolean).join("_to_");
  return `vixr_${kind}_${basis}${range ? `_${range}` : ""}.csv`;
}
