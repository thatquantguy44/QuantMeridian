import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Characterization tests (spec009 T-011): they pin the current /api/chart/series responses so the
// extraction of resolveChartSeries into src/lib/server/chartSeries.ts cannot change them.
const mocks = vi.hoisted(() => ({ history: vi.fn(), enabled: vi.fn() }));
vi.mock("@/lib/server/goldStore", () => ({ goldEnabled: mocks.enabled, goldStore: () => ({ history: mocks.history }) }));
import { GET } from "./route";

const call = async (query: string) => { const response = await GET(new Request(`http://localhost/api/chart/series?${query}`)); return { status: response.status, body: await response.json() }; };

beforeEach(() => { mocks.history.mockReset(); mocks.enabled.mockReset(); mocks.enabled.mockReturnValue(true); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe("GET /api/chart/series (econ/fred)", () => {
  it("requires an id", async () => {
    expect(await call("source=econ")).toEqual({ status: 400, body: { error: "id required" } });
  });

  it("reads a level series from fred_latest_observation, newest-limit by frequency", async () => {
    mocks.history.mockResolvedValue([{ series_id: "DGS10", date: "2026-10-01", value: 4.1 }, { series_id: "DGS10", observation_date: "2026-10-02", value: 4.2 }]);
    const out = await call("source=econ&id=DGS10");
    expect(mocks.history).toHaveBeenCalledWith("fred_latest_observation", { series_id: "DGS10" }, 1800);
    expect(out).toEqual({ status: 200, body: { source: "DB", id: "DGS10", label: "10-Year Treasury", units: "lin", observations: [{ date: "2026-10-01", value: 4.1 }, { date: "2026-10-02", value: 4.2 }] } });
  });

  it("uses the transform table when the requested units are not lin", async () => {
    mocks.history.mockResolvedValue([{ series_id: "DGS10", date: "2026-10-01", value: 1 }]);
    const out = await call("source=econ&id=DGS10&units=pch");
    expect(mocks.history).toHaveBeenCalledWith("fred_feature_transforms", { series_id: "DGS10" }, 1800);
    expect(out.body).toMatchObject({ source: "DB", units: "pch" });
  });

  it("derives default units from the catalog for y/y series", async () => {
    mocks.history.mockResolvedValue([{ series_id: "CPIAUCSL", date: "2026-09-01", value: 3 }]);
    const out = await call("source=econ&id=CPIAUCSL");
    expect(mocks.history.mock.calls[0][0]).toBe("fred_feature_transforms");
    expect(out.body.units).toBe("pc1");
  });

  it("returns ERR with the Gold message when no rows exist", async () => {
    mocks.history.mockResolvedValue([]);
    expect(await call("id=DGS10")).toEqual({ status: 200, body: { source: "ERR", id: "DGS10", label: "10-Year Treasury", observations: [], error: "No Gold DB econ chart rows found." } });
  });

  it("returns ERR with the error message when the read throws", async () => {
    mocks.history.mockRejectedValue(new Error("boom"));
    expect(await call("id=DGS10")).toEqual({ status: 200, body: { source: "ERR", id: "DGS10", label: "10-Year Treasury", observations: [], error: "boom" } });
  });

  it("returns ERR when Gold is not configured, and falls back to the id as label for unknown series", async () => {
    mocks.enabled.mockReturnValue(false);
    expect(await call("id=NOT_A_SERIES")).toEqual({ status: 200, body: { source: "ERR", id: "NOT_A_SERIES", label: "NOT_A_SERIES", observations: [], error: "MACRO_DB_URL not configured." } });
    expect(mocks.history).not.toHaveBeenCalled();
  });
});

describe("GET /api/chart/series (market/lens/book)", () => {
  const rows = [{ ticker: "SPY", date: "2026-10-01", close: "500.5", total_return_index: 1000, price_return_index: 900 }, { ticker: "SPY", observation_date: "2026-10-02", close: null, total_return_index: null, price_return_index: 901 }, { ticker: "SPY", date: "2026-10-03", close: "bad" }];

  it("uses close by default and drops rows without a finite value", async () => {
    mocks.history.mockResolvedValue(rows);
    const out = await call("source=market&id=SPY");
    expect(mocks.history).toHaveBeenCalledWith("equity_total_return_index", { ticker: "SPY" });
    expect(out).toEqual({ status: 200, body: { source: "DB", id: "SPY", label: "SPY", observations: [{ date: "2026-10-01", value: 500.5 }, { date: "2026-10-02", value: 901 }] } });
  });

  it("honors return_index and price_return_index units", async () => {
    mocks.history.mockResolvedValue(rows);
    expect((await call("source=lens&id=SPY&units=return_index")).body.observations).toEqual([{ date: "2026-10-01", value: 1000 }, { date: "2026-10-02", value: 901 }]);
    expect((await call("source=book&id=SPY&units=price_return_index")).body.observations).toEqual([{ date: "2026-10-01", value: 900 }, { date: "2026-10-02", value: 901 }]);
  });

  it("falls back to fred_feature_transforms for rate or macro ids in the lens", async () => {
    mocks.history.mockResolvedValueOnce([]).mockResolvedValueOnce([{ series_id: "DGS2", date: "2026-10-01", value: 3.9 }, { series_id: "DGS2", observation_date: "2026-10-02", value: 4 }]);
    const out = await call("source=market&id=DGS2");
    expect(mocks.history.mock.calls.map((c) => c[0])).toEqual(["equity_total_return_index", "fred_feature_transforms"]);
    expect(out).toEqual({ status: 200, body: { source: "DB", id: "DGS2", label: "DGS2", observations: [{ date: "2026-10-01", value: 3.9 }, { date: "2026-10-02", value: 4 }] } });
  });

  it("returns ERR for empty results, thrown reads, and an unconfigured Gold", async () => {
    mocks.history.mockResolvedValue([]);
    expect((await call("source=market&id=ZZZ")).body).toEqual({ source: "ERR", id: "ZZZ", label: "ZZZ", observations: [], error: "No Gold DB market chart rows found." });
    mocks.history.mockRejectedValue(new Error("down"));
    expect((await call("source=market&id=ZZZ")).body).toEqual({ source: "ERR", id: "ZZZ", label: "ZZZ", observations: [], error: "down" });
    mocks.enabled.mockReturnValue(false);
    expect((await call("source=market&id=ZZZ")).body.error).toBe("MACRO_DB_URL not configured.");
  });

  it("treats the source case-insensitively and defaults to econ", async () => {
    mocks.history.mockResolvedValue([{ series_id: "DGS10", date: "2026-10-01", value: 4 }]);
    expect((await call("source=MARKET&id=SPY")).body.label).toBe("SPY");
    expect(mocks.history.mock.calls[0][0]).toBe("equity_total_return_index");
    mocks.history.mockReset(); mocks.history.mockResolvedValue([{ series_id: "DGS10", date: "2026-10-01", value: 4 }]);
    expect((await call("id=DGS10")).body.units).toBe("lin");
  });
});
