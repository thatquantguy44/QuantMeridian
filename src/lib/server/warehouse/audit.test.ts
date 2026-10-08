import { describe, expect, it } from "vitest";
import { createWarehouseAuditAdapter } from "./audit";

function fakeStore(rows: Record<string, unknown>[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    calls,
    store: {
      async raw<T>(sql: string, params: unknown[] = []): Promise<T[]> {
        calls.push({ sql, params });
        return rows as T[];
      },
    },
  };
}

describe("Warehouse audit adapter", () => {
  it("queries live run columns and excludes manifest paths and obsolete names", async () => {
    const { store, calls } = fakeStore([
      {
        run_id: "run-1",
        status: "partial",
        started_at: "2026-10-07T00:00:00Z",
        ended_at: "2026-10-07T00:01:00Z",
        series_total: "10",
        series_succeeded: "9",
        series_failed: "1",
      },
    ]);
    const rows = await createWarehouseAuditAdapter(store, "postgres").listRuns({
      status: "partial",
      limit: 50,
    });
    expect(rows[0]).toMatchObject({ runId: "run-1", endedAt: "2026-10-07T00:01:00Z", seriesFailed: 1 });
    expect(calls[0].sql).toContain("FROM audit.etl_run");
    expect(calls[0].sql).toContain("ended_at");
    expect(calls[0].sql).not.toMatch(/finished_at|series_count|rows_written|error_msg|manifest_path/);
    expect(calls[0].params).toEqual(["partial", 50]);
  });

  it("requires a run and binds all series-run filters", async () => {
    const { store, calls } = fakeStore([]);
    const adapter = createWarehouseAuditAdapter(store, "sqlite");
    await expect(adapter.listSeriesRuns({ runId: "", limit: 50 })).rejects.toThrow(/requires runId/);
    await adapter.listSeriesRuns({
      runId: "run-1",
      status: "failed",
      loadType: "full",
      dqPassed: false,
      seriesId: "GDP",
      limit: 200,
    });
    expect(calls[0].sql).toContain("FROM audit_etl_series_run");
    expect(calls[0].sql).toContain("observations_extracted");
    expect(calls[0].sql).toContain("rows_written_bronze");
    expect(calls[0].sql).toContain("rows_merged_silver");
    expect(calls[0].params).toEqual(["run-1", "failed", "full", 0, "GDP", 200]);
  });

  it("uses the latest run with DQ rows and never references checked_at", async () => {
    const { store, calls } = fakeStore([
      {
        run_id: "run-1",
        series_id: "GDP",
        check_name: "freshness",
        passed: 0,
        severity: "error",
        message: "stale",
        metric_value: "30",
      },
    ]);
    const rows = await createWarehouseAuditAdapter(store, "postgres").listDqResults({
      passed: false,
      severity: "error",
      limit: 100,
    });
    expect(rows[0]).toMatchObject({ checkName: "freshness", passed: false, metricValue: 30 });
    expect(calls[0].sql).toContain("FROM audit.data_quality_result d");
    expect(calls[0].sql).toContain("LEFT JOIN audit.etl_run");
    expect(calls[0].sql).not.toMatch(/checked_at|\bresult\b|\bdetail\b/);
    expect(calls[0].params).toEqual(["error", 0, 100]);
  });

  it("binds deterministic run and DQ cursor predicates", async () => {
    const runs = fakeStore([]);
    await createWarehouseAuditAdapter(runs.store, "postgres").listRuns({
      before: { startedAt: "2026-10-07T00:00:00Z", runId: "run-2" },
      limit: 10,
    });
    expect(runs.calls[0].sql).toContain("started_at < $1");
    expect(runs.calls[0].params).toEqual([
      "2026-10-07T00:00:00Z",
      "2026-10-07T00:00:00Z",
      "run-2",
      10,
    ]);

    const dq = fakeStore([]);
    await createWarehouseAuditAdapter(dq.store, "sqlite").listDqResults({
      runId: "run-1",
      after: { severityRank: 1, passedRank: 0, checkName: "freshness", seriesId: "GDP" },
      limit: 20,
    });
    expect(dq.calls[0].sql).toContain("CASE d.severity");
    expect(dq.calls[0].sql).toContain("COALESCE(d.passed, 2)");
    expect(dq.calls[0].params.at(-1)).toBe(20);
  });

  it("rejects unbounded audit requests", async () => {
    const { store } = fakeStore([]);
    const adapter = createWarehouseAuditAdapter(store, "postgres");
    await expect(adapter.listRuns({ limit: 202 })).rejects.toThrow(/between 1 and 201/);
    await expect(adapter.listDqResults({ limit: 0 })).rejects.toThrow(/between 1 and 201/);
  });

  it("fails closed on Databricks", () => {
    const { store } = fakeStore([]);
    expect(() => createWarehouseAuditAdapter(store, "databricks")).toThrow(/does not support Databricks/);
  });
});
