import { beforeEach, describe, expect, test, vi } from "vitest";
import { GET, type VixForwardResponse } from "./route";

const mocks = vi.hoisted(() => ({ goldEnabled: vi.fn(), raw: vi.fn() }));

vi.mock("@/lib/server/goldStore", () => ({
  goldEnabled: mocks.goldEnabled,
  goldParam: (index: number) => `$${index}`,
  goldStore: () => ({ raw: mocks.raw }),
  goldTable: (table: string) => `gold.${table}`,
}));

async function call(query = ""): Promise<VixForwardResponse> {
  const res = await GET(new Request(`http://local.test/api/market-volatility/vix-forward${query}`));
  return res.json();
}

describe("/api/market-volatility/vix-forward", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.goldEnabled.mockReturnValue(true);
    mocks.raw.mockImplementation(async (sql: string, params: unknown[]) => {
      if (params[0] === "VIXCLS") return [{ date: "2024-01-02", value: 13.2 }, { date: new Date(2024, 0, 3), value: "14.04" }, { date: "2024-01-04", value: null }];
      if (params[0] === "SPY") return sql.includes("total_return_index AS value") ? [{ date: "2024-01-02", value: 1000.123456 }] : [{ date: "2024-01-02", value: 472.65 }];
      if (params[0] === "SP500") return [{ date: "2024-01-02", value: 4742.83 }];
      return [];
    });
  });

  test("defaults to SPY price and normalizes dates and numbers", async () => {
    const body = await call();
    expect(body.source).toBe("DB");
    expect(body.basis).toBe("spy_price");
    expect(body.vix).toEqual([["2024-01-02", 13.2], ["2024-01-03", 14.04]]);
    expect(body.price).toEqual([["2024-01-02", 472.65]]);
    expect(body.inputs).toMatchObject({ vixSeriesId: "VIXCLS", priceSeriesId: "SPY:close", vixFirst: "2024-01-02", vixLast: "2024-01-03" });
    expect(body.citations.map((c) => c.seriesId)).toEqual(["VIXCLS", "SPY"]);
    const [sql, params] = mocks.raw.mock.calls.find((c) => c[1][0] === "SPY")!;
    expect(sql).toContain("gold.equity_total_return_index");
    expect(sql).toContain("close AS value");
    expect(params).toEqual(["SPY"]);
  });

  test("reads the total-return index and the FRED S&P 500 when asked", async () => {
    const total = await call("?basis=spy_total");
    expect(total.inputs.priceSeriesId).toBe("SPY:total_return_index");
    expect(total.price).toEqual([["2024-01-02", 1000.1235]]);
    const index = await call("?basis=sp500_index");
    expect(index.inputs.priceSeriesId).toBe("SP500");
    expect(index.citations.map((c) => c.seriesId)).toEqual(["VIXCLS", "SP500"]);
    expect(index.warnings.join(" ")).toMatch(/ten years/);
  });

  test("falls back to SPY price for an unknown basis", async () => {
    expect((await call("?basis=drop%20table")).basis).toBe("spy_price");
  });

  test("fails closed without a Gold database and never simulates", async () => {
    mocks.goldEnabled.mockReturnValue(false);
    const body = await call();
    expect(body.source).toBe("ERR");
    expect(body.vix).toEqual([]);
    expect(body.error).toMatch(/MACRO_DB_URL/);
    expect(mocks.raw).not.toHaveBeenCalled();
  });

  test("reports a missing series and a database failure as errors", async () => {
    mocks.raw.mockImplementation(async (_sql: string, params: unknown[]) => (params[0] === "VIXCLS" ? [] : [{ date: "2024-01-02", value: 1 }]));
    expect((await call()).error).toMatch(/VIXCLS/);
    mocks.raw.mockRejectedValue(new Error("connection refused"));
    const body = await call();
    expect(body.source).toBe("ERR");
    expect(body.error).toBe("connection refused");
  });
});
