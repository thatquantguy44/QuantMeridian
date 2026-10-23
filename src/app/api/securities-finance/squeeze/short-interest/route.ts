// Tier B exception: Yahoo short interest is non-series microstructure data.
import { json } from "@/lib/server/http";
import { LENDABLE } from "@/data/universe";
import { getYahooShortInterest } from "@/lib/server/yahooShortInterest";

export const runtime = "nodejs";

/** GET /api/securities-finance/squeeze/short-interest */
export async function GET() {
  const tickers = LENDABLE.filter((security) => security.assetClass === "EQUITY")
    .map((security) => security.ticker);
  return json(await getYahooShortInterest(tickers));
}
