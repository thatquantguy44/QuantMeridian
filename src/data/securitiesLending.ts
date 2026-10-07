import { Rng } from "@/lib/rng";
import { LENDABLE, BORROWERS, BENEFICIAL_OWNERS, type Security, type Counterparty } from "./universe";

/** Every value in this module is simulated desk data (spec009 REQ-033; the agent desk-data route requires "SIM"). */
export const DATA_SOURCE = "SIM" as const;

/** Securities Lending domain — inventory, loan book, borrow demand, revenue. */

export interface InventoryRow {
  ticker: string;
  name: string;
  assetClass: string;
  source: "INTERNAL" | "BENEFICIAL_OWNER" | "PRIME";
  available: number; // shares
  onLoan: number;
  restricted: number;
  utilization: number; // %
  feeBps: number;
  classification: "GC" | "WARM" | "SPECIAL" | "HTB";
  marketValue: number;
}

export interface LoanRow {
  id: string;
  ticker: string;
  borrower: string;
  borrowerId: string;
  qty: number;
  notional: number;
  rateBps: number;
  collateralType: "CASH" | "NON_CASH";
  daysOpen: number;
  revenueDay: number;
  recallable: boolean;
}

export interface BorrowRequest {
  ticker: string;
  name: string;
  borrower: string;
  qty: number;
  bidBps: number;
  classification: "GC" | "WARM" | "SPECIAL" | "HTB";
  filled: number; // %
  urgency: "LOW" | "MED" | "HIGH";
}

function classify(feeBps: number, htb: boolean): InventoryRow["classification"] {
  if (htb || feeBps > 500) return "HTB";
  if (feeBps > 150) return "SPECIAL";
  if (feeBps > 50) return "WARM";
  return "GC";
}

export function getInventory(): InventoryRow[] {
  const rng = new Rng("sl-inv-1");
  const sources: InventoryRow["source"][] = ["INTERNAL", "BENEFICIAL_OWNER", "PRIME"];
  const rows: InventoryRow[] = [];
  for (const s of LENDABLE) {
    for (const source of sources) {
      if (rng.bool(0.35) && source === "PRIME") continue;
      const base = Math.round(rng.float(0.2, 3) * (s.assetClass === "GOVT" ? 5e6 : 8e5));
      const util = rng.float(s.hardToBorrow ? 0.7 : 0.2, s.hardToBorrow ? 0.99 : 0.85);
      const onLoan = Math.round(base * util);
      const restricted = Math.round(base * rng.float(0, 0.08));
      rows.push({
        ticker: s.ticker, name: s.name, assetClass: s.assetClass, source,
        available: base - onLoan - restricted, onLoan, restricted,
        utilization: util * 100,
        feeBps: s.borrowFee * rng.float(0.85, 1.15),
        classification: classify(s.borrowFee, s.hardToBorrow),
        marketValue: base * s.px,
      });
    }
  }
  return rows.sort((a, b) => b.marketValue - a.marketValue);
}

export function getLoanBook(): LoanRow[] {
  const rng = new Rng("sl-loan-1");
  const rows: LoanRow[] = [];
  let id = 1000;
  for (const s of LENDABLE) {
    const nLoans = rng.int(1, s.hardToBorrow ? 5 : 3);
    for (let i = 0; i < nLoans; i++) {
      const borrower = rng.pick(BORROWERS);
      const qty = Math.round(rng.float(0.05, 1.2) * 5e5);
      const notional = qty * s.px;
      const rateBps = s.borrowFee * rng.float(0.9, 1.2);
      rows.push({
        id: `LN${id++}`,
        ticker: s.ticker, borrower: borrower.name, borrowerId: borrower.id,
        qty, notional, rateBps,
        collateralType: rng.bool(0.62) ? "CASH" : "NON_CASH",
        daysOpen: rng.int(1, 240),
        revenueDay: (notional * rateBps) / 10000 / 360,
        recallable: rng.bool(0.18),
      });
    }
  }
  return rows.sort((a, b) => b.revenueDay - a.revenueDay);
}

export function getBorrowDemand(): BorrowRequest[] {
  const rng = new Rng("sl-demand-1");
  const urg: BorrowRequest["urgency"][] = ["LOW", "MED", "HIGH"];
  return LENDABLE.filter((s) => s.hardToBorrow || rng.bool(0.4))
    .map((s) => {
      const cls = classify(s.borrowFee, s.hardToBorrow);
      return {
        ticker: s.ticker, name: s.name, borrower: rng.pick(BORROWERS).name,
        qty: Math.round(rng.float(0.1, 2) * 4e5),
        bidBps: s.borrowFee * rng.float(0.95, 1.4),
        classification: cls,
        filled: rng.float(cls === "HTB" ? 0.2 : 0.6, 1) * 100,
        urgency: cls === "HTB" ? "HIGH" : rng.pick(urg),
      };
    })
    .sort((a, b) => b.bidBps - a.bidBps);
}

export interface RevenueByKey {
  key: string;
  label: string;
  dayRevenue: number;
  mtdRevenue: number;
  ytdRevenue: number;
  share: number;
}

export interface SLSummary {
  dayRevenue: number;
  mtdRevenue: number;
  ytdRevenue: number;
  dayChgPct: number;
  totalOnLoan: number;
  totalAvailable: number;
  utilization: number;
  activeLoans: number;
  specialsBalance: number;
  htbCount: number;
  avgFeeBps: number;
  revenueTrend: number[];
  byBorrower: RevenueByKey[];
  bySecurity: RevenueByKey[];
  byAssetClass: RevenueByKey[];
}

export function getSLSummary(): SLSummary {
  const rng = new Rng("sl-sum-1");
  const loans = getLoanBook();
  const inv = getInventory();
  const dayRevenue = loans.reduce((a, l) => a + l.revenueDay, 0);
  const totalOnLoan = inv.reduce((a, r) => a + r.onLoan * 1, 0);
  const totalAvailable = inv.reduce((a, r) => a + r.available, 0);
  const onLoanMV = inv.reduce((a, r) => a + (r.marketValue * r.utilization) / 100, 0);

  const aggByKey = (keyFn: (l: LoanRow) => string, labelFn: (k: string) => string): RevenueByKey[] => {
    const m = new Map<string, number>();
    for (const l of loans) m.set(keyFn(l), (m.get(keyFn(l)) ?? 0) + l.revenueDay);
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    return [...m.entries()]
      .map(([key, day]) => ({ key, label: labelFn(key), dayRevenue: day, mtdRevenue: day * rng.float(18, 23), ytdRevenue: day * rng.float(150, 240), share: (day / total) * 100 }))
      .sort((a, b) => b.dayRevenue - a.dayRevenue);
  };

  const byBorrower = aggByKey((l) => l.borrower, (k) => k).slice(0, 10);
  const bySecurity = aggByKey((l) => l.ticker, (k) => k).slice(0, 12);
  const byAssetClass = aggByKey((l) => l.ticker, (k) => k); // re-key below
  const acMap = new Map<string, number>();
  for (const l of loans) {
    const sec = LENDABLE.find((s) => s.ticker === l.ticker)!;
    acMap.set(sec.assetClass, (acMap.get(sec.assetClass) ?? 0) + l.revenueDay);
  }
  const acTotal = [...acMap.values()].reduce((a, b) => a + b, 0);
  const byAssetClassFinal: RevenueByKey[] = [...acMap.entries()].map(([key, day]) => ({ key, label: key, dayRevenue: day, mtdRevenue: day * 20, ytdRevenue: day * 200, share: (day / acTotal) * 100 })).sort((a, b) => b.dayRevenue - a.dayRevenue);

  return {
    dayRevenue,
    mtdRevenue: dayRevenue * rng.float(18, 22),
    ytdRevenue: dayRevenue * rng.float(150, 210),
    dayChgPct: rng.normal(2.5, 6),
    totalOnLoan,
    totalAvailable,
    utilization: (onLoanMV / (onLoanMV + totalAvailable * 50)) * 100 + 38,
    activeLoans: loans.length,
    specialsBalance: inv.filter((r) => r.classification === "SPECIAL" || r.classification === "HTB").reduce((a, r) => a + (r.marketValue * r.utilization) / 100, 0),
    htbCount: new Set(inv.filter((r) => r.classification === "HTB").map((r) => r.ticker)).size,
    avgFeeBps: loans.reduce((a, l) => a + l.rateBps, 0) / loans.length,
    revenueTrend: new Rng("sl-trend").walk(60, dayRevenue * 0.8, 0.06, 0.004),
    byBorrower,
    bySecurity,
    byAssetClass: byAssetClassFinal,
  };
}

export type PipelinePriceMap = Map<string, number>;

export function mergeLiveInventoryPrices(rows: InventoryRow[], prices: PipelinePriceMap): InventoryRow[] {
  if (prices.size === 0) return rows;
  return rows.map((r) => {
    const livePx = prices.get(r.ticker);
    if (livePx == null) return r;
    const totalShares = r.available + r.onLoan + r.restricted;
    return { ...r, marketValue: totalShares * livePx };
  });
}

/** Sankey flow: beneficial owners → desk → borrowers (value = revenue). */
export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}
export interface SankeyNode {
  id: string;
  label: string;
  col: number;
}
export function getRevenueSankey(): { nodes: SankeyNode[]; links: SankeyLink[] } {
  const rng = new Rng("sl-sankey");
  const owners = BENEFICIAL_OWNERS.slice(0, 5);
  const borrowers = BORROWERS.slice(0, 6);
  const nodes: SankeyNode[] = [
    ...owners.map((o) => ({ id: `O:${o.id}`, label: o.short, col: 0 })),
    { id: "DESK", label: "Lending Desk", col: 1 },
    ...borrowers.map((b) => ({ id: `B:${b.id}`, label: b.short, col: 2 })),
  ];
  const links: SankeyLink[] = [];
  for (const o of owners) links.push({ source: `O:${o.id}`, target: "DESK", value: rng.float(0.4, 1.6) });
  for (const b of borrowers) links.push({ source: "DESK", target: `B:${b.id}`, value: rng.float(0.4, 1.6) });
  return { nodes, links };
}
