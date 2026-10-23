import type { Citation } from "@/lib/marketVolatility";
import { BASIS_OPTIONS, type SeriesTuple, type VixForwardBasis } from "@/lib/vixImpliedForward";
import { goldEnabled, goldParam, goldStore, goldTable } from "@/lib/server/goldStore";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";

export interface VixForwardResponse {
  source: "DB" | "ERR";
  basis: VixForwardBasis;
  vix: SeriesTuple[];
  price: SeriesTuple[];
  inputs: {
    vixSeriesId: "VIXCLS";
    priceSeriesId: string;
    priceLabel: string;
    vixFirst: string | null;
    vixLast: string | null;
    priceFirst: string | null;
    priceLast: string | null;
  };
  citations: Citation[];
  warnings: string[];
  error?: string;
}

interface Row { date: unknown; value: unknown }

const PRICE_SOURCE: Record<VixForwardBasis, { table: string; key: string; keyColumn: string; valueColumn: string; seriesId: string }> = {
  spy_price: { table: "equity_total_return_index", keyColumn: "ticker", key: "SPY", valueColumn: "close", seriesId: "SPY:close" },
  spy_total: { table: "equity_total_return_index", keyColumn: "ticker", key: "SPY", valueColumn: "total_return_index", seriesId: "SPY:total_return_index" },
  sp500_index: { table: "fred_latest_observation", keyColumn: "series_id", key: "SP500", valueColumn: "value", seriesId: "SP500" },
};

const CITATIONS: Record<string, Citation> = {
  VIXCLS: { seriesId: "VIXCLS", title: "CBOE Volatility Index: VIX", source: "Chicago Board Options Exchange via FRED", url: "https://fred.stlouisfed.org/series/VIXCLS", note: "Daily close; 30-day expected S&P 500 volatility, annualized" },
  SP500: { seriesId: "SP500", title: "S&P 500", source: "S&P Dow Jones Indices via FRED", url: "https://fred.stlouisfed.org/series/SP500", note: "Daily close; FRED publishes the latest ten years only" },
  SPY: { seriesId: "SPY", title: "SPDR S&P 500 ETF Trust", source: "Gold equity_total_return_index", url: "https://www.ssga.com/us/en/intermediary/etfs/spdr-sp-500-etf-trust-spy", note: "Daily close and dividend-reinvested index; tracks the S&P 500 net of a 0.09% fee" },
};

export function parseBasis(value: string | null): VixForwardBasis {
  return BASIS_OPTIONS.some((option) => option.id === value) ? (value as VixForwardBasis) : "spy_price";
}

/** pg returns DATE columns as local-midnight Date objects and text columns as strings; normalize both. */
function isoDate(value: unknown): string | null {
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return null;
}

function toTuples(rows: Row[], dp: number): SeriesTuple[] {
  const out: SeriesTuple[] = [];
  for (const row of rows) {
    const date = isoDate(row.date);
    // Number(null) and Number("") are 0, which would read as a real close.
    const value = row.value === null || row.value === undefined || row.value === "" ? Number.NaN : Number(row.value);
    if (date && Number.isFinite(value)) out.push([date, Number(value.toFixed(dp))]);
  }
  return out;
}

async function readSeries(source: { table: string; keyColumn: string; key: string; valueColumn: string }): Promise<Row[]> {
  return goldStore().raw<Row>(
    `SELECT observation_date AS date, ${source.valueColumn} AS value
     FROM ${goldTable(source.table)}
     WHERE ${source.keyColumn} = ${goldParam(1)} AND ${source.valueColumn} IS NOT NULL
     ORDER BY observation_date ASC`,
    [source.key],
  );
}

function response(basis: VixForwardBasis, vix: SeriesTuple[], price: SeriesTuple[], warnings: string[], error?: string): VixForwardResponse {
  const priceSource = PRICE_SOURCE[basis];
  return {
    source: error ? "ERR" : "DB",
    basis,
    vix,
    price,
    inputs: {
      vixSeriesId: "VIXCLS",
      priceSeriesId: priceSource.seriesId,
      priceLabel: BASIS_OPTIONS.find((option) => option.id === basis)!.label,
      vixFirst: vix[0]?.[0] ?? null,
      vixLast: vix[vix.length - 1]?.[0] ?? null,
      priceFirst: price[0]?.[0] ?? null,
      priceLast: price[price.length - 1]?.[0] ?? null,
    },
    citations: [CITATIONS.VIXCLS, basis === "sp500_index" ? CITATIONS.SP500 : CITATIONS.SPY],
    warnings: error ? [...warnings, error] : warnings,
    ...(error ? { error } : {}),
  };
}

/**
 * GET /api/market-volatility/vix-forward?basis=spy_price|spy_total|sp500_index
 *
 * Gold-only VIX close history and the chosen S&P 500 series. The VIXR page aligns the series and computes every
 * statistic client-side so date-range, sampling and bucket changes are instant. No simulated fallback.
 */
export async function GET(req: Request) {
  const basis = parseBasis(new URL(req.url).searchParams.get("basis"));
  if (!goldEnabled()) return json(response(basis, [], [], [], "MACRO_DB_URL not configured."));
  try {
    const [vixRows, priceRows] = await Promise.all([
      readSeries({ table: "fred_latest_observation", keyColumn: "series_id", key: "VIXCLS", valueColumn: "value" }),
      readSeries(PRICE_SOURCE[basis]),
    ]);
    const vix = toTuples(vixRows, 2);
    const price = toTuples(priceRows, 4);
    if (!vix.length) return json(response(basis, vix, price, [], "No Gold observations found for VIXCLS."));
    if (!price.length) return json(response(basis, vix, price, [], `No Gold observations found for ${PRICE_SOURCE[basis].seriesId}.`));
    const warnings: string[] = [];
    if (basis === "sp500_index") warnings.push("FRED licenses only the latest ten years of the S&P 500 index; use SPY for history back to 1993.");
    return json(response(basis, vix, price, warnings));
  } catch (err) {
    console.warn("[market-volatility/vix-forward] Gold DB read failed:", (err as Error).message);
    return json(response(basis, [], [], [], (err as Error).message));
  }
}
