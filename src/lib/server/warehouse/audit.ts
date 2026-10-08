import { goldStore, type GoldStore } from "../goldStore";
import { detectWarehouseBackend, warehouseParam, warehouseTable, type WarehouseBackend } from "./backend";
import {
  decodeDataQualityResult,
  decodeEtlRun,
  decodeEtlSeriesRun,
  type DataQualityResult,
  type EtlRun,
  type EtlSeriesRun,
} from "./contracts";

export const ETL_RUN_STATUSES = ["failed", "partial", "running", "succeeded"] as const;
export const ETL_SERIES_STATUSES = ["failed", "succeeded"] as const;
export const ETL_LOAD_TYPES = ["full", "restate_last_24", "restate_last_36", "restate_last_90"] as const;
export const DQ_SEVERITIES = ["error", "warning"] as const;

export type EtlRunStatus = (typeof ETL_RUN_STATUSES)[number];
export type EtlSeriesStatus = (typeof ETL_SERIES_STATUSES)[number];
export type EtlLoadType = (typeof ETL_LOAD_TYPES)[number];
export type DqSeverity = (typeof DQ_SEVERITIES)[number];

type QueryStore = Pick<GoldStore, "raw">;

export interface ListRunsOptions {
  runId?: string;
  status?: EtlRunStatus;
  before?: { startedAt: string; runId: string };
  limit: number;
}

export interface ListSeriesRunsOptions {
  runId: string;
  status?: EtlSeriesStatus;
  loadType?: EtlLoadType;
  dqPassed?: boolean;
  seriesId?: string;
  limit: number;
}

export interface ListDqResultsOptions {
  runId?: string;
  seriesId?: string;
  severity?: DqSeverity;
  passed?: boolean;
  checkName?: string;
  after?: { severityRank: number; passedRank: number; checkName: string; seriesId: string };
  limit: number;
}

function addEquality(
  clauses: string[],
  params: unknown[],
  backend: WarehouseBackend,
  column: string,
  value: unknown
): void {
  if (value === undefined) return;
  params.push(value);
  clauses.push(`${column} = ${warehouseParam(params.length, backend)}`);
}

function boundedLimit(limit: number, maximum = 200): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw new Error(`Warehouse audit limit must be between 1 and ${maximum}.`);
  }
  return limit;
}

export interface WarehouseAuditAdapter {
  listRuns(options: ListRunsOptions): Promise<EtlRun[]>;
  listSeriesRuns(options: ListSeriesRunsOptions): Promise<EtlSeriesRun[]>;
  listDqResults(options: ListDqResultsOptions): Promise<DataQualityResult[]>;
}

/**
 * Shared, bounded adapter for WHSE and DATAOPS. It selects only reviewed live
 * columns and never returns manifest_path or raw database error fields.
 */
export function createWarehouseAuditAdapter(
  store: QueryStore = goldStore(),
  backend: WarehouseBackend = detectWarehouseBackend()
): WarehouseAuditAdapter {
  if (backend === "databricks") {
    throw new Error("Warehouse Explorer audit access does not support Databricks.");
  }

  const runTable = warehouseTable("etlRuns", backend);
  const seriesTable = warehouseTable("etlSeriesRuns", backend);
  const dqTable = warehouseTable("dqResults", backend);

  return {
    async listRuns(options) {
      const clauses: string[] = [];
      const params: unknown[] = [];
      addEquality(clauses, params, backend, "run_id", options.runId);
      addEquality(clauses, params, backend, "status", options.status);
      if (options.before) {
        params.push(options.before.startedAt);
        const startedAtBefore = warehouseParam(params.length, backend);
        params.push(options.before.startedAt);
        const startedAtEqual = warehouseParam(params.length, backend);
        params.push(options.before.runId);
        const runId = warehouseParam(params.length, backend);
        clauses.push(`(started_at < ${startedAtBefore} OR (started_at = ${startedAtEqual} AND run_id < ${runId}))`);
      }
      params.push(boundedLimit(options.limit, 201));
      const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
      const sql = `SELECT run_id, environment, triggered_by, status, started_at, ended_at,
        duration_seconds, series_total, series_succeeded, series_failed,
        series_skipped_not_due, error_message
        FROM ${runTable}${where}
        ORDER BY started_at DESC, run_id DESC
        LIMIT ${warehouseParam(params.length, backend)}`;
      const rows = await store.raw<Record<string, unknown>>(sql, params);
      return rows.map(decodeEtlRun);
    },

    async listSeriesRuns(options) {
      if (!options.runId) throw new Error("Warehouse series-run access requires runId.");
      const clauses: string[] = [];
      const params: unknown[] = [];
      addEquality(clauses, params, backend, "run_id", options.runId);
      addEquality(clauses, params, backend, "status", options.status);
      addEquality(clauses, params, backend, "load_type", options.loadType);
      addEquality(
        clauses,
        params,
        backend,
        "dq_passed",
        options.dqPassed === undefined ? undefined : options.dqPassed ? 1 : 0
      );
      addEquality(clauses, params, backend, "series_id", options.seriesId);
      params.push(boundedLimit(options.limit));
      const sql = `SELECT run_id, series_id, status, load_type, started_at, ended_at,
        duration_seconds, observations_extracted, rows_written_bronze,
        rows_merged_silver, dq_passed, error_message
        FROM ${seriesTable}
        WHERE ${clauses.join(" AND ")}
        ORDER BY started_at DESC, series_id ASC
        LIMIT ${warehouseParam(params.length, backend)}`;
      const rows = await store.raw<Record<string, unknown>>(sql, params);
      return rows.map(decodeEtlSeriesRun);
    },

    async listDqResults(options) {
      const clauses: string[] = [];
      const params: unknown[] = [];

      if (options.runId) {
        addEquality(clauses, params, backend, "d.run_id", options.runId);
      } else {
        clauses.push(`d.run_id = (
          SELECT d2.run_id
          FROM ${dqTable} d2
          LEFT JOIN ${runTable} r2 ON r2.run_id = d2.run_id
          ORDER BY r2.started_at DESC, d2.run_id DESC
          LIMIT 1
        )`);
      }
      addEquality(clauses, params, backend, "d.series_id", options.seriesId);
      addEquality(clauses, params, backend, "d.severity", options.severity);
      addEquality(
        clauses,
        params,
        backend,
        "d.passed",
        options.passed === undefined ? undefined : options.passed ? 1 : 0
      );
      addEquality(clauses, params, backend, "d.check_name", options.checkName);
      if (options.after) {
        const severityExpr = "CASE d.severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END";
        const passedExpr = "COALESCE(d.passed, 2)";
        const checkExpr = "COALESCE(d.check_name, '')";
        const seriesExpr = "COALESCE(d.series_id, '')";
        const bind = (value: unknown) => {
          params.push(value);
          return warehouseParam(params.length, backend);
        };
        const severity1 = bind(options.after.severityRank);
        const severity2 = bind(options.after.severityRank);
        const passed1 = bind(options.after.passedRank);
        const severity3 = bind(options.after.severityRank);
        const passed2 = bind(options.after.passedRank);
        const check1 = bind(options.after.checkName);
        const severity4 = bind(options.after.severityRank);
        const passed3 = bind(options.after.passedRank);
        const check2 = bind(options.after.checkName);
        const series1 = bind(options.after.seriesId);
        clauses.push(`(
          ${severityExpr} > ${severity1}
          OR (${severityExpr} = ${severity2} AND ${passedExpr} > ${passed1})
          OR (${severityExpr} = ${severity3} AND ${passedExpr} = ${passed2} AND ${checkExpr} > ${check1})
          OR (${severityExpr} = ${severity4} AND ${passedExpr} = ${passed3} AND ${checkExpr} = ${check2} AND ${seriesExpr} > ${series1})
        )`);
      }
      params.push(boundedLimit(options.limit, 201));

      const sql = `SELECT d.run_id, d.series_id, d.check_name, d.passed,
        d.severity, d.message, d.metric_value
        FROM ${dqTable} d
        WHERE ${clauses.join(" AND ")}
        ORDER BY
          CASE d.severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
          COALESCE(d.passed, 2) ASC, COALESCE(d.check_name, '') ASC,
          COALESCE(d.series_id, '') ASC
        LIMIT ${warehouseParam(params.length, backend)}`;
      const rows = await store.raw<Record<string, unknown>>(sql, params);
      return rows.map(decodeDataQualityResult);
    },
  };
}

let singleton: WarehouseAuditAdapter | null = null;

export function warehouseAudit(): WarehouseAuditAdapter {
  if (!singleton) singleton = createWarehouseAuditAdapter();
  return singleton;
}
