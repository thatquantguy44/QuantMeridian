import { describe, expect, it } from "vitest";
import { decodeWarehouseCursor, encodeWarehouseCursor, WarehouseCursorError } from "./cursor";

const context = {
  endpoint: "catalog",
  backend: "postgres" as const,
  filters: { q: "rates", module: "CURV" },
  sort: "objectName",
  direction: "asc" as const,
};

describe("Warehouse Explorer cursors", () => {
  it("round-trips a signed endpoint-bound cursor", () => {
    const env = { NODE_ENV: "production", WAREHOUSE_CURSOR_SECRET: "a-long-test-secret" };
    const token = encodeWarehouseCursor(context, ["gold.treasury_curve"], env);
    expect(token).toMatch(/^s\./);
    expect(decodeWarehouseCursor(token, context, env).last).toEqual(["gold.treasury_curve"]);
  });

  it("rejects tampering and a changed endpoint, backend, filter, or sort", () => {
    const env = { NODE_ENV: "production", WAREHOUSE_CURSOR_SECRET: "a-long-test-secret" };
    const token = encodeWarehouseCursor(context, ["gold.treasury_curve"], env);
    expect(() => decodeWarehouseCursor(`${token}x`, context, env)).toThrow(WarehouseCursorError);
    expect(() => decodeWarehouseCursor(token, { ...context, endpoint: "series" }, env)).toThrow();
    expect(() => decodeWarehouseCursor(token, { ...context, backend: "sqlite" }, env)).toThrow();
    expect(() => decodeWarehouseCursor(token, { ...context, filters: { q: "credit" } }, env)).toThrow();
    expect(() => decodeWarehouseCursor(token, { ...context, sort: "module" }, env)).toThrow();
  });

  it("allows unsigned local cursors but rejects them in production", () => {
    const token = encodeWarehouseCursor(context, ["last"], { NODE_ENV: "development" });
    expect(token).toMatch(/^u\./);
    expect(decodeWarehouseCursor(token, context, { NODE_ENV: "test" }).last).toEqual(["last"]);
    expect(() => decodeWarehouseCursor(token, context, { NODE_ENV: "production" })).toThrow();
  });

  it("requires a signing secret when production creates a cursor", () => {
    expect(() => encodeWarehouseCursor(context, ["last"], { NODE_ENV: "production" })).toThrow(
      /signing is not configured/
    );
  });

  it("rejects malformed and oversized cursors", () => {
    expect(() => decodeWarehouseCursor("not-a-cursor", context, { NODE_ENV: "test" })).toThrow();
    expect(() => decodeWarehouseCursor(`u.${"a".repeat(5_000)}`, context, { NODE_ENV: "test" })).toThrow();
  });
});

