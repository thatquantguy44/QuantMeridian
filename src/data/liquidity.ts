import { Rng } from "@/lib/rng";

/** Liquidity and funding stress cockpit data. */

export type Horizon = "T+0" | "T+1" | "T+2" | "1W" | "1M";
export type StressSeverity = "BASE" | "WATCH" | "STRESS" | "SEVERE";

export interface LiquidityBucket {
  horizon: Horizon;
  openingCash: number;
  inflows: number;
  outflows: number;
  marginCalls: number;
  securedFunding: number;
  closingLiquidity: number;
  minimumBuffer: number;
}

export interface FundingFacility {
  facility: string;
  type: "CASH" | "REPO" | "CP" | "FX_SWAP" | "INTERNAL" | "CONTINGENT";
  capacity: number;
  drawn: number;
  costBps: number;
  reliability: number;
  timeToFund: string;
}

export interface LiquidityStressScenario {
  scenario: string;
  severity: StressSeverity;
  marginShock: number;
  collateralShock: number;
  fundingCostBps: number;
  bufferAfterShock: number;
  survivalDays: number;
}

export interface EarlyWarningSignal {
  signal: string;
  /** "FRED" only when the value was replaced by live data; every other value is simulated. */
  source: "FRED" | "SIM";
  latest: number;
  threshold: number;
  unit: "bps" | "%" | "$B" | "z";
  status: "OK" | "WATCH" | "RISK";
  deskImpact: string;
}

export interface LiquiditySummary {
  totalLiquidAssets: number;
  totalOutflowsToday: number;
  netLiquidityToday: number;
  stressBuffer: number;
  survivalDays: number;
  weightedFundingCostBps: number;
  highPriorityCalls: number;
  contingencyCapacity: number;
}

const HORIZONS: Horizon[] = ["T+0", "T+1", "T+2", "1W", "1M"];

export function getLiquidityBuckets(): LiquidityBucket[] {
  const rng = new Rng("liq-buckets");
  let opening = 18.4e9;
  return HORIZONS.map((h, i) => {
    const inflows = rng.float(1.2, 5.6) * 1e9 * (i > 2 ? 1.6 : 1);
    const outflows = rng.float(1.8, 6.4) * 1e9 * (i > 2 ? 1.4 : 1);
    const marginCalls = rng.float(0.6, 3.8) * 1e9 * (i === 0 ? 1.4 : 1);
    const securedFunding = rng.float(0.9, 4.2) * 1e9;
    const closingLiquidity = opening + inflows + securedFunding - outflows - marginCalls;
    const minimumBuffer = (7.5 + i * 0.9) * 1e9;
    const bucket = { horizon: h, openingCash: opening, inflows, outflows, marginCalls, securedFunding, closingLiquidity, minimumBuffer };
    opening = closingLiquidity;
    return bucket;
  });
}

export function getFundingFacilities(): FundingFacility[] {
  const rng = new Rng("liq-facilities");
  const defs: [string, FundingFacility["type"], number, number, string][] = [
    ["Operating Cash", "CASH", 9.5, 0, "Now"],
    ["GC Repo Lines", "REPO", 14.0, 461, "15 min"],
    ["Term Repo Capacity", "REPO", 8.0, 474, "2 hr"],
    ["Commercial Paper", "CP", 5.2, 486, "Same day"],
    ["FX Swap Liquidity", "FX_SWAP", 4.8, 492, "1 hr"],
    ["Internal Treasury Backstop", "INTERNAL", 6.5, 455, "30 min"],
    ["Committed Contingent Line", "CONTINGENT", 7.0, 525, "T+1"],
  ];
  return defs.map(([facility, type, capacityBase, costBps, timeToFund]) => {
    const capacity = capacityBase * 1e9;
    return {
      facility,
      type,
      capacity,
      drawn: capacity * rng.float(type === "CASH" ? 0.05 : 0.18, type === "CONTINGENT" ? 0.2 : 0.78),
      costBps: costBps + rng.float(-6, 8),
      reliability: type === "CONTINGENT" ? rng.float(78, 88) : rng.float(86, 99),
      timeToFund,
    };
  });
}

export function getLiquidityStressScenarios(): LiquidityStressScenario[] {
  const summary = getLiquiditySummary();
  const defs: [string, StressSeverity, number, number, number][] = [
    ["Base Case", "BASE", 0.0, 0.0, 0],
    ["CPI Rates Shock", "WATCH", 2.2e9, 1.4e9, 18],
    ["Credit Spread Gap", "STRESS", 4.8e9, 3.1e9, 42],
    ["Prime Client Draw", "STRESS", 6.0e9, 2.3e9, 35],
    ["Repo Market Squeeze", "SEVERE", 7.5e9, 4.5e9, 78],
  ];
  return defs.map(([scenario, severity, marginShock, collateralShock, costShock]) => {
    const bufferAfterShock = summary.stressBuffer - marginShock - collateralShock;
    const dailyBurn = Math.max(0.8e9, summary.totalOutflowsToday * 0.32);
    return {
      scenario,
      severity,
      marginShock,
      collateralShock,
      fundingCostBps: summary.weightedFundingCostBps + costShock,
      bufferAfterShock,
      survivalDays: Math.max(0, bufferAfterShock / dailyBurn),
    };
  });
}

export function getEarlyWarningSignals(): EarlyWarningSignal[] {
  return [
    { signal: "SOFR - EFFR spread", source: "SIM", latest: 14, threshold: 20, unit: "bps", status: "WATCH", deskImpact: "Repo funding pressure into collateral calls" },
    { signal: "HY OAS 5d move", source: "SIM", latest: 38, threshold: 50, unit: "bps", status: "WATCH", deskImpact: "Higher credit haircuts and client margin" },
    { signal: "Equity drawdown proxy", source: "SIM", latest: -3.8, threshold: -6, unit: "%", status: "OK", deskImpact: "Prime margin and recall pressure" },
    { signal: "HYG volume z-score", source: "SIM", latest: 1.9, threshold: 2.2, unit: "z", status: "WATCH", deskImpact: "Credit liquidity weakening" },
    { signal: "Available intraday cash", source: "SIM", latest: 11.2, threshold: 8.5, unit: "$B", status: "OK", deskImpact: "Immediate settlement buffer" },
    { signal: "Contingent line usage", source: "SIM", latest: 68, threshold: 75, unit: "%", status: "WATCH", deskImpact: "Backstop capacity becoming scarce" },
  ];
}

export type LiveEWSData = Record<string, { observations: { date: string; value: number }[]; source: string }>;

export function mergeLiveEWS(signals: EarlyWarningSignal[], fred: LiveEWSData): EarlyWarningSignal[] {
  const last = (id: string) => {
    const obs = fred[id]?.observations;
    return obs?.length ? obs[obs.length - 1].value : null;
  };
  const lastN = (id: string, n: number) => {
    const obs = fred[id]?.observations;
    return obs && obs.length >= n ? obs.slice(-n).map((o) => o.value) : null;
  };

  return signals.map((s) => {
    if (s.signal === "SOFR - EFFR spread") {
      const sofr = last("SOFR");
      const effr = last("EFFR");
      if (sofr != null && effr != null) {
        const spread = (sofr - effr) * 100;
        return { ...s, source: "FRED", latest: Math.round(spread * 10) / 10, status: Math.abs(spread) >= s.threshold ? "RISK" : Math.abs(spread) >= s.threshold * 0.7 ? "WATCH" : "OK" };
      }
    }
    if (s.signal === "HY OAS 5d move") {
      const hist = lastN("BAMLH0A0HYM2", 6);
      if (hist) {
        const move = (hist[hist.length - 1] - hist[0]) * 100;
        return { ...s, source: "FRED", latest: Math.round(move * 10) / 10, status: Math.abs(move) >= s.threshold ? "RISK" : Math.abs(move) >= s.threshold * 0.7 ? "WATCH" : "OK" };
      }
    }
    return s;
  });
}

export function getLiquiditySummary(): LiquiditySummary {
  const buckets = getLiquidityBuckets();
  const facilities = getFundingFacilities();
  const today = buckets[0];
  const totalLiquidAssets = today.openingCash + facilities.reduce((a, f) => a + Math.max(0, f.capacity - f.drawn), 0);
  const totalOutflowsToday = today.outflows + today.marginCalls;
  const netLiquidityToday = today.closingLiquidity - today.minimumBuffer;
  const contingencyCapacity = facilities.filter((f) => f.type === "CONTINGENT" || f.type === "INTERNAL").reduce((a, f) => a + f.capacity - f.drawn, 0);
  const drawn = facilities.reduce((a, f) => a + f.drawn, 0) || 1;
  const weightedFundingCostBps = facilities.reduce((a, f) => a + f.drawn * f.costBps, 0) / drawn;
  return {
    totalLiquidAssets,
    totalOutflowsToday,
    netLiquidityToday,
    stressBuffer: buckets.reduce((a, b) => Math.min(a, b.closingLiquidity - b.minimumBuffer), Number.POSITIVE_INFINITY),
    survivalDays: Math.max(0, totalLiquidAssets / Math.max(totalOutflowsToday, 1)),
    weightedFundingCostBps,
    highPriorityCalls: 4,
    contingencyCapacity,
  };
}
