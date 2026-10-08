/**
 * Tiny shared client-side fetch cache with request dedupe + stale-while-revalidate.
 *
 * The terminal's data hooks each fired their own `fetch` on mount, so a feed used
 * by many modules (e.g. the econ indicators set, used by ~10 pages) was re-pulled
 * on every navigation and identical concurrent requests weren't shared. This module
 * gives one process-wide cache keyed by URL:
 *
 *   • `peekFresh(url, maxAgeMs)` — synchronous cached value if recent enough, so a
 *     hook can render real data immediately instead of flashing its SIM fallback.
 *   • `fetchJson(url, …)`       — dedupes in-flight requests and stores the result.
 *
 * Zero dependencies; intentionally not persisted (lives for the tab session).
 */

interface Entry {
  ts: number; // when `data` resolved
  data: unknown;
  inflight?: Promise<unknown>;
  inflightAt?: number;
}

const cache = new Map<string, Entry>();

/** Default windows. Data is daily-ish, so a minute of freshness is generous. */
const DEFAULT_MAX_AGE_MS = 60_000;
const DEFAULT_DEDUPE_MS = 30_000;

/** Synchronous cached value if it resolved within `maxAgeMs`, else undefined. */
export function peekFresh<T>(url: string, maxAgeMs = DEFAULT_MAX_AGE_MS): T | undefined {
  const e = cache.get(url);
  if (e && e.ts && Date.now() - e.ts < maxAgeMs) return e.data as T;
  return undefined;
}

/**
 * Fetch JSON for a URL, sharing in-flight and recently-resolved requests.
 * If a request is already in flight (within `dedupeMs`) or fresh data exists
 * (within `maxAgeMs`), the existing promise/value is reused instead of refetching.
 */
export function fetchJson<T>(
  url: string,
  opts: { maxAgeMs?: number; dedupeMs?: number; signal?: AbortSignal } = {}
): Promise<T> {
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const dedupeMs = opts.dedupeMs ?? DEFAULT_DEDUPE_MS;
  const now = Date.now();
  const e = cache.get(url);

  if (e) {
    if (e.ts && now - e.ts < maxAgeMs) return Promise.resolve(e.data as T);
    if (e.inflight && e.inflightAt && now - e.inflightAt < dedupeMs) return e.inflight as Promise<T>;
  }

  const inflight = fetch(url, opts.signal ? { signal: opts.signal } : undefined)
    .then((r) => r.json())
    .then((data) => {
      cache.set(url, { ts: Date.now(), data });
      return data as T;
    })
    .catch((err) => {
      // Drop the failed in-flight marker so the next call retries.
      const cur = cache.get(url);
      if (cur && cur.inflight === inflight) {
        if (cur.ts) cur.inflight = undefined;
        else cache.delete(url);
      }
      throw err;
    });

  cache.set(url, { ...(e ?? { ts: 0, data: undefined }), inflight, inflightAt: now });
  return inflight as Promise<T>;
}

/** Clear the cache (testing / manual refresh). */
export function clearFetchCache(url?: string): void {
  if (url) cache.delete(url);
  else cache.clear();
}
