import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/warehouse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/warehouse")>();
  return { ...actual, warehouseAudit: vi.fn() };
});

import {
  warehouseAudit,
  type DataQualityResult,
  type WarehouseAuditAdapter,
} from "@/lib/server/warehouse";
import { GET } from "./route";

const mockedWarehouseAudit = vi.mocked(warehouseAudit);
const originalMacroDbUrl = process.env.MACRO_DB_URL;
const originalNodeEnv = process.env.NODE_ENV;

function result(seriesId: string): DataQualityResult {
  return {
    runId: "run-1",
    seriesId,
    checkName: "freshness",
    passed: false,
    severity: "warning",
    message: "stale",
    metricValue: 30,
  };
}

function adapter(listDqResults: WarehouseAuditAdapter["listDqResults"]): WarehouseAuditAdapter {
  return {
    listRuns: vi.fn(async () => []),
    listSeriesRuns: vi.fn(async () => []),
    listDqResults,
  };
}

describe("GET /api/warehouse/dq", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    process.env.MACRO_DB_URL = "postgresql://user:secret@localhost:55432/macro_medallion";
  });

  afterEach(() => {
    if (originalMacroDbUrl === undefined) delete process.env.MACRO_DB_URL;
    else process.env.MACRO_DB_URL = originalMacroDbUrl;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it("returns bounded live-schema DQ rows and a deterministic cursor", async () => {
    const listDqResults = vi.fn(async () => [result("A"), result("B"), result("C")]);
    mockedWarehouseAudit.mockReturnValue(adapter(listDqResults));
    const response = await GET(
      new Request("http://localhost/api/warehouse/dq?severity=warning&passed=false&limit=2")
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      source: "DB",
      data: { selectedRunId: "run-1" },
      page: { limit: 2, returned: 2 },
    });
    expect(body.data.results.map((item: DataQualityResult) => item.seriesId)).toEqual(["A", "B"]);
    expect(body.page.nextCursor).toMatch(/^u\./);
    expect(listDqResults).toHaveBeenCalledWith({
      runId: undefined,
      seriesId: undefined,
      severity: "warning",
      passed: false,
      checkName: undefined,
      after: undefined,
      limit: 3,
    });
  });

  it("rejects non-allowlisted severities before database access", async () => {
    const listDqResults = vi.fn(async () => []);
    mockedWarehouseAudit.mockReturnValue(adapter(listDqResults));
    const response = await GET(
      new Request("http://localhost/api/warehouse/dq?severity=warning%20DESC")
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(listDqResults).not.toHaveBeenCalled();
  });
});

