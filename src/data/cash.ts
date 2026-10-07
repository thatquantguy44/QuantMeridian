import { Rng } from "@/lib/rng";

/** Every value in this module is simulated desk data (spec009 REQ-033; the agent desk-data route requires "SIM"). */
export const DATA_SOURCE = "SIM" as const;

/** Cash Optimizer — treasury funding sources/uses & optimization. */

export interface FundingSource {
  source: string;
  type: "CASH" | "REPO" | "SECLENDING_CASH" | "INTERNAL" | "FX_SWAP" | "CP";
  available: number; // USD
  rateBps: number; // cost of funds
  tenor: string;
  used: number;
}

export interface FundingUse {
  use: string;
  type: "MARGIN_CALL" | "SETTLEMENT" | "CLIENT_FINANCING" | "TREASURY_INVEST" | "REDEMPTION";
  amount: number;
  rateBps: number; // return / cost avoided
  dueBy: string;
  priority: "HIGH" | "MED" | "LOW";
}

export interface CashSummary {
  totalSources: number;
  totalUses: number;
  fundingGap: number; // sources - uses (positive = surplus)
  blendedRateBps: number;
  optimizedRateBps: number;
  savingsBps: number;
  savingsUsd: number;
  lcr: number;
  nsfr: number;
  intradayPeak: number;
  liquidityBuffer: number;
  projTrend: number[];
}

export function getFundingSources(): FundingSource[] {
  const rng = new Rng("cash-src");
  const defs: [string, FundingSource["type"], number, string][] = [
    ["Operating Cash (USD)", "CASH", 4.55, "O/N"],
    ["GC Repo", "REPO", 4.61, "O/N"],
    ["Term Repo (1W)", "REPO", 4.68, "1W"],
    ["SecLending Cash Collateral", "SECLENDING_CASH", 4.42, "O/N"],
    ["Internal Funding (Treasury)", "INTERNAL", 4.5, "O/N"],
    ["FX Swap (EUR/USD)", "FX_SWAP", 4.72, "1W"],
    ["Commercial Paper", "CP", 4.79, "1M"],
    ["Reverse Repo Investment", "REPO", 4.58, "O/N"],
  ];
  return defs.map(([source, type, rate, tenor]) => {
    const available = rng.float(0.8, 12) * 1e9;
    return { source, type, available, rateBps: rate * 100, tenor, used: available * rng.float(0.2, 0.85) };
  });
}

export function getFundingUses(): FundingUse[] {
  const rng = new Rng("cash-use");
  const defs: [string, FundingUse["type"], number, string, FundingUse["priority"]][] = [
    ["LCH IM Posting", "MARGIN_CALL", 4.9, "11:00 ET", "HIGH"],
    ["DTC Settlement Net", "SETTLEMENT", 0, "15:30 ET", "HIGH"],
    ["Client Financing Draw — Citadel", "CLIENT_FINANCING", 5.4, "Intraday", "HIGH"],
    ["Prime Margin Call — Marshall Wace", "MARGIN_CALL", 4.95, "14:00 ET", "HIGH"],
    ["Money Market Investment", "TREASURY_INVEST", 4.74, "EOD", "LOW"],
    ["Fund Redemption Payout", "REDEMPTION", 0, "16:00 ET", "MED"],
    ["Triparty Collateral Sub", "SETTLEMENT", 0, "13:00 ET", "MED"],
    ["Client Financing Draw — Point72", "CLIENT_FINANCING", 5.25, "Intraday", "MED"],
  ];
  return defs.map(([use, type, rate, dueBy, priority]) => ({
    use, type, amount: rng.float(0.2, 6) * 1e9, rateBps: rate * 100, dueBy, priority,
  }));
}

export function getCashSummary(): CashSummary {
  const sources = getFundingSources();
  const uses = getFundingUses();
  const rng = new Rng("cash-sum");
  const totalSources = sources.reduce((a, s) => a + s.available, 0);
  const totalUses = uses.reduce((a, u) => a + u.amount, 0);
  const blended = sources.reduce((a, s) => a + (s.used * s.rateBps), 0) / sources.reduce((a, s) => a + s.used, 0);
  const optimized = blended - rng.float(3.5, 7);
  const fundedAmt = Math.min(totalSources, totalUses);
  return {
    totalSources, totalUses,
    fundingGap: totalSources - totalUses,
    blendedRateBps: blended,
    optimizedRateBps: optimized,
    savingsBps: blended - optimized,
    savingsUsd: (fundedAmt * (blended - optimized)) / 10000,
    lcr: rng.float(122, 138),
    nsfr: rng.float(108, 119),
    intradayPeak: totalUses * rng.float(0.6, 0.85),
    liquidityBuffer: totalSources * rng.float(0.15, 0.25),
    projTrend: new Rng("cash-trend").walk(48, totalUses * 0.5, 0.04, 0),
  };
}

export type LiveRateData = Record<string, { observations: { date: string; value: number }[]; source: string }>;

const RATE_MAP: Record<string, string> = {
  "Operating Cash (USD)": "DFF",
  "GC Repo": "SOFR",
  "Term Repo (1W)": "SOFR",
  "Reverse Repo Investment": "SOFR",
  "Commercial Paper": "DCPF3M",
};

export function mergeLiveFundingRates(sources: FundingSource[], fred: LiveRateData): FundingSource[] {
  return sources.map((s) => {
    const fredId = RATE_MAP[s.source];
    if (!fredId) return s;
    const obs = fred[fredId]?.observations;
    if (!obs?.length) return s;
    const liveRate = obs[obs.length - 1].value;
    const bps = liveRate * 100;
    const spread = s.source === "Term Repo (1W)" ? 7 : 0;
    return { ...s, rateBps: bps + spread };
  });
}

export function computeCashKpis(sources: FundingSource[], uses: FundingUse[]): Pick<CashSummary, "blendedRateBps" | "optimizedRateBps" | "savingsBps" | "savingsUsd" | "fundingGap"> {
  const rng = new Rng("cash-sum");
  const totalSources = sources.reduce((a, s) => a + s.available, 0);
  const totalUses = uses.reduce((a, u) => a + u.amount, 0);
  const blended = sources.reduce((a, s) => a + (s.used * s.rateBps), 0) / sources.reduce((a, s) => a + s.used, 0);
  const optimized = blended - rng.float(3.5, 7);
  const fundedAmt = Math.min(totalSources, totalUses);
  return {
    blendedRateBps: blended,
    optimizedRateBps: optimized,
    savingsBps: blended - optimized,
    savingsUsd: (fundedAmt * (blended - optimized)) / 10000,
    fundingGap: totalSources - totalUses,
  };
}

/** Optimal funding path: cheapest sources matched to highest-priority uses. */
export interface FundingPath {
  use: string;
  source: string;
  amount: number;
  rateBps: number;
  savedBps: number;
}

export function getFundingPath(): FundingPath[] {
  const rng = new Rng("cash-path");
  const sources = [...getFundingSources()].sort((a, b) => a.rateBps - b.rateBps);
  const uses = [...getFundingUses()].sort((a, b) => (a.priority === "HIGH" ? -1 : 1));
  const path: FundingPath[] = [];
  let si = 0;
  for (const u of uses) {
    const s = sources[si % sources.length];
    path.push({
      use: u.use, source: s.source,
      amount: u.amount * rng.float(0.7, 1),
      rateBps: s.rateBps,
      savedBps: rng.float(2, 9),
    });
    si++;
  }
  return path;
}
