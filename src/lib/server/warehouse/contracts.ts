import type { WarehouseBackend } from "./backend";

export type WarehouseSource = "DB" | "ERR" | "UNAVAILABLE";
export type MetadataCompleteness = "curated" | "supplemental" | "identity_only";

export interface WarehouseWarning {
  code: string;
  message: string;
  count?: number;
}

export interface WarehouseSuccess<T> {
  ok: true;
  source: "DB";
  backend: Exclude<WarehouseBackend, "databricks">;
  observedAt: string;
  freshness?: {
    newestIngestionAt: string | null;
    newestObservationDate: string | null;
    ageDays: number | null;
  };
  data: T;
  page?: { limit: number; returned: number; nextCursor: string | null };
  warnings: WarehouseWarning[];
}

export type WarehouseFailureCode =
  | "INVALID_REQUEST"
  | "BACKEND_UNSUPPORTED"
  | "PRODUCTION_GATE_CLOSED"
  | "DATABASE_UNAVAILABLE"
  | "QUERY_TIMEOUT"
  | "SERIES_NOT_FOUND"
  | "REVISION_SOURCE_UNSUPPORTED"
  | "CURSOR_INVALID";

export interface WarehouseFailure {
  ok: false;
  source: "ERR" | "UNAVAILABLE";
  code: WarehouseFailureCode;
  message: string;
  retryable: boolean;
}

export interface CatalogEntry {
  objectName: string;
  objectType: string | null;
  module: string | null;
  grain: string | null;
  intendedVisual: string | null;
  description: string | null;
  moduleHref: string | null;
}

export interface SeriesCoverage {
  source: string;
  seriesId: string;
  title: string | null;
  category: string | null;
  frequency: string | null;
  units: string | null;
  latestObservationDate: string | null;
  observationCount: number | null;
  daysSinceLast: number | null;
  isStale: boolean | null;
  metadataCompleteness: MetadataCompleteness;
}

export interface Observation {
  source: string;
  seriesId: string;
  observationDate: string;
  realtimeStart: string | null;
  realtimeEnd: string | null;
  value: number | null;
  isMissing: boolean;
  revisionNumber: number | null;
  ingestedAt: string | null;
}

export interface RevisionSummary {
  seriesId: string;
  observationDate: string;
  revisionCount: number | null;
  firstValue: number | null;
  firstRealtimeStart: string | null;
  latestValue: number | null;
  latestRealtimeStart: string | null;
  revisionDelta: number | null;
  revisionPct: number | null;
}

export interface EtlRun {
  runId: string;
  environment: string | null;
  triggeredBy: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  seriesTotal: number | null;
  seriesSucceeded: number | null;
  seriesFailed: number | null;
  seriesSkippedNotDue: number | null;
  errorMessage: string | null;
}

export interface EtlSeriesRun {
  runId: string;
  seriesId: string;
  status: string;
  loadType: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  observationsExtracted: number | null;
  rowsWrittenBronze: number | null;
  rowsMergedSilver: number | null;
  dqPassed: boolean | null;
  errorMessage: string | null;
}

export interface DataQualityResult {
  runId: string;
  seriesId: string;
  checkName: string;
  passed: boolean | null;
  severity: string | null;
  message: string | null;
  metricValue: number | null;
}

type Row = Record<string, unknown>;

export class WarehouseRowDecodeError extends Error {
  constructor(readonly field: string) {
    super(`Warehouse row is missing required field: ${field}`);
    this.name = "WarehouseRowDecodeError";
  }
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const result = String(value).trim();
  return result || null;
}

function requiredText(row: Row, field: string): string {
  const result = text(row[field]);
  if (result == null) throw new WarehouseRowDecodeError(field);
  return result;
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : null;
}

function booleanValue(value: unknown): boolean | null {
  if (value == null || value === "") return null;
  if (value === true || value === 1 || value === "1" || value === "true" || value === "t") return true;
  if (value === false || value === 0 || value === "0" || value === "false" || value === "f") return false;
  return null;
}

const MAX_STORED_MESSAGE_LENGTH = 500;

/** Remove credential-shaped material, URLs, controls, and excessive stored text. */
export function sanitizeStoredMessage(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const sanitized = raw
    .replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ")
    .replace(/\b(?:postgres(?:ql)?|https?|ftp):\/\/[^\s]+/giu, "[redacted-url]")
    .replace(/\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/giu, "$1=[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+){1,2}\b/gu, "[redacted-token]")
    .replace(/\s+/g, " ")
    .trim();
  if (!sanitized) return null;
  return sanitized.length <= MAX_STORED_MESSAGE_LENGTH
    ? sanitized
    : `${sanitized.slice(0, MAX_STORED_MESSAGE_LENGTH - 1)}…`;
}

export function decodeCatalogEntry(row: Row, moduleHref: string | null = null): CatalogEntry {
  return {
    objectName: requiredText(row, "object_name"),
    objectType: text(row.object_type),
    module: text(row.module),
    grain: text(row.grain),
    intendedVisual: text(row.intended_visual),
    description: text(row.description),
    moduleHref,
  };
}

export function decodeSeriesCoverage(row: Row): SeriesCoverage {
  const curatedTitle = text(row.dim_title);
  const curatedUnits = text(row.dim_units);
  const supplementalTitle = text(row.meta_title);
  const supplementalUnits = text(row.meta_units);
  const curated = Boolean(curatedTitle || curatedUnits);
  const supplemental = Boolean(supplementalTitle || supplementalUnits);
  return {
    source: requiredText(row, "source"),
    seriesId: requiredText(row, "series_id"),
    title: curatedTitle ?? supplementalTitle,
    category: text(row.category),
    frequency: text(row.frequency),
    units: curatedUnits ?? supplementalUnits,
    latestObservationDate: text(row.latest_observation_date),
    observationCount: finiteNumber(row.observation_count),
    daysSinceLast: finiteNumber(row.days_since_last),
    isStale: booleanValue(row.is_stale),
    metadataCompleteness: curated ? "curated" : supplemental ? "supplemental" : "identity_only",
  };
}

export function decodeObservation(row: Row): Observation {
  const missing = booleanValue(row.is_missing) ?? row.value == null;
  return {
    source: requiredText(row, "source"),
    seriesId: requiredText(row, "series_id"),
    observationDate: requiredText(row, "observation_date"),
    realtimeStart: text(row.realtime_start),
    realtimeEnd: text(row.realtime_end),
    value: finiteNumber(row.value),
    isMissing: missing,
    revisionNumber: finiteNumber(row.revision_number),
    ingestedAt: text(row.ingested_at),
  };
}

export function decodeRevisionSummary(row: Row): RevisionSummary {
  return {
    seriesId: requiredText(row, "series_id"),
    observationDate: requiredText(row, "observation_date"),
    revisionCount: finiteNumber(row.revision_count),
    firstValue: finiteNumber(row.first_value),
    firstRealtimeStart: text(row.first_realtime_start),
    latestValue: finiteNumber(row.latest_value),
    latestRealtimeStart: text(row.latest_realtime_start),
    revisionDelta: finiteNumber(row.revision_delta),
    revisionPct: finiteNumber(row.revision_pct),
  };
}

export function decodeEtlRun(row: Row): EtlRun {
  return {
    runId: requiredText(row, "run_id"),
    environment: text(row.environment),
    triggeredBy: text(row.triggered_by),
    status: requiredText(row, "status"),
    startedAt: requiredText(row, "started_at"),
    endedAt: text(row.ended_at),
    durationSeconds: finiteNumber(row.duration_seconds),
    seriesTotal: finiteNumber(row.series_total),
    seriesSucceeded: finiteNumber(row.series_succeeded),
    seriesFailed: finiteNumber(row.series_failed),
    seriesSkippedNotDue: finiteNumber(row.series_skipped_not_due),
    errorMessage: sanitizeStoredMessage(row.error_message),
  };
}

export function decodeEtlSeriesRun(row: Row): EtlSeriesRun {
  return {
    runId: requiredText(row, "run_id"),
    seriesId: requiredText(row, "series_id"),
    status: requiredText(row, "status"),
    loadType: text(row.load_type),
    startedAt: text(row.started_at),
    endedAt: text(row.ended_at),
    durationSeconds: finiteNumber(row.duration_seconds),
    observationsExtracted: finiteNumber(row.observations_extracted),
    rowsWrittenBronze: finiteNumber(row.rows_written_bronze),
    rowsMergedSilver: finiteNumber(row.rows_merged_silver),
    dqPassed: booleanValue(row.dq_passed),
    errorMessage: sanitizeStoredMessage(row.error_message),
  };
}

export function decodeDataQualityResult(row: Row): DataQualityResult {
  return {
    runId: requiredText(row, "run_id"),
    seriesId: requiredText(row, "series_id"),
    checkName: requiredText(row, "check_name"),
    passed: booleanValue(row.passed),
    severity: text(row.severity),
    message: sanitizeStoredMessage(row.message),
    metricValue: finiteNumber(row.metric_value),
  };
}
