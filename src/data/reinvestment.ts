import { Rng } from "@/lib/rng";

/** Cash collateral reinvestment analytics for the securities lending cash book. */

export type LiquidityBucket = "T+0" | "T+1" | "T+7" | "TERM";
export type CreditBucket = "HQLA" | "AGENCY" | "A1/P1" | "BANK" | "CREDIT";

export interface ReinvestmentPosition {
  instrument: string;
  bucket: LiquidityBucket;
  credit: CreditBucket;
  allocation: number; // USD
  yieldBps: number;
  wamDays: number;
  walDays: number;
  limitPct: number;
  utilizationPct: number;
  fedBeta: number; // share of Fed move passed through to yield
}

export interface ReinvestmentSummary {
  cashCollateral: number;
  reinvestYieldBps: number;
  rebateCostBps: number;
  netSpreadBps: number;
  wamDays: number;
  t0Liquidity: number;
  stressLiquidity: number;
  fedCutImpactUsd: number;
  monthlyIncome: number;
}

export interface ReinvestmentScenario {
  scenario: string;
  policyMoveBps: number;
  incomeImpact: number;
  netSpreadBps: number;
  liquidityImpact: number;
  color: string;
}

export interface ReinvestmentConstraint {
  constraint: string;
  current: number;
  limit: number;
  unit: "%" | "days" | "$";
  status: "OK" | "WATCH" | "BREACH";
}

export interface ReinvestmentRecommendation {
  action: "ROLL" | "TRIM" | "ADD" | "HEDGE" | "HOLD";
  target: string;
  rationale: string;
  impactUsd: number;
  priority: "HIGH" | "MED" | "LOW";
}

const POSITIONS: [string, LiquidityBucket, CreditBucket, number, number, number, number, number][] = [
  ["O/N Reverse Repo - UST", "T+0", "HQLA", 7.8, 432, 1, 1, 100],
  ["Tri-Party GC Repo", "T+0", "HQLA", 6.1, 434, 3, 3, 96],
  ["T-Bills 1-3M", "T+1", "HQLA", 5.4, 424, 46, 44, 82],
  ["Agency Discount Notes", "T+1", "AGENCY", 3.2, 429, 32, 30, 78],
  ["A1/P1 Commercial Paper", "T+7", "A1/P1", 2.6, 449, 39, 35, 62],
  ["Bank Time Deposits", "TERM", "BANK", 2.1, 441, 21, 19, 70],
  ["Ultra-Short Credit ETF Proxy", "T+1", "CREDIT", 1.4, 462, 55, 48, 48],
];

export function getReinvestmentPositions(): ReinvestmentPosition[] {
  const rng = new Rng("reinv-positions");
  return POSITIONS.map(([instrument, bucket, credit, baseAllocation, baseYield, wam, wal, beta]) => {
    const allocation = baseAllocation * 1e9 * rng.float(0.92, 1.08);
    const limitPct = bucket === "TERM" ? 12 : credit === "CREDIT" ? 8 : credit === "BANK" ? 15 : 40;
    const utilizationPct = Math.min(99, (allocation / (limitPct * 0.36e9)) * rng.float(0.88, 1.04));
    return {
      instrument,
      bucket,
      credit,
      allocation,
      yieldBps: baseYield + rng.float(-6, 7),
      wamDays: wam,
      walDays: wal,
      limitPct,
      utilizationPct,
      fedBeta: beta,
    };
  });
}

export type LiveCurveData = Record<string, { observations: { date: string; value: number }[]; source: string }>;

const YIELD_MAP: Record<string, string> = {
  "O/N Reverse Repo - UST": "SOFR",
  "Tri-Party GC Repo": "SOFR",
  "T-Bills 1-3M": "DGS3MO",
  "Agency Discount Notes": "DGS3MO",
  "A1/P1 Commercial Paper": "DCPF3M",
  "Bank Time Deposits": "DGS6MO",
  "Ultra-Short Credit ETF Proxy": "DGS1",
};

export function mergeLiveYields(positions: ReinvestmentPosition[], fred: LiveCurveData): ReinvestmentPosition[] {
  return positions.map((p) => {
    const fredId = YIELD_MAP[p.instrument];
    if (!fredId) return p;
    const obs = fred[fredId]?.observations;
    if (!obs?.length) return p;
    const liveRate = obs[obs.length - 1].value;
    const spread = p.instrument === "A1/P1 Commercial Paper" ? 15 : p.instrument === "Ultra-Short Credit ETF Proxy" ? 28 : p.instrument === "Agency Discount Notes" ? -5 : 0;
    return { ...p, yieldBps: liveRate * 100 + spread };
  });
}

export function getReinvestmentSummary(): ReinvestmentSummary {
  const positions = getReinvestmentPositions();
  const cashCollateral = positions.reduce((a, p) => a + p.allocation, 0);
  const reinvestYieldBps = positions.reduce((a, p) => a + p.allocation * p.yieldBps, 0) / cashCollateral;
  const rebateCostBps = 388;
  const netSpreadBps = reinvestYieldBps - rebateCostBps;
  const wamDays = positions.reduce((a, p) => a + p.allocation * p.wamDays, 0) / cashCollateral;
  const t0Liquidity = positions.filter((p) => p.bucket === "T+0").reduce((a, p) => a + p.allocation, 0);
  const stressLiquidity = positions.filter((p) => p.bucket === "T+0" || p.bucket === "T+1").reduce((a, p) => a + p.allocation, 0);
  const avgBeta = positions.reduce((a, p) => a + p.allocation * p.fedBeta, 0) / cashCollateral / 100;
  const fedCutImpactUsd = cashCollateral * (25 * avgBeta) / 10000;
  return {
    cashCollateral,
    reinvestYieldBps,
    rebateCostBps,
    netSpreadBps,
    wamDays,
    t0Liquidity,
    stressLiquidity,
    fedCutImpactUsd,
    monthlyIncome: (cashCollateral * netSpreadBps) / 10000 / 12,
  };
}

export function computeReinvestmentKpis(positions: ReinvestmentPosition[]): Pick<ReinvestmentSummary, "reinvestYieldBps" | "netSpreadBps" | "wamDays" | "t0Liquidity" | "monthlyIncome"> {
  const cashCollateral = positions.reduce((a, p) => a + p.allocation, 0);
  const reinvestYieldBps = positions.reduce((a, p) => a + p.allocation * p.yieldBps, 0) / cashCollateral;
  const rebateCostBps = 388;
  const netSpreadBps = reinvestYieldBps - rebateCostBps;
  const wamDays = positions.reduce((a, p) => a + p.allocation * p.wamDays, 0) / cashCollateral;
  const t0Liquidity = positions.filter((p) => p.bucket === "T+0").reduce((a, p) => a + p.allocation, 0);
  return { reinvestYieldBps, netSpreadBps, wamDays, t0Liquidity, monthlyIncome: (cashCollateral * netSpreadBps) / 10000 / 12 };
}

/**
 * Rate-move scenarios. Pass the book actually on screen (live-merged yields) so scenarios match the KPI strip;
 * without it the simulated summary is used. The 0.82 and 0.42 pass-through factors are illustrative
 * constants carried over from the original dashboard; they are not calibrated.
 */
export function getReinvestmentScenarios(book: Pick<ReinvestmentSummary, "cashCollateral" | "netSpreadBps"> = getReinvestmentSummary()): ReinvestmentScenario[] {
  const summary = book;
  const defs: [string, number, number, string][] = [
    ["Hold", 0, 0, "#3B9DFF"],
    ["25bp Cut", -25, -0.9, "#FF8C00"],
    ["100bp Cut", -100, -3.7, "#FF3B3B"],
    ["Repo Squeeze", 35, -0.4, "#A78BFA"],
    ["Bills Rally", -15, 1.2, "#2ECC71"],
  ];
  return defs.map(([scenario, move, liquidityShift, color]) => {
    const betaMove = move * 0.82;
    const netSpreadBps = summary.netSpreadBps + betaMove * 0.42;
    return {
      scenario,
      policyMoveBps: move,
      incomeImpact: summary.cashCollateral * (netSpreadBps - summary.netSpreadBps) / 10000,
      netSpreadBps,
      liquidityImpact: liquidityShift,
      color,
    };
  });
}

export function getReinvestmentConstraints(): ReinvestmentConstraint[] {
  const summary = getReinvestmentSummary();
  const positions = getReinvestmentPositions();
  const t0Pct = (summary.t0Liquidity / summary.cashCollateral) * 100;
  const creditPct = (positions.filter((p) => p.credit === "CREDIT").reduce((a, p) => a + p.allocation, 0) / summary.cashCollateral) * 100;
  const bankPct = (positions.filter((p) => p.credit === "BANK").reduce((a, p) => a + p.allocation, 0) / summary.cashCollateral) * 100;
  const cpPct = (positions.filter((p) => p.credit === "A1/P1").reduce((a, p) => a + p.allocation, 0) / summary.cashCollateral) * 100;
  const rows: ReinvestmentConstraint[] = [
    { constraint: "Minimum T+0 liquidity", current: t0Pct, limit: 40, unit: "%", status: t0Pct >= 40 ? "OK" : "WATCH" },
    { constraint: "WAM limit", current: summary.wamDays, limit: 45, unit: "days", status: summary.wamDays <= 45 ? "OK" : "WATCH" },
    { constraint: "Credit ETF proxy cap", current: creditPct, limit: 8, unit: "%", status: creditPct <= 8 ? "OK" : "BREACH" },
    { constraint: "Bank deposit cap", current: bankPct, limit: 15, unit: "%", status: bankPct <= 15 ? "OK" : "WATCH" },
    { constraint: "CP concentration cap", current: cpPct, limit: 14, unit: "%", status: cpPct <= 14 ? "OK" : "WATCH" },
  ];
  return rows;
}

export function getReinvestmentRecommendations(): ReinvestmentRecommendation[] {
  const summary = getReinvestmentSummary();
  return [
    {
      action: "ROLL",
      target: "A1/P1 Commercial Paper",
      rationale: "Roll maturing CP into bills unless spread pickup remains above 20 bps after liquidity charge.",
      impactUsd: summary.cashCollateral * 0.00042,
      priority: "MED",
    },
    {
      action: "ADD",
      target: "T-Bills 1-3M",
      rationale: "Add high-quality ladder capacity ahead of the next FOMC repricing window.",
      impactUsd: summary.cashCollateral * 0.00028,
      priority: "HIGH",
    },
    {
      action: "TRIM",
      target: "Ultra-Short Credit ETF Proxy",
      rationale: "Credit proxy has the weakest liquidity score and highest stress haircut.",
      impactUsd: summary.cashCollateral * 0.00018,
      priority: "MED",
    },
    {
      action: "HEDGE",
      target: "Fed beta",
      rationale: "A 25bp cut reduces monthly carry; hedge near-term beta through shorter reset assets.",
      impactUsd: summary.fedCutImpactUsd,
      priority: "HIGH",
    },
  ];
}
