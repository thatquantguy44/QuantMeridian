import { describe, expect, it, vi } from "vitest";
import { WarehouseCache, normalizedHash, warehouseCacheKey } from "./cache";

describe("Warehouse Explorer bounded cache", () => {
  it("hashes normalized filters without putting values in cache keys", () => {
    expect(normalizedHash({ b: 2, a: 1 })).toBe(normalizedHash({ a: 1, b: 2 }));
    const key = warehouseCacheKey("series", "postgres", { q: "private-search", source: "fred" });
    expect(key).toMatch(/^series:postgres:/);
    expect(key).not.toContain("private-search");
    expect(key).not.toContain("fred");
  });

  it("expires entries and caps TTL at sixty seconds", () => {
    const cache = new WarehouseCache({ ttlMs: 120_000 });
    expect(cache.ttlMs).toBe(60_000);
    cache.set("a", 1, 1_000);
    expect(cache.get("a", 60_999)).toBe(1);
    expect(cache.get("a", 61_000)).toBeUndefined();
  });

  it("evicts the least-recently-used entry at the configured bound", () => {
    const cache = new WarehouseCache({ maxEntries: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("deduplicates concurrent loads", async () => {
    const cache = new WarehouseCache();
    const loader = vi.fn(async () => 42);
    const [first, second] = await Promise.all([
      cache.getOrLoad("same", loader),
      cache.getOrLoad("same", loader),
    ]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(first.value).toBe(42);
    expect(second).toEqual({ value: 42, hit: true });
  });
});

