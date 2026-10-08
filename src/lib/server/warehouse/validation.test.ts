import { describe, expect, it } from "vitest";
import {
  WarehouseValidationError,
  escapeLike,
  parseBoolean,
  parseDateRange,
  parseEnum,
  parseIsoDate,
  parseLimit,
  parseSearch,
  parseSeriesKey,
  parseSource,
} from "./validation";

function expectInvalid(run: () => unknown, field: string): void {
  try {
    run();
    throw new Error("Expected validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(WarehouseValidationError);
    expect((error as WarehouseValidationError).field).toBe(field);
    expect((error as Error).message).not.toContain("secret-value");
  }
}

describe("Warehouse Explorer request validation", () => {
  it("requires a complete source-aware series key", () => {
    expect(parseSeriesKey(new URLSearchParams("source=FRED&seriesId=DGS10"))).toEqual({
      source: "fred",
      seriesId: "DGS10",
    });
    expectInvalid(() => parseSeriesKey(new URLSearchParams("seriesId=DGS10")), "source");
    expectInvalid(() => parseSeriesKey(new URLSearchParams("source=fred")), "seriesId");
  });

  it("restricts sources to the documented safe identifier alphabet", () => {
    expect(parseSource("  Stooq.Daily-1 ")).toBe("stooq.daily-1");
    expectInvalid(() => parseSource("fred;drop table"), "source");
    expectInvalid(() => parseSource("secret-value\nnext"), "source");
    expectInvalid(() => parseSource("a".repeat(41)), "source");
  });

  it("rejects control characters and lone surrogates in searches", () => {
    expectInvalid(() => parseSearch("secret-value\u0000"), "q");
    expectInvalid(() => parseSearch("secret-value\ud800"), "q");
    expect(parseSearch("inflation expectations")).toBe("inflation expectations");
  });

  it("validates real calendar dates without locale parsing", () => {
    expect(parseIsoDate("2024-02-29", "asOf", true)).toBe("2024-02-29");
    for (const value of ["2023-02-29", "2024-13-01", "01/02/2024", "2024-1-2", "2024-01-01Z"]) {
      expectInvalid(() => parseIsoDate(value, "asOf", true), "asOf");
    }
  });

  it("enforces ordered optional date bounds", () => {
    expect(parseDateRange(new URLSearchParams("from=2020-01-01&to=2024-01-01"))).toEqual({
      from: "2020-01-01",
      to: "2024-01-01",
    });
    expectInvalid(
      () => parseDateRange(new URLSearchParams("from=2024-01-02&to=2024-01-01")),
      "from"
    );
  });

  it("rejects rather than clamps out-of-range limits", () => {
    expect(parseLimit(null, { defaultValue: 50, maximum: 200 })).toBe(50);
    expect(parseLimit("200", { defaultValue: 50, maximum: 200 })).toBe(200);
    for (const value of ["0", "201", "1.5", "-1", "Infinity", "1e2"]) {
      expectInvalid(() => parseLimit(value, { defaultValue: 50, maximum: 200 }), "limit");
    }
  });

  it("parses only explicit booleans and allowlisted enums", () => {
    expect(parseBoolean("true", "stale")).toBe(true);
    expect(parseBoolean("false", "stale")).toBe(false);
    expectInvalid(() => parseBoolean("1", "stale"), "stale");
    expect(parseEnum("source", "sort", ["source", "seriesId"] as const)).toBe("source");
    expectInvalid(() => parseEnum("observation_count desc", "sort", ["source"] as const), "sort");
  });

  it("escapes every LIKE metacharacter while preserving ordinary text", () => {
    expect(escapeLike("core_100%!growth")).toBe("core!_100!%!!growth");
    expect(escapeLike("DGS10")).toBe("DGS10");
  });
});

