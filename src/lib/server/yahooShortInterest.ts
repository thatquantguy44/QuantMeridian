/**
 * Best-effort Yahoo Finance short-interest reader for SQZ.
 * This is an unofficial research feed. Failed, missing, or old observations
 * are omitted; the caller keeps those rows explicitly simulated.
 */
export interface YahooShortInterestRow {
  ticker: string;
  shortInterestPct: number;
  daysToCover: number;
  asOf: string;
}

const USER_AGENT = "Mozilla/5.0 (compatible; QuantMeridian/1.0)";
const MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;
const CACHE_MS = 6 * 60 * 60 * 1000;
const ERROR_CACHE_MS = 2 * 60 * 1000;

function rawNumber(value: unknown): number | null {
  const raw = value && typeof value === "object" && "raw" in value
    ? (value as { raw: unknown }).raw : value;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

export function parseYahooShortInterest(
  ticker: string,
  payload: unknown,
  now = Date.now(),
): YahooShortInterestRow | null {
  if (!payload || typeof payload !== "object") return null;
  const summary = (payload as { quoteSummary?: { result?: Array<{ defaultKeyStatistics?: Record<string, unknown> }> } }).quoteSummary;
  const stats = summary?.result?.[0]?.defaultKeyStatistics;
  if (!stats) return null;
  // Yahoo's shortPercentOfFloat is a fraction; shortRatio is days to cover.
  const fraction = rawNumber(stats.shortPercentOfFloat);
  const ratio = rawNumber(stats.shortRatio);
  const reported = rawNumber(stats.dateShortInterest);
  if (fraction === null || ratio === null || reported === null) return null;
  if (fraction < 0 || fraction > 10 || ratio < 0 || ratio > 365) return null;
  const time = reported * 1000;
  if (time > now + 24 * 60 * 60 * 1000 || now - time > MAX_AGE_MS) return null;
  return {
    ticker,
    shortInterestPct: Number((fraction * 100).toFixed(1)),
    daysToCover: Number(ratio.toFixed(1)),
    asOf: new Date(time).toISOString().slice(0, 10),
  };
}

interface YahooSession { cookie: string; crumb: string }
interface BoardResult {
  source: "YAHOO" | "ERR";
  rows: YahooShortInterestRow[];
  requested: number;
  failed: number;
  fetchedAt: string;
}

async function yahooSession(fetcher: typeof fetch): Promise<YahooSession> {
  const cookieResponse = await fetcher("https://fc.yahoo.com", {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(5000),
  });
  const cookie = cookieResponse.headers.get("set-cookie")?.split(";")[0];
  if (!cookie || !/^A[13]=/.test(cookie)) throw new Error("Yahoo cookie unavailable");
  const crumbResponse = await fetcher("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { cookie, "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(5000),
  });
  if (!crumbResponse.ok) throw new Error("Yahoo crumb unavailable");
  const crumb = (await crumbResponse.text()).trim();
  if (!crumb || crumb.length > 100 || /<|>|Too Many Requests/i.test(crumb)) {
    throw new Error("Yahoo crumb invalid");
  }
  return { cookie, crumb };
}

async function fetchTicker(
  ticker: string,
  session: YahooSession,
  fetcher: typeof fetch,
): Promise<YahooShortInterestRow | null> {
  const url = new URL("https://query1.finance.yahoo.com/v10/finance/quoteSummary/" + encodeURIComponent(ticker));
  url.searchParams.set("modules", "defaultKeyStatistics");
  url.searchParams.set("formatted", "false");
  url.searchParams.set("crumb", session.crumb);
  const response = await fetcher(url, {
    headers: { cookie: session.cookie, "user-agent": USER_AGENT, accept: "application/json" },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) return null;
  return parseYahooShortInterest(ticker, await response.json());
}

let cached: BoardResult | null = null;
let cacheUntil = 0;
let inFlight: Promise<BoardResult> | null = null;

export async function getYahooShortInterest(
  tickers: string[],
  fetcher: typeof fetch = fetch,
): Promise<BoardResult> {
  const symbols = [...new Set(tickers.filter((t) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(t)))].slice(0, 60);
  // Cache applies only to the fixed SQZ universe used by the route.
  if (fetcher === fetch && cached && Date.now() < cacheUntil) return cached;
  if (fetcher === fetch && inFlight) return inFlight;
  const run = async (): Promise<BoardResult> => {
    const rows: YahooShortInterestRow[] = [];
    try {
      const session = await yahooSession(fetcher);
      // Limit parallel Yahoo calls; rate limits are common on this endpoint.
      for (let i = 0; i < symbols.length; i += 5) {
        const batch = await Promise.allSettled(
          symbols.slice(i, i + 5).map((ticker) => fetchTicker(ticker, session, fetcher))
        );
        for (const item of batch) {
          if (item.status === "fulfilled" && item.value) rows.push(item.value);
        }
      }
    } catch {
      // No hidden synthetic replacement. The route reports ERR below.
    }
    const result: BoardResult = {
      source: rows.length ? "YAHOO" : "ERR",
      rows,
      requested: symbols.length,
      failed: symbols.length - rows.length,
      fetchedAt: new Date().toISOString(),
    };
    if (fetcher === fetch) {
      cached = result;
      cacheUntil = Date.now() + (rows.length ? CACHE_MS : ERROR_CACHE_MS);
    }
    return result;
  };
  if (fetcher !== fetch) return run();
  inFlight = run().finally(() => { inFlight = null; });
  return inFlight;
}
