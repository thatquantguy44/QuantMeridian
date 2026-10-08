import { describe, expect, it } from "vitest";
import {
  WarehouseRowDecodeError,
  decodeCatalogEntry,
  decodeDataQualityResult,
  decodeEtlRun,
  decodeEtlSeriesRun,
  decodeObservation,
  decodeRevisionSummary,
  decodeSeriesCoverage,
  sanitizeStoredMessage,
} from "./contracts";

describe("Warehouse Explorer row contracts", () => {
  it("decodes catalog rows without deriving arbitrary links", () => {
    expect(
      decodeCatalogEntry({
        object_name: "gold.treasury_curve",
        object_type: "table",
        module: "CURV",
        grain: "date/tenor",
        intended_visual: "curve",
        description: "Treasury curve",
      })
    ).toEqual({
      objectName: "gold.treasury_curve",
      objectType: "table",
      module: "CURV",
      grain: "date/tenor",
      intendedVisual: "curve",
      description: "Treasury curve",
      moduleHref: null,
    });
  });

  it("preserves identity-only coverage rows and prioritizes curated metadata", () => {
    expect(
      decodeSeriesCoverage({
        source: "fred",
        series_id: "DGS10",
        category: "rates",
        frequency: "daily",
        latest_observation_date: "2026-09-07",
        observation_count: "123",
        days_since_last: 30,
        is_stale: 1,
        dim_title: "Curated title",
        dim_units: "Percent",
        meta_title: "Supplemental title",
      })
    ).toMatchObject({
      source: "fred",
      seriesId: "DGS10",
      title: "Curated title",
      units: "Percent",
      observationCount: 123,
      isStale: true,
      metadataCompleteness: "curated",
    });
    expect(decodeSeriesCoverage({ source: "oecd", series_id: "GDP" })).toMatchObject({
      title: null,
      metadataCompleteness: "identity_only",
    });
  });

  it("decodes observations while preserving missing values", () => {
    expect(
      decodeObservation({
        source: "fred",
        series_id: "GDP",
        observation_date: "2024-01-01",
        value: null,
        is_missing: "1",
        revision_number: "2",
      })
    ).toMatchObject({ value: null, isMissing: true, revisionNumber: 2 });
  });

  it("decodes revision numerics from PostgreSQL or SQLite driver values", () => {
    expect(
      decodeRevisionSummary({
        series_id: "GDP",
        observation_date: "2024-01-01",
        revision_count: "3",
        first_value: "100.5",
        latest_value: 101,
        revision_delta: "0.5",
        revision_pct: "0.4975",
      })
    ).toMatchObject({ revisionCount: 3, firstValue: 100.5, latestValue: 101, revisionDelta: 0.5 });
  });

  it("uses the live audit schema and omits manifest_path", () => {
    const decoded = decodeEtlRun({
      run_id: "run-1",
      environment: "dev",
      manifest_path: "/secret/internal/path",
      triggered_by: "schedule",
      status: "partial",
      started_at: "2026-10-07T00:00:00Z",
      ended_at: null,
      duration_seconds: "12.5",
      series_total: "10",
      series_succeeded: 8,
      series_failed: 2,
      series_skipped_not_due: "0",
      error_message: "password=hunter2 request failed",
    });
    expect(decoded).toMatchObject({
      runId: "run-1",
      endedAt: null,
      seriesTotal: 10,
      seriesSucceeded: 8,
      seriesFailed: 2,
      errorMessage: "password=[redacted] request failed",
    });
    expect(decoded).not.toHaveProperty("manifestPath");
  });

  it("decodes live series-run and DQ boolean fields", () => {
    expect(
      decodeEtlSeriesRun({
        run_id: "run-1",
        series_id: "GDP",
        status: "failed",
        observations_extracted: "12",
        rows_written_bronze: "10",
        rows_merged_silver: 8,
        dq_passed: 0,
      })
    ).toMatchObject({ observationsExtracted: 12, rowsWrittenBronze: 10, rowsMergedSilver: 8, dqPassed: false });
    expect(
      decodeDataQualityResult({
        run_id: "run-1",
        series_id: "GDP",
        check_name: "not_null",
        passed: "0",
        severity: "error",
        message: "failed",
        metric_value: "4",
      })
    ).toMatchObject({ passed: false, severity: "error", message: "failed", metricValue: 4 });
  });

  it("sanitizes URLs, credentials, tokens, controls, and excessive messages", () => {
    const message = sanitizeStoredMessage(
      `connect postgresql://fred:secret@localhost/db token=abc123\n${"x".repeat(600)}`
    );
    expect(message).toContain("[redacted-url]");
    expect(message).toContain("token=[redacted]");
    expect(message).not.toContain("secret@");
    expect(message).not.toContain("abc123");
    expect(message?.length).toBeLessThanOrEqual(500);
  });

  it("fails closed when required identity fields are absent", () => {
    expect(() => decodeObservation({ source: "fred", observation_date: "2024-01-01" })).toThrow(
      WarehouseRowDecodeError
    );
  });
});

