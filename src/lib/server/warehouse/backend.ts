/**
 * Warehouse Explorer backend boundary.
 *
 * This is the only WHSE module that knows physical warehouse object names.
 * API parameters must never be accepted as a WarehouseObject.
 */

export type WarehouseBackend = "sqlite" | "postgres" | "databricks";

export type WarehouseObject =
  | "coverage"
  | "catalog"
  | "dimSeries"
  | "fredMetadata"
  | "observations"
  | "revisionStats"
  | "etlRuns"
  | "etlSeriesRuns"
  | "dqResults";

type SupportedWarehouseBackend = Exclude<WarehouseBackend, "databricks">;

const OBJECT_NAMES: Record<SupportedWarehouseBackend, Record<WarehouseObject, string>> = {
  postgres: {
    coverage: "gold.v_source_coverage",
    catalog: "gold.powerbi_catalog",
    dimSeries: "gold.dim_series",
    fredMetadata: "meta.fred_series",
    observations: "silver.fred_observation",
    revisionStats: "gold.fred_revision_stats",
    etlRuns: "audit.etl_run",
    etlSeriesRuns: "audit.etl_series_run",
    dqResults: "audit.data_quality_result",
  },
  sqlite: {
    coverage: "gold_v_source_coverage",
    catalog: "gold_powerbi_catalog",
    dimSeries: "gold_dim_series",
    fredMetadata: "meta_fred_series",
    observations: "silver_fred_observation",
    revisionStats: "gold_fred_revision_stats",
    etlRuns: "audit_etl_run",
    etlSeriesRuns: "audit_etl_series_run",
    dqResults: "audit_data_quality_result",
  },
};

const DEFAULT_QUERY_TIMEOUT_MS = 5_000;
const MIN_QUERY_TIMEOUT_MS = 1_000;
const MAX_QUERY_TIMEOUT_MS = 15_000;

export type WarehouseGateCode =
  | "BACKEND_UNSUPPORTED"
  | "DATABASE_UNAVAILABLE"
  | "PRODUCTION_GATE_CLOSED";

export interface WarehouseBackendStatus {
  backend: WarehouseBackend;
  configured: boolean;
  supported: boolean;
  production: boolean;
  gateOpen: boolean;
  target: string;
  queryTimeoutMs: number;
  code: WarehouseGateCode | null;
  reason: string | null;
}

type Env = Record<string, string | undefined>;

function enabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function productionRuntime(env: Env): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

export function detectWarehouseBackend(env: Env = process.env): WarehouseBackend {
  if (env.MACRO_DB_BACKEND === "databricks") return "databricks";
  if (/^postgres(ql)?:\/\//i.test(env.MACRO_DB_URL ?? "")) return "postgres";
  return "sqlite";
}

function backendConfigured(backend: WarehouseBackend, env: Env): boolean {
  if (backend === "databricks") {
    return Boolean(env.DATABRICKS_HOST && env.DATABRICKS_HTTP_PATH && env.DATABRICKS_TOKEN);
  }
  return Boolean(env.MACRO_DB_URL);
}

function postgresTarget(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || "?";
    const port = url.port || "5432";
    return `backend=postgres, host=${url.hostname || "?"}, port=${port}, database=${database}`;
  } catch {
    return "backend=postgres, target=invalid";
  }
}

function sqliteTarget(rawUrl: string): string {
  const rawPath = rawUrl.replace(/^sqlite:/i, "");
  const filename = rawPath.split(/[\\/]/).filter(Boolean).at(-1);
  return `backend=sqlite, file=${filename || "?"}`;
}

function databricksTarget(rawHost: string): string {
  try {
    const url = new URL(rawHost);
    return `backend=databricks, host=${url.hostname || "?"}`;
  } catch {
    return "backend=databricks, host=?";
  }
}

/** Redacted display target. Never includes user, password, query string, or a full file path. */
export function describeWarehouseTarget(
  backend: WarehouseBackend,
  env: Env = process.env
): string {
  if (backend === "postgres") return postgresTarget(env.MACRO_DB_URL ?? "");
  if (backend === "databricks") return databricksTarget(env.DATABRICKS_HOST ?? "");
  return sqliteTarget(env.MACRO_DB_URL ?? "");
}

export function warehouseQueryTimeoutMs(env: Env = process.env): number {
  const parsed = Number.parseInt(env.WAREHOUSE_EXPLORER_QUERY_TIMEOUT_MS ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_QUERY_TIMEOUT_MS;
  return Math.min(MAX_QUERY_TIMEOUT_MS, Math.max(MIN_QUERY_TIMEOUT_MS, parsed));
}

/**
 * Resolve the deployment gate without touching the database.
 *
 * A later readiness probe must still verify that the PostgreSQL session is
 * transaction-read-only. These flags are operator attestations, not a grant check.
 */
export function warehouseBackendStatus(env: Env = process.env): WarehouseBackendStatus {
  const backend = detectWarehouseBackend(env);
  const configured = backendConfigured(backend, env);
  const production = productionRuntime(env);
  const base = {
    backend,
    configured,
    production,
    target: describeWarehouseTarget(backend, env),
    queryTimeoutMs: warehouseQueryTimeoutMs(env),
  };

  if (backend === "databricks") {
    return {
      ...base,
      supported: false,
      gateOpen: false,
      code: "BACKEND_UNSUPPORTED",
      reason: "Warehouse Explorer does not support the Databricks backend in version one.",
    };
  }

  if (!configured) {
    return {
      ...base,
      supported: true,
      gateOpen: false,
      code: "DATABASE_UNAVAILABLE",
      reason: "MACRO_DB_URL is not configured.",
    };
  }

  if (!production) {
    return { ...base, supported: true, gateOpen: true, code: null, reason: null };
  }

  const productionEnabled = enabled(env.WAREHOUSE_EXPLORER_PRODUCTION_ENABLED);
  const readOnlyAcknowledged = enabled(env.WAREHOUSE_EXPLORER_READ_ONLY_ACK);
  const networkRestrictedAcknowledged = enabled(env.WAREHOUSE_EXPLORER_NETWORK_RESTRICTED_ACK);
  if (
    backend !== "postgres" ||
    !productionEnabled ||
    !readOnlyAcknowledged ||
    !networkRestrictedAcknowledged
  ) {
    return {
      ...base,
      supported: true,
      gateOpen: false,
      code: "PRODUCTION_GATE_CLOSED",
      reason: "Warehouse Explorer production access requires PostgreSQL and all safety acknowledgements.",
    };
  }

  return { ...base, supported: true, gateOpen: true, code: null, reason: null };
}

/** Fixed logical-to-physical mapping. Databricks fails closed in version one. */
export function warehouseTable(
  object: WarehouseObject,
  backend: WarehouseBackend = detectWarehouseBackend()
): string {
  if (backend === "databricks") {
    throw new Error("Warehouse Explorer does not support Databricks physical objects.");
  }
  return OBJECT_NAMES[backend][object];
}

/** Positional parameter marker for the supported warehouse dialects. */
export function warehouseParam(
  index: number,
  backend: WarehouseBackend = detectWarehouseBackend()
): string {
  if (!Number.isInteger(index) || index < 1) throw new Error("Warehouse parameter index must be positive.");
  if (backend === "databricks") throw new Error("Warehouse Explorer does not support Databricks parameters.");
  return backend === "postgres" ? `$${index}` : "?";
}

