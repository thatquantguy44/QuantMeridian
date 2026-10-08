import { describe, expect, it } from "vitest";
import {
  describeWarehouseTarget,
  detectWarehouseBackend,
  warehouseBackendStatus,
  warehouseParam,
  warehouseQueryTimeoutMs,
  warehouseTable,
  type WarehouseObject,
} from "./backend";

const OBJECTS: WarehouseObject[] = [
  "coverage",
  "catalog",
  "dimSeries",
  "fredMetadata",
  "observations",
  "revisionStats",
  "etlRuns",
  "etlSeriesRuns",
  "dqResults",
];

describe("Warehouse Explorer backend boundary", () => {
  it("detects the supported backends and gives Databricks explicit precedence", () => {
    expect(detectWarehouseBackend({ MACRO_DB_URL: "sqlite:./fred.db" })).toBe("sqlite");
    expect(detectWarehouseBackend({ MACRO_DB_URL: "postgresql://host/db" })).toBe("postgres");
    expect(
      detectWarehouseBackend({
        MACRO_DB_BACKEND: "databricks",
        MACRO_DB_URL: "postgresql://host/db",
      })
    ).toBe("databricks");
  });

  it("maps every logical object for PostgreSQL and SQLite", () => {
    for (const object of OBJECTS) {
      expect(warehouseTable(object, "postgres")).toMatch(/^(gold|meta|silver|audit)\./);
      expect(warehouseTable(object, "sqlite")).toMatch(/^(gold|meta|silver|audit)_/);
    }
    expect(warehouseTable("observations", "postgres")).toBe("silver.fred_observation");
    expect(warehouseTable("observations", "sqlite")).toBe("silver_fred_observation");
  });

  it("fails closed for Databricks names and parameters", () => {
    expect(() => warehouseTable("coverage", "databricks")).toThrow(/does not support Databricks/);
    expect(() => warehouseParam(1, "databricks")).toThrow(/does not support Databricks/);
  });

  it("uses dialect-correct parameter markers", () => {
    expect(warehouseParam(3, "postgres")).toBe("$3");
    expect(warehouseParam(3, "sqlite")).toBe("?");
    expect(() => warehouseParam(0, "postgres")).toThrow(/positive/);
  });

  it("redacts credentials, query strings, and full SQLite paths", () => {
    const pgUrl = "postgresql://fred:secret@localhost:55432/macro_medallion?sslmode=require";
    const pgTarget = describeWarehouseTarget("postgres", { MACRO_DB_URL: pgUrl });
    expect(pgTarget).toBe("backend=postgres, host=localhost, port=55432, database=macro_medallion");
    expect(pgTarget).not.toContain("fred");
    expect(pgTarget).not.toContain("secret");
    expect(pgTarget).not.toContain("sslmode");

    const sqliteTarget = describeWarehouseTarget("sqlite", {
      MACRO_DB_URL: "sqlite:/private/data/fred_local.db",
    });
    expect(sqliteTarget).toBe("backend=sqlite, file=fred_local.db");
    expect(sqliteTarget).not.toContain("/private/data");
  });

  it("allows configured PostgreSQL and SQLite in non-production", () => {
    expect(
      warehouseBackendStatus({ NODE_ENV: "development", MACRO_DB_URL: "sqlite:./fred.db" })
    ).toMatchObject({ backend: "sqlite", supported: true, configured: true, gateOpen: true });
    expect(
      warehouseBackendStatus({
        NODE_ENV: "development",
        MACRO_DB_URL: "postgresql://localhost/macro_medallion",
      })
    ).toMatchObject({ backend: "postgres", supported: true, configured: true, gateOpen: true });
  });

  it("fails closed when configuration is missing or the backend is unsupported", () => {
    expect(warehouseBackendStatus({ NODE_ENV: "development" })).toMatchObject({
      gateOpen: false,
      code: "DATABASE_UNAVAILABLE",
    });
    expect(
      warehouseBackendStatus({
        NODE_ENV: "development",
        MACRO_DB_BACKEND: "databricks",
        DATABRICKS_HOST: "https://workspace.example",
        DATABRICKS_HTTP_PATH: "/sql/warehouse",
        DATABRICKS_TOKEN: "token",
      })
    ).toMatchObject({ supported: false, gateOpen: false, code: "BACKEND_UNSUPPORTED" });
  });

  it("requires PostgreSQL and all safety acknowledgements in production", () => {
    const pg = {
      NODE_ENV: "production",
      MACRO_DB_URL: "postgresql://localhost/macro_medallion",
      WAREHOUSE_EXPLORER_PRODUCTION_ENABLED: "true",
      WAREHOUSE_EXPLORER_READ_ONLY_ACK: "true",
      WAREHOUSE_EXPLORER_NETWORK_RESTRICTED_ACK: "true",
    };
    expect(warehouseBackendStatus(pg)).toMatchObject({ backend: "postgres", gateOpen: true });
    expect(warehouseBackendStatus({ ...pg, WAREHOUSE_EXPLORER_READ_ONLY_ACK: "false" })).toMatchObject({
      gateOpen: false,
      code: "PRODUCTION_GATE_CLOSED",
    });
    expect(
      warehouseBackendStatus({ ...pg, MACRO_DB_URL: "sqlite:./fred.db" })
    ).toMatchObject({ backend: "sqlite", gateOpen: false, code: "PRODUCTION_GATE_CLOSED" });
  });

  it("defaults and clamps the statement timeout", () => {
    expect(warehouseQueryTimeoutMs({})).toBe(5_000);
    expect(warehouseQueryTimeoutMs({ WAREHOUSE_EXPLORER_QUERY_TIMEOUT_MS: "100" })).toBe(1_000);
    expect(warehouseQueryTimeoutMs({ WAREHOUSE_EXPLORER_QUERY_TIMEOUT_MS: "8000" })).toBe(8_000);
    expect(warehouseQueryTimeoutMs({ WAREHOUSE_EXPLORER_QUERY_TIMEOUT_MS: "60000" })).toBe(15_000);
  });
});

