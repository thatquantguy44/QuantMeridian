/**
 * SQZ — Borrow-Demand / Squeeze Radar (deterministic engine).
 *
 * Builds on the existing securities-lending spine: utilization & fee per name
 * come from `getInventory()` (aggregated across sources), and the security
 * reference data (sector, price, vol, hard-to-borrow) from the lending universe.
 * The forward-looking microstructure signals the desk wants — short interest,
 * days-to-cover, fee momentum, options skew, ETF flow — are synthesized from a
 * fixed seed *consistently* with that spine (an HTB special also reads high SI /
 * high DTC / positive fee momentum), so the analytics are coherent and swap
 * cleanly for a live borrow/short-interest vendor feed behind the same shapes.
 * The base board is SIM. A separate Yahoo short-interest overlay can update
 * SI and DTC for individual names, with source and report date on each row.
 */
import { Rng } from "@/lib/rng";
import type { YahooShortInterestRow } from "@/lib/server/yahooShortInterest";
import { getInventory } from "./securitiesLending";
import { LENDABLE, type Security } from "./universe";

export type Classification = "GC" | "WARM" | "SPECIAL" | "HTB";
export type HeatDir = "HEATING" | "COOLING" | "STABLE";

export interface SqueezeRow {
  ticker: string;
  name: string;
  sector: string;
  assetClass: string;
  classification: Classification;
  price: number;
  utilization: number; // %
  feeBps: number;
  feeMom5: number; // % change in fee, 5d
  feeMom20: number; // % change in fee, 20d
  feeHist: number[]; // recent fee path (bps)
  shortInterestPct: number; // % of float
  daysToCover: number;
  shortInterestSource: "SIM" | "YAHOO";
  shortInterestAsOf: string | null;
  putCall: number; // options put/call ratio
  skew: number; // 25-delta put-call skew (vol pts)
  etfFlow: number | null; // create/redeem, % of AUM (ETFs only)
  priceChg5: number; // %
  attention: number; // 0-100
  heat: number; // 0-100 composite
  direction: HeatDir;
  squeezeScore: number; // 0-100
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

interface Agg {
  util: number;
  fee: number;
  cls: Classification;
  n: number;
}

function aggregateInventory(): Map<string, Agg> {
  const m = new Map<string, Agg>();
  for (const r of getInventory()) {
    const a = m.get(r.ticker) ?? { util: 0, fee: 0, cls: r.classification, n: 0 };
    a.util += r.utilization;
    a.fee += r.feeBps;
    a.n += 1;
    // Prefer the hottest classification seen.
    const rank: Record<Classification, number> = { GC: 0, WARM: 1, SPECIAL: 2, HTB: 3 };
    if (rank[r.classification] > rank[a.cls]) a.cls = r.classification;
    m.set(r.ticker, a);
  }
  return m;
}

let CACHE: SqueezeRow[] | null = null;

export function getSqueezeBoard(): SqueezeRow[] {
  if (CACHE) return CACHE;
  const agg = aggregateInventory();
  const secByTicker = new Map<string, Security>(LENDABLE.map((s) => [s.ticker, s]));

  // First pass — raw signals.
  const base = LENDABLE.filter((s) => s.assetClass === "EQUITY" || s.assetClass === "ETF").map((s) => {
    const a = agg.get(s.ticker);
    const rng = new Rng(`sqz-${s.ticker}`);
    const util = a ? a.util / a.n : (s.hardToBorrow ? 88 : 45) + rng.float(-8, 8);
    const fee = a ? a.fee / a.n : s.borrowFee;
    const cls: Classification = a?.cls ?? (s.hardToBorrow ? "HTB" : fee > 150 ? "SPECIAL" : fee > 50 ? "WARM" : "GC");
    const hot = cls === "HTB" || cls === "SPECIAL";

    const feeMom20 = Number(rng.normal(hot ? 24 : 2, 26).toFixed(0));
    const feeMom5 = Number((feeMom20 * rng.float(0.25, 0.55) + rng.normal(0, 6)).toFixed(0));
    const shortInterestPct = Number(clamp(rng.normal(hot ? 22 : 6, hot ? 9 : 4), 0.3, 48).toFixed(1));
    const daysToCover = Number(clamp(rng.normal(hot ? 6.5 : 2.2, 2.4) + shortInterestPct / 12, 0.2, 18).toFixed(1));
    const putCall = Number(clamp(rng.normal(hot ? 1.35 : 0.95, 0.4), 0.3, 3).toFixed(2));
    const skew = Number(rng.normal(hot ? 6 : 1.5, 4).toFixed(1));
    const etfFlow = s.assetClass === "ETF" ? Number(rng.normal(0, 4.5).toFixed(1)) : null;
    const priceChg5 = Number(rng.normal(0, 4.5).toFixed(1));
    const attention = Math.round(clamp(rng.normal(hot ? 64 : 42, 22)));

    // fee path ending near current fee, sloped by 20d momentum
    const slope = (fee * (feeMom20 / 100)) / 20;
    const feeHist = Array.from({ length: 20 }, (_, i) => Number(Math.max(1, fee - slope * (19 - i) + rng.normal(0, fee * 0.03)).toFixed(0)));

    return { s, util: Number(util.toFixed(0)), fee: Number(fee.toFixed(0)), cls, feeMom5, feeMom20, shortInterestPct, daysToCover, putCall, skew, etfFlow, priceChg5, attention, feeHist };
  });

  // Fee percentile across the board.
  const fees = base.map((b) => b.fee).sort((x, y) => x - y);
  const feePctile = (f: number) => (fees.filter((x) => x <= f).length / fees.length) * 100;

  const rows: SqueezeRow[] = base.map((b) => {
    const feeP = feePctile(b.fee);
    const heat = Math.round(
      clamp(
        0.3 * b.util +
          0.2 * feeP +
          0.2 * clamp(50 + b.feeMom20 * 1.1) +
          0.15 * clamp(b.shortInterestPct * 2.6) +
          0.1 * clamp(b.daysToCover * 8) +
          0.05 * b.attention
      )
    );
    const direction: HeatDir = b.feeMom5 > 4 ? "HEATING" : b.feeMom5 < -4 ? "COOLING" : "STABLE";
    const squeezeScore = Math.round(
      clamp(0.4 * clamp(b.shortInterestPct * 2.6) + 0.3 * clamp(b.daysToCover * 8) + 0.2 * clamp(50 + b.feeMom5 * 2) + 0.1 * clamp(50 + b.priceChg5 * 6))
    );
    return {
      ticker: b.s.ticker,
      name: b.s.name,
      sector: b.s.sector,
      assetClass: b.s.assetClass,
      classification: b.cls,
      price: b.s.px,
      utilization: b.util,
      feeBps: b.fee,
      feeMom5: b.feeMom5,
      feeMom20: b.feeMom20,
      feeHist: b.feeHist,
      shortInterestPct: b.shortInterestPct,
      daysToCover: b.daysToCover,
      shortInterestSource: "SIM",
      shortInterestAsOf: null,
      putCall: b.putCall,
      skew: b.skew,
      etfFlow: b.etfFlow,
      priceChg5: b.priceChg5,
      attention: b.attention,
      heat,
      direction,
      squeezeScore,
    };
  });

  CACHE = rows.sort((a, b) => b.heat - a.heat);
  return CACHE;
}


/** Apply Yahoo's dated SI/DTC pair, then recompute every score that uses them. */
export function mergeShortInterest(board: SqueezeRow[], liveRows: YahooShortInterestRow[]): SqueezeRow[] {
  const live = new Map(liveRows.map((row) => [row.ticker, row]));
  const fees = board.map((row) => row.feeBps).sort((a, b) => a - b);
  return board.map((row) => {
    const observation = live.get(row.ticker);
    if (!observation || !Number.isFinite(observation.shortInterestPct) ||
        !Number.isFinite(observation.daysToCover) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(observation.asOf)) return row;
    const shortInterestPct = observation.shortInterestPct;
    const daysToCover = observation.daysToCover;
    const feePctile = fees.filter((fee) => fee <= row.feeBps).length / fees.length * 100;
    const heat = Math.round(clamp(
      0.3 * row.utilization + 0.2 * feePctile +
      0.2 * clamp(50 + row.feeMom20 * 1.1) +
      0.15 * clamp(shortInterestPct * 2.6) +
      0.1 * clamp(daysToCover * 8) + 0.05 * row.attention
    ));
    const squeezeScore = Math.round(clamp(
      0.4 * clamp(shortInterestPct * 2.6) +
      0.3 * clamp(daysToCover * 8) +
      0.2 * clamp(50 + row.feeMom5 * 2) +
      0.1 * clamp(50 + row.priceChg5 * 6)
    ));
    return {
      ...row, shortInterestPct, daysToCover, heat, squeezeScore,
      shortInterestSource: "YAHOO" as const, shortInterestAsOf: observation.asOf,
    };
  }).sort((a, b) => b.heat - a.heat);
}

// ── Derived views ────────────────────────────────────────────────────────────

/** Specials that are cheap relative to demand — the re-rate money view. */
export function getRerateCandidates(board: SqueezeRow[] = getSqueezeBoard()): SqueezeRow[] {
  return board
    .filter((r) => r.utilization >= 80 && r.feeBps < 150 && r.feeMom20 > 0)
    .sort((a, b) => b.utilization - a.utilization)
    .slice(0, 12);
}

/** High short interest + days-to-cover + accelerating fee + price up = squeeze risk. */
export function getSqueezeCandidates(board: SqueezeRow[] = getSqueezeBoard()): SqueezeRow[] {
  return board
    .filter((r) => r.shortInterestPct >= 12 && r.daysToCover >= 3 && r.feeMom5 > 0)
    .sort((a, b) => b.squeezeScore - a.squeezeScore)
    .slice(0, 12);
}

/** Names crossing toward special with a recall-risk flag. */
export function getSpecialsWatch(board: SqueezeRow[] = getSqueezeBoard()): SqueezeRow[] {
  return board
    .filter((r) => r.classification === "SPECIAL" || r.classification === "HTB")
    .sort((a, b) => b.feeBps - a.feeBps)
    .slice(0, 14);
}

export interface SectorHeat {
  sector: string;
  heat: number;
  count: number;
  avgUtil: number;
}
export function getSectorHeat(board: SqueezeRow[] = getSqueezeBoard()): SectorHeat[] {
  const m = new Map<string, { heat: number; util: number; n: number }>();
  for (const r of board) {
    const e = m.get(r.sector) ?? { heat: 0, util: 0, n: 0 };
    e.heat += r.heat;
    e.util += r.utilization;
    e.n += 1;
    m.set(r.sector, e);
  }
  return [...m.entries()]
    .map(([sector, e]) => ({ sector, heat: Math.round(e.heat / e.n), count: e.n, avgUtil: Math.round(e.util / e.n) }))
    .sort((a, b) => b.heat - a.heat);
}

export interface HeatAlert {
  ticker: string;
  trigger: string;
  detail: string;
  heat: number;
}
/** Threshold breaches that would stream into ALRT. */
export function getHeatAlerts(board: SqueezeRow[] = getSqueezeBoard()): HeatAlert[] {
  const out: HeatAlert[] = [];
  for (const r of board) {
    if (r.feeMom5 >= 18) out.push({ ticker: r.ticker, trigger: "Fee-momentum spike", detail: `borrow fee +${r.feeMom5}% in 5d → ${r.feeBps}bps`, heat: r.heat });
    else if (r.utilization >= 92 && r.feeMom20 > 0) out.push({ ticker: r.ticker, trigger: "Utilization > 92% & rising", detail: `util ${r.utilization}% · ${r.classification}`, heat: r.heat });
    else if (r.shortInterestPct >= 28) out.push({ ticker: r.ticker, trigger: "High short interest", detail: `SI ${r.shortInterestPct}% · ${r.daysToCover}d to cover`, heat: r.heat });
  }
  return out.sort((a, b) => b.heat - a.heat).slice(0, 16);
}

export interface SqueezeSummary {
  hottest: string;
  heatingCount: number;
  specials: number;
  avgUtil: number;
  topSqueeze: string;
  alerts: number;
}
export function getSqueezeSummary(board: SqueezeRow[] = getSqueezeBoard()): SqueezeSummary {
  const sq = getSqueezeCandidates(board);
  return {
    hottest: board[0]?.ticker ?? "—",
    heatingCount: board.filter((r) => r.direction === "HEATING").length,
    specials: board.filter((r) => r.classification === "SPECIAL" || r.classification === "HTB").length,
    avgUtil: Math.round(board.reduce((a, r) => a + r.utilization, 0) / Math.max(1, board.length)),
    topSqueeze: sq[0]?.ticker ?? "—",
    alerts: getHeatAlerts().length,
  };
}
