import { Rng } from "@/lib/rng";
import { COUNTERPARTIES } from "./universe";

/** Every value in this module is simulated desk data (spec009 REQ-033; the agent desk-data route requires "SIM"). */
export const DATA_SOURCE = "SIM" as const;

/** Collateral Management — margin, optimization, constraints, what-if. */

export interface MarginRow {
  counterparty: string;
  agreement: "ISDA-CSA" | "GMRA" | "MSLA" | "CCP";
  im: number; // initial margin USD
  vm: number; // variation margin USD
  posted: number;
  excess: number; // posted - required (negative = deficit)
  threshold: number;
  rating: string;
}

export interface CollateralAsset {
  asset: string;
  type: "CASH_USD" | "CASH_EUR" | "UST" | "AGENCY" | "CORP_IG" | "CORP_HY" | "EQUITY" | "GOLD";
  available: number; // market value USD
  haircut: number; // %
  currentAlloc: number; // currently posted USD
  optimizedAlloc: number; // recommended USD
  costBps: number; // opportunity cost of pledging
  eligiblePct: number; // share of counterparties accepting
}

export interface CollateralSummary {
  totalIM: number;
  totalVM: number;
  excessCollateral: number;
  deficit: number;
  deficitCount: number;
  optimizedSavings: number;
  currentCost: number;
  optimizedCost: number;
  utilizationPct: number;
  postedTrend: number[];
}

const ASSETS: [CollateralAsset["type"], string, number, number][] = [
  ["CASH_USD", "USD Cash", 0, 5],
  ["CASH_EUR", "EUR Cash", 0.5, 12],
  ["UST", "US Treasuries", 0.5, 18],
  ["AGENCY", "Agency MBS", 2, 22],
  ["CORP_IG", "Corp IG Bonds", 5, 35],
  ["CORP_HY", "Corp HY Bonds", 12, 55],
  ["EQUITY", "Equities (Index)", 15, 42],
  ["GOLD", "Gold Bullion", 10, 38],
];

export function getCollateralAssets(): CollateralAsset[] {
  const rng = new Rng("coll-assets");
  return ASSETS.map(([type, asset, haircut, costBps]) => {
    const available = rng.float(1.5, 18) * 1e9;
    const current = available * rng.float(0.2, 0.7);
    // optimizer prefers cheaper-to-deliver (lower cost/haircut) assets
    const optBias = type.startsWith("CASH") ? 1.25 : type === "UST" ? 1.15 : haircut > 10 ? 0.7 : 1;
    const optimized = Math.min(available, current * optBias * rng.float(0.85, 1.15));
    return {
      asset, type, available, haircut: haircut + rng.float(0, 2),
      currentAlloc: current, optimizedAlloc: optimized,
      costBps: costBps + rng.float(-3, 5),
      eligiblePct: type.startsWith("CASH") ? 100 : type === "UST" ? 98 : rng.float(45, 90),
    };
  });
}

export function getMarginBook(): MarginRow[] {
  const rng = new Rng("coll-margin");
  const agr: MarginRow["agreement"][] = ["ISDA-CSA", "GMRA", "MSLA", "CCP"];
  return COUNTERPARTIES.filter(() => rng.bool(0.8)).map((c) => {
    const im = rng.float(0.05, 2.4) * 1e9;
    const vm = rng.float(-0.8, 0.9) * 1e9;
    const required = im + Math.max(0, vm);
    const posted = required * rng.float(0.88, 1.18);
    return {
      counterparty: c.name, agreement: rng.pick(agr),
      im, vm, posted, excess: posted - required,
      threshold: rng.float(0, 0.2) * 1e9,
      rating: c.rating,
    };
  }).sort((a, b) => a.excess - b.excess);
}

export function getCollateralSummary(): CollateralSummary {
  const assets = getCollateralAssets();
  const margin = getMarginBook();
  const rng = new Rng("coll-sum");
  const totalIM = margin.reduce((a, m) => a + m.im, 0);
  const totalVM = margin.reduce((a, m) => a + Math.max(0, m.vm), 0);
  const excess = margin.filter((m) => m.excess > 0).reduce((a, m) => a + m.excess, 0);
  const deficit = margin.filter((m) => m.excess < 0).reduce((a, m) => a + m.excess, 0);
  const currentCost = assets.reduce((a, x) => a + (x.currentAlloc * x.costBps) / 10000, 0);
  const optimizedCost = assets.reduce((a, x) => a + (x.optimizedAlloc * x.costBps) / 10000, 0) * 0.82;
  return {
    totalIM, totalVM,
    excessCollateral: excess,
    deficit,
    deficitCount: margin.filter((m) => m.excess < 0).length,
    optimizedSavings: currentCost - optimizedCost,
    currentCost,
    optimizedCost,
    utilizationPct: rng.float(72, 88),
    postedTrend: new Rng("coll-trend").walk(60, totalIM * 0.9, 0.015, 0.001),
  };
}

export interface Constraint {
  name: string;
  type: "HAIRCUT" | "CONCENTRATION" | "ELIGIBILITY" | "REGULATORY" | "COUNTERPARTY";
  current: number;
  limit: number;
  binding: boolean;
  shadowPrice: number; // $ per unit relaxation
}

export function getConstraints(): Constraint[] {
  const rng = new Rng("coll-constraints");
  const defs: [string, Constraint["type"], number, number][] = [
    ["Single-issuer concentration (UST)", "CONCENTRATION", 24.1, 25],
    ["Single-issuer concentration (Corp)", "CONCENTRATION", 18.4, 20],
    ["Min cash buffer", "REGULATORY", 8.2, 8],
    ["HY collateral cap", "ELIGIBILITY", 11.8, 12],
    ["Equity haircut floor", "HAIRCUT", 42, 40],
    ["LCR contribution", "REGULATORY", 118, 100],
    ["Wrong-way risk (Citadel)", "COUNTERPARTY", 6.4, 8],
    ["Cross-currency mismatch", "REGULATORY", 14.2, 15],
  ];
  return defs.map(([name, type, current, limit]) => {
    const binding = Math.abs(current - limit) / limit < 0.06;
    return { name, type, current, limit, binding, shadowPrice: binding ? rng.float(0.4, 4.2) * 1e6 : 0 };
  });
}
