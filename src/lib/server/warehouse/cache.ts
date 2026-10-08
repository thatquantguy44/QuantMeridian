import { createHash } from "node:crypto";
import type { WarehouseBackend } from "./backend";

const DEFAULT_TTL_MS = 30_000;
const MAX_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 200;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stableValue(child)])
    );
  }
  return value;
}

export function normalizedHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("base64url");
}

/** Cache keys contain hashes, never raw searches, series IDs, or credentials. */
export function warehouseCacheKey(
  family: string,
  backend: Exclude<WarehouseBackend, "databricks">,
  normalizedInput: unknown
): string {
  return `${family}:${backend}:${normalizedHash(normalizedInput)}`;
}

export class WarehouseCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly pending = new Map<string, Promise<unknown>>();
  readonly ttlMs: number;
  readonly maxEntries: number;

  constructor(options: { ttlMs?: number; maxEntries?: number } = {}) {
    this.ttlMs = Math.min(MAX_TTL_MS, Math.max(1_000, options.ttlMs ?? DEFAULT_TTL_MS));
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  }

  get<T>(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh insertion order for a small LRU-style eviction policy.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, now = Date.now()): T {
    this.entries.delete(key);
    this.entries.set(key, { expiresAt: now + this.ttlMs, value });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return value;
  }

  async getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return { value: cached, hit: true };

    const inFlight = this.pending.get(key) as Promise<T> | undefined;
    if (inFlight) return { value: await inFlight, hit: true };

    const request = loader();
    this.pending.set(key, request);
    try {
      return { value: this.set(key, await request), hit: false };
    } finally {
      this.pending.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
    this.pending.clear();
  }
}

export const warehouseCache = new WarehouseCache();

