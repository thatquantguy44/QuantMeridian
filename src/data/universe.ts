import { Rng } from "@/lib/rng";

/** Shared reference data — securities, counterparties, desks, traders. */

export type AssetClass = "EQUITY" | "ETF" | "CORP" | "GOVT" | "FUTURE" | "FX" | "COMMODITY" | "CRYPTO";

export interface Security {
  ticker: string;
  name: string;
  assetClass: AssetClass;
  sector: string;
  cusip: string;
  px: number; // reference price
  vol: number; // daily vol (fraction)
  borrowFee: number; // bps annualized
  hardToBorrow: boolean;
  marketCap: number; // USD
}

export interface Counterparty {
  id: string;
  name: string;
  short: string;
  type: "HEDGE_FUND" | "BANK" | "BENEFICIAL_OWNER" | "BROKER" | "PENSION" | "SOVEREIGN";
  rating: "AAA" | "AA" | "A" | "BBB" | "BB";
  region: "AMER" | "EMEA" | "APAC";
}

export interface Trader {
  id: string;
  name: string;
  desk: string;
}

const SECTORS = ["Technology", "Financials", "Energy", "Healthcare", "Industrials", "Consumer", "Materials", "Utilities", "Comms", "Real Estate"];

const EQUITY_SEED: [string, string, string, number][] = [
  ["AAPL", "Apple Inc", "Technology", 228.5],
  ["MSFT", "Microsoft Corp", "Technology", 441.2],
  ["NVDA", "NVIDIA Corp", "Technology", 132.8],
  ["TSLA", "Tesla Inc", "Consumer", 248.9],
  ["AMZN", "Amazon.com Inc", "Consumer", 201.4],
  ["META", "Meta Platforms", "Comms", 585.3],
  ["GOOGL", "Alphabet Inc", "Comms", 178.6],
  ["JPM", "JPMorgan Chase", "Financials", 242.1],
  ["GS", "Goldman Sachs", "Financials", 561.7],
  ["BAC", "Bank of America", "Financials", 46.2],
  ["XOM", "Exxon Mobil", "Energy", 117.8],
  ["CVX", "Chevron Corp", "Energy", 161.3],
  ["JNJ", "Johnson & Johnson", "Healthcare", 154.9],
  ["UNH", "UnitedHealth Grp", "Healthcare", 512.4],
  ["GME", "GameStop Corp", "Consumer", 28.6],
  ["AMC", "AMC Entertainment", "Comms", 4.8],
  ["BBBY", "Bed Bath Beyond", "Consumer", 0.9],
  ["RIVN", "Rivian Auto", "Consumer", 13.7],
  ["LCID", "Lucid Group", "Consumer", 2.9],
  ["COIN", "Coinbase Global", "Financials", 289.4],
  ["PLTR", "Palantir Tech", "Technology", 64.2],
  ["SMCI", "Super Micro", "Technology", 41.5],
  ["MSTR", "MicroStrategy", "Technology", 348.9],
  ["HOOD", "Robinhood Mkts", "Financials", 38.1],
  ["CVNA", "Carvana Co", "Consumer", 218.6],
  ["UPST", "Upstart Holdings", "Financials", 62.3],
  ["AFRM", "Affirm Holdings", "Financials", 58.7],
  ["DJT", "Trump Media", "Comms", 32.4],
];

const ETF_SEED: [string, string, number][] = [
  ["SPY", "SPDR S&P 500", 738.0],
  ["QQQ", "Invesco QQQ", 718.0],
  ["IWM", "iShares Russell 2000", 298.0],
  ["HYG", "iShares HY Corp", 79.3],
  ["TLT", "iShares 20+Y Tsy", 91.7],
  ["GLD", "SPDR Gold", 305.0],
  ["XLF", "Financials Sel", 55.2],
  ["ARKK", "ARK Innovation", 58.2],
];

const FI_SEED: [string, string, AssetClass, number][] = [
  ["US10Y", "US Treasury 10Y", "GOVT", 98.4],
  ["US2Y", "US Treasury 2Y", "GOVT", 99.7],
  ["US30Y", "US Treasury 30Y", "GOVT", 95.1],
  ["BUND10", "German Bund 10Y", "GOVT", 132.6],
  ["GILT10", "UK Gilt 10Y", "GOVT", 91.2],
  ["AAPL28", "Apple 4.5% 2028", "CORP", 101.3],
  ["F29", "Ford 6.1% 2029", "CORP", 97.8],
  ["T30", "AT&T 5.4% 2030", "CORP", 99.1],
];

const OTHER_SEED: [string, string, AssetClass, number][] = [
  ["ES1", "E-mini S&P Fut", "FUTURE", 7383.0],
  ["NQ1", "E-mini Nasdaq Fut", "FUTURE", 22800.0],
  ["CL1", "WTI Crude Fut", "FUTURE", 68.7],
  ["GC1", "Gold Future", "COMMODITY", 3350.0],
  ["EURUSD", "Euro / US Dollar", "FX", 1.147],
  ["USDJPY", "US Dollar / Yen", "FX", 143.5],
  ["GBPUSD", "Sterling / Dollar", "FX", 1.345],
  ["BTC", "Bitcoin", "CRYPTO", 108500.0],
  ["ETH", "Ethereum", "CRYPTO", 3920.0],
  ["VIX", "CBOE Volatility", "COMMODITY", 19.5],
];

function buildUniverse(): Security[] {
  const rng = new Rng("universe-v1");
  const out: Security[] = [];
  const cusip = () => rng.int(100000000, 999999999).toString();

  for (const [ticker, name, sector, px] of EQUITY_SEED) {
    const htb = ["GME", "AMC", "BBBY", "RIVN", "LCID", "SMCI", "MSTR", "CVNA", "UPST", "AFRM", "DJT", "COIN"].includes(ticker);
    out.push({
      ticker, name, assetClass: "EQUITY", sector, cusip: cusip(), px,
      vol: rng.float(0.012, htb ? 0.075 : 0.03),
      borrowFee: htb ? rng.float(350, 2200) : rng.float(8, 45),
      hardToBorrow: htb,
      marketCap: px * rng.float(2e8, 3.2e9),
    });
  }
  for (const [ticker, name, px] of ETF_SEED) {
    out.push({ ticker, name, assetClass: "ETF", sector: "Index", cusip: cusip(), px, vol: rng.float(0.008, 0.022), borrowFee: rng.float(15, 90), hardToBorrow: rng.bool(0.25), marketCap: px * rng.float(1e8, 1.2e9) });
  }
  for (const [ticker, name, ac, px] of FI_SEED) {
    out.push({ ticker, name, assetClass: ac, sector: ac === "GOVT" ? "Sovereign" : "Credit", cusip: cusip(), px, vol: rng.float(0.002, 0.012), borrowFee: rng.float(5, 35), hardToBorrow: false, marketCap: px * rng.float(5e8, 5e9) });
  }
  for (const [ticker, name, ac, px] of OTHER_SEED) {
    out.push({ ticker, name, assetClass: ac, sector: ac, cusip: cusip(), px, vol: rng.float(0.01, 0.05), borrowFee: 0, hardToBorrow: false, marketCap: px * rng.float(1e8, 2e9) });
  }
  return out;
}

export const UNIVERSE: Security[] = buildUniverse();
export const SECTOR_LIST = SECTORS;

export const EQUITIES = UNIVERSE.filter((s) => s.assetClass === "EQUITY");
export const LENDABLE = UNIVERSE.filter((s) => ["EQUITY", "ETF", "CORP", "GOVT"].includes(s.assetClass));

export function bySymbol(ticker: string): Security | undefined {
  return UNIVERSE.find((s) => s.ticker === ticker);
}

// Fictional counterparties. Names, types, ratings and regions are invented for the simulated desk; no
// relationship with, rating of, or event at any real firm is implied. Keep real names out (guard test:
// src/data/fictionalCounterparties.test.ts).
const CPTY_SEED: [string, string, Counterparty["type"], Counterparty["rating"], Counterparty["region"]][] = [
  ["cp-hf01", "Alderwood Capital", "HEDGE_FUND", "A", "AMER"],
  ["cp-hf02", "Bramblecrest Partners", "HEDGE_FUND", "A", "AMER"],
  ["cp-hf03", "Cobaltline Asset Mgmt", "HEDGE_FUND", "A", "AMER"],
  ["cp-hf04", "Driftwood Global", "HEDGE_FUND", "BBB", "AMER"],
  ["cp-hf05", "Emberfield Quant Advisors", "HEDGE_FUND", "A", "AMER"],
  ["cp-hf06", "Foxglove Systematic", "HEDGE_FUND", "A", "AMER"],
  ["cp-hf07", "Granite Arc Capital", "HEDGE_FUND", "BBB", "AMER"],
  ["cp-hf08", "Harrowgate Partners", "HEDGE_FUND", "BBB", "EMEA"],
  ["cp-hf09", "Ironbridge Macro", "HEDGE_FUND", "BBB", "EMEA"],
  ["cp-hf10", "Juniperhall Event Fund", "HEDGE_FUND", "A", "AMER"],
  ["cp-bk01", "Northwall Bank", "BANK", "A", "AMER"],
  ["cp-bk02", "Eastbridge Securities", "BANK", "A", "AMER"],
  ["cp-bk03", "Keystoneway National Bank", "BANK", "AA", "AMER"],
  ["cp-bk04", "Lakeshore Bancorp", "BANK", "A", "AMER"],
  ["cp-bk05", "Alpenrose Bank", "BANK", "A", "EMEA"],
  ["cp-bk06", "Rhonevale Credit Bank", "BANK", "A", "EMEA"],
  ["cp-bo01", "Summitline Index Partners", "BENEFICIAL_OWNER", "AAA", "AMER"],
  ["cp-bo02", "Valleyford Fund Group", "BENEFICIAL_OWNER", "AAA", "AMER"],
  ["cp-bo03", "Harborgate Global Advisors", "BENEFICIAL_OWNER", "AAA", "AMER"],
  ["cp-pn01", "Pacific Coast Teachers Pension", "PENSION", "AA", "AMER"],
  ["cp-sv01", "Sakura Public Reserve Fund", "SOVEREIGN", "AA", "APAC"],
  ["cp-sv02", "Nordhaven Sovereign Fund", "SOVEREIGN", "AAA", "EMEA"],
];

export const COUNTERPARTIES: Counterparty[] = CPTY_SEED.map(([id, name, type, rating, region]) => ({
  id, name, short: name.split(" ")[0].toUpperCase().slice(0, 6), type, rating, region,
}));

export const HEDGE_FUNDS = COUNTERPARTIES.filter((c) => c.type === "HEDGE_FUND");
export const BENEFICIAL_OWNERS = COUNTERPARTIES.filter((c) => c.type === "BENEFICIAL_OWNER" || c.type === "PENSION" || c.type === "SOVEREIGN");
export const BORROWERS = COUNTERPARTIES.filter((c) => c.type === "HEDGE_FUND" || c.type === "BANK" || c.type === "BROKER");

const TRADER_SEED: [string, string][] = [
  ["T-AMA", "A. Maddox — SL Equities"],
  ["T-RVK", "R. Volkov — SL Fixed Income"],
  ["T-JPC", "J. Park — Prime Financing"],
  ["T-SOK", "S. Okafor — Collateral Desk"],
  ["T-LMR", "L. Moreau — Treasury / Repo"],
  ["T-DKM", "D. Kim — Delta One"],
  ["T-NAH", "N. Ahmed — Specials Trading"],
  ["T-EWS", "E. Watson — GC / Index"],
];

export const TRADERS: Trader[] = TRADER_SEED.map(([id, n]) => {
  const [name, desk] = n.split(" — ");
  return { id, name, desk };
});
