import { describe, test, expect } from "vitest";
import { isRealEconSource } from "./useEcon";

describe("mapSource contract", () => {
  const mapSource = (s: unknown): string => {
    if (typeof s !== "string") return "SIM";
    if (s === "DB") return "DB";
    if (s === "FRED" || s.includes("FRED") || s.includes("Finnhub")) return "FRED";
    if (s === "SNAPSHOT") return "SNAPSHOT";
    if (s === "ETL") return "ETL";
    return "SIM";
  };

  test("maps FRED correctly", () => {
    expect(mapSource("FRED")).toBe("FRED");
  });

  test("maps DB correctly", () => {
    expect(mapSource("DB")).toBe("DB");
  });

  test("maps SNAPSHOT correctly", () => {
    expect(mapSource("SNAPSHOT")).toBe("SNAPSHOT");
  });

  test("maps ETL correctly", () => {
    expect(mapSource("ETL")).toBe("ETL");
  });

  test("maps SIM correctly", () => {
    expect(mapSource("SIM")).toBe("SIM");
  });

  test("maps undefined to SIM", () => {
    expect(mapSource(undefined)).toBe("SIM");
  });

  test("maps null to SIM", () => {
    expect(mapSource(null)).toBe("SIM");
  });

  test("maps unknown string to SIM", () => {
    expect(mapSource("UNKNOWN")).toBe("SIM");
    expect(mapSource("")).toBe("SIM");
    expect(mapSource("garbage")).toBe("SIM");
  });

  test("maps FRED-containing strings to FRED", () => {
    expect(mapSource("FRED_LIVE")).toBe("FRED");
    expect(mapSource("live_FRED")).toBe("FRED");
  });

  test("maps Finnhub to FRED tier", () => {
    expect(mapSource("Finnhub")).toBe("FRED");
  });
});

describe("isRealEconSource", () => {
  test("FRED is a real source", () => {
    expect(isRealEconSource("FRED")).toBe(true);
  });

  test("DB is a real source", () => {
    expect(isRealEconSource("DB")).toBe(true);
  });

  test("SNAPSHOT is a real source", () => {
    expect(isRealEconSource("SNAPSHOT")).toBe(true);
  });

  test("SIM is not a real source", () => {
    expect(isRealEconSource("SIM")).toBe(false);
  });

  test("ETL is not classified as real econ source", () => {
    expect(isRealEconSource("ETL")).toBe(false);
  });

  test("undefined is not a real source", () => {
    expect(isRealEconSource(undefined)).toBe(false);
  });
});
