import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/warehouse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/warehouse")>();
  return { ...actual, warehouseAudit: vi.fn() };
});

import { warehouseAudit, type EtlRun, type WarehouseAuditAdapter } from "@/lib/server/warehouse";
import { GET } from "./route";

const mockedWarehouseAudit = vi.mocked(warehouseAudit);

const ENV_KEYS = [
  "MACRO_DB_URL",
  "MACRO_DB_BACKEND",
  "NODE_ENV",
  "VERCEL_ENV",
  "WAREHOUSE_CURSOR_SECRET",
  "WAREHOUSE_EXPLORER_PRODUCTION_ENABLED",
  "WAREHOUSE_EXPLORER_READ_ONLY_ACK",
  "WAREHOUSE_EXPLORER_NETWORK_RESTRICTED_ACK",
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function run(runId: string, startedAt: string): EtlRun {
  return {
    runId,
    environment: "dev",
    triggeredBy: "schedule",
    status: "succeeded",
    startedAt,
    endedAt: startedAt,
    durationSeconds: 1,
    seriesTotal: 10,
    seriesSucceeded: 10,
    seriesFailed: 0,
    seriesSkippedNotDue: 0,
    errorMessage: null,
  };
}

function adapter(overrides: Partial<WarehouseAuditAdapter> = {}): WarehouseAuditAdapter {
  return {
    listRuns: vi.fn(async () => []),
    listSeriesRuns: vi.fn(async () => []),
    listDqResults: vi.fn(async () => []),
    ...overrides,
  };
}

describe("GET /api/warehouse/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    process.env.MACRO_DB_URL = "postgresql://user:secret@localhost:55432/macro_medallion";
    delete process.env.MACRO_DB_BACKEND;
    delete process.env.VERCEL_ENV;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("returns a DB-only page and an endpoint-bound cursor", async () => {
    const listRuns = vi.fn(async () => [
      run("run-3", "2026-10-03T00:00:00Z"),
      run("run-2", "2026-10-02T00:00:00Z"),
      run("run-1", "2026-10-01T00:00:00Z"),
    ]);
    mockedWarehouseAudit.mockReturnValue(adapter({ listRuns }));

    const response = await GET(new Request("http://localhost/api/warehouse/runs?limit=2"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      source: "DB",
      backend: "postgres",
      page: { limit: 2, returned: 2 },
      data: { seriesRuns: [] },
    });
    expect(body.data.runs.map((item: EtlRun) => item.runId)).toEqual(["run-3", "run-2"]);
    expect(body.page.nextCursor).toMatch(/^u\./);
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(listRuns).toHaveBeenCalledWith({ runId: undefined, status: undefined, before: undefined, limit: 3 });
  });

  it("decodes the next-page cursor into a fixed keyset predicate", async () => {
    const firstRuns = vi.fn(async () => [
      run("run-3", "2026-10-03T00:00:00Z"),
      run("run-2", "2026-10-02T00:00:00Z"),
    ]);
    mockedWarehouseAudit.mockReturnValue(adapter({ listRuns: firstRuns }));
    const first = await GET(new Request("http://localhost/api/warehouse/runs?limit=1"));
    const cursor = (await first.json()).page.nextCursor;

    const nextRuns = vi.fn(async () => []);
    mockedWarehouseAudit.mockReturnValue(adapter({ listRuns: nextRuns }));
    await GET(new Request(`http://localhost/api/warehouse/runs?limit=1&cursor=${encodeURIComponent(cursor)}`));
    expect(nextRuns).toHaveBeenCalledWith({
      runId: undefined,
      status: undefined,
      before: { startedAt: "2026-10-03T00:00:00Z", runId: "run-3" },
      limit: 2,
    });
  });

  it("rejects invalid bounds and incomplete series drill-downs before database access", async () => {
    const audit = adapter();
    mockedWarehouseAudit.mockReturnValue(audit);
    const excessive = await GET(new Request("http://localhost/api/warehouse/runs?limit=201"));
    expect(excessive.status).toBe(400);
    expect(await excessive.json()).toMatchObject({ ok: false, code: "INVALID_REQUEST" });

    const missingRun = await GET(
      new Request("http://localhost/api/warehouse/runs?includeSeries=true")
    );
    expect(missingRun.status).toBe(400);
    expect(audit.listRuns).not.toHaveBeenCalled();
  });

  it("normalizes database failures without returning connection details", async () => {
    mockedWarehouseAudit.mockReturnValue(
      adapter({ listRuns: vi.fn(async () => { throw new Error("postgresql://fred:secret@localhost/db"); }) })
    );
    const response = await GET(new Request("http://localhost/api/warehouse/runs"));
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(text).toContain("DATABASE_UNAVAILABLE");
    expect(text).not.toContain("fred");
    expect(text).not.toContain("secret");
  });
});

