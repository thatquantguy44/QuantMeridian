/**
 * Spec012 SU-SIM — synthetic proof-of-concept book, scenarios, configurable
 * penalised transportation model, and independent verifier.
 *
 * The model is the classic balanced transportation problem:
 *   supply nodes (sources) ─ cᵢⱼ ─▶ demand nodes (uses)
 * balanced with a dummy supply node (unmet demand, priced at each use's
 * shortfall penalty) and a dummy demand node (idle capacity, priced at each
 * source's idle penalty). Every lane cost is a transparent sum of configurable
 * penalty components. Haircuts make it a generalised transport problem: a
 * nominal dollar from source i covers (1 − hᵢ) of use j.
 *
 * Everything here is SIM data: handwritten, deterministic, single-currency
 * (USD, $mm). It is a showcase of model behaviour, never a recommendation.
 */
import { certifyLp, solveLp, type LpProblem, type LpRow } from "@/lib/optimization/simplex";
import {
  SOURCES_USES_SCHEMA_VERSION,
  type ConfigurableSource, type ConfigurableUse, type SourcesUsesConfiguration,
} from "./sourcesUses";

export type SourceFamily = "internal" | "secured" | "unsecured";

export interface SimSource {
  id: string;
  label: string;
  short: string;
  family: SourceFamily;
  legalEntity: string;
  amount: number;
  costBps: number;
  haircutPct: number;
  /** Contractual / behavioural tenor of the funding, in days. */
  tenorDays: number;
  /** Cost of leaving a dollar of this source unused (negative carry, reserve lock-up). */
  idlePenaltyBps: number;
  /** Minimum draw before a penalty applies (program floor, balance commitment), $mm. */
  minDraw: number;
  minDrawPenaltyBps: number;
}

export interface SimUse {
  id: string;
  label: string;
  short: string;
  legalEntity: string;
  amount: number;
  tier: number;
  policy: "hard" | "soft";
  /** Shortfall penalty per $ of unmet coverage (soft uses only). */
  penaltyBps: number;
  /** Required funding tenor, in days. */
  tenorDays: number;
}

export interface SimLane {
  sourceId: string;
  useId: string;
  /** Pair-specific penalty (operational transfer, reuse restriction, wrong-way risk). */
  penaltyBps: number;
  note: string;
}

export interface SimProblem {
  sources: SimSource[];
  uses: SimUse[];
  lanes: SimLane[];
}

export const FAMILY_META: Record<SourceFamily, { label: string; color: string }> = {
  internal: { label: "Internal", color: "#3987e5" },
  secured: { label: "Secured repo", color: "#d95926" },
  unsecured: { label: "Unsecured & committed", color: "#199e70" },
};

export const TIER_LABELS: Record<number, string> = {
  1: "Tier 1 · Regulatory & CCP",
  2: "Tier 2 · Core franchise",
  3: "Tier 3 · Trading inventory",
  4: "Tier 4 · Opportunistic",
};

const QMS = "QM Securities LLC";
const QMP = "QM Prime Services";
const QMH = "QM Holdings Inc";

type SourceSeed = Omit<SimSource, "idlePenaltyBps" | "minDraw" | "minDrawPenaltyBps"> & Partial<SimSource>;
const src = (s: SourceSeed): SimSource => ({ idlePenaltyBps: 0, minDraw: 0, minDrawPenaltyBps: 0, ...s });

const BASE_SOURCES: SimSource[] = [
  src({ id: "S1", label: "Firm cash pool", short: "Cash pool", family: "internal", legalEntity: QMS, amount: 1400, costBps: 8, haircutPct: 0, tenorDays: 1, idlePenaltyBps: 5 }),
  src({ id: "S2", label: "Prime free credits", short: "Free credits", family: "internal", legalEntity: QMP, amount: 820, costBps: 18, haircutPct: 0, tenorDays: 1, idlePenaltyBps: 8 }),
  src({ id: "S3", label: "Sec-lending cash collateral", short: "SBL cash", family: "internal", legalEntity: QMS, amount: 640, costBps: 34, haircutPct: 1, tenorDays: 1, idlePenaltyBps: 10 }),
  src({ id: "S4", label: "Tri-party repo · UST", short: "TP repo UST", family: "secured", legalEntity: QMS, amount: 1700, costBps: 26, haircutPct: 2, tenorDays: 1, minDraw: 600, minDrawPenaltyBps: 15 }),
  src({ id: "S5", label: "Tri-party repo · Agency MBS", short: "TP repo MBS", family: "secured", legalEntity: QMS, amount: 900, costBps: 38, haircutPct: 5, tenorDays: 30 }),
  src({ id: "S6", label: "Bilateral repo · IG credit", short: "Bilat repo IG", family: "secured", legalEntity: QMS, amount: 620, costBps: 64, haircutPct: 8, tenorDays: 90 }),
  src({ id: "S7", label: "Commercial paper", short: "CP", family: "unsecured", legalEntity: QMH, amount: 850, costBps: 88, haircutPct: 0, tenorDays: 60, minDraw: 350, minDrawPenaltyBps: 25 }),
  src({ id: "S8", label: "Committed revolver", short: "Revolver", family: "unsecured", legalEntity: QMH, amount: 1000, costBps: 135, haircutPct: 0, tenorDays: 365 }),
];

const BASE_USES: SimUse[] = [
  { id: "U1", label: "CCP initial margin", short: "CCP IM", legalEntity: QMS, amount: 880, tier: 1, policy: "hard", penaltyBps: 0, tenorDays: 90 },
  { id: "U2", label: "Liquidity buffer top-up", short: "Liq buffer", legalEntity: QMS, amount: 520, tier: 1, policy: "hard", penaltyBps: 0, tenorDays: 365 },
  { id: "U3", label: "Intraday settlement buffer", short: "Intraday", legalEntity: QMS, amount: 300, tier: 1, policy: "hard", penaltyBps: 0, tenorDays: 1 },
  { id: "U4", label: "Govt & agency inventory", short: "Govt inv", legalEntity: QMS, amount: 1350, tier: 2, policy: "hard", penaltyBps: 0, tenorDays: 1 },
  { id: "U5", label: "Prime margin lending", short: "Prime margin", legalEntity: QMP, amount: 1050, tier: 2, policy: "soft", penaltyBps: 320, tenorDays: 30 },
  { id: "U6", label: "Equity inventory", short: "Equity inv", legalEntity: QMS, amount: 640, tier: 2, policy: "soft", penaltyBps: 260, tenorDays: 30 },
  { id: "U7", label: "Credit inventory", short: "Credit inv", legalEntity: QMS, amount: 520, tier: 3, policy: "soft", penaltyBps: 210, tenorDays: 90 },
  { id: "U8", label: "Securities borrow collateral", short: "Sec borrow", legalEntity: QMS, amount: 430, tier: 3, policy: "soft", penaltyBps: 180, tenorDays: 30 },
  { id: "U9", label: "Structured note hedges", short: "SN hedges", legalEntity: QMS, amount: 330, tier: 3, policy: "soft", penaltyBps: 150, tenorDays: 180 },
  { id: "U10", label: "Matched-book reverse repo", short: "Matched book", legalEntity: QMS, amount: 600, tier: 4, policy: "soft", penaltyBps: 45, tenorDays: 1 },
];

const lane = (sourceId: string, useId: string, penaltyBps: number, note: string): SimLane => ({ sourceId, useId, penaltyBps, note });

const BASE_LANES: SimLane[] = [
  ...["U1", "U2", "U3", "U4", "U5", "U6", "U7", "U8", "U9", "U10"].map((u) => lane("S1", u, 0, "Fungible firm cash")),
  lane("S2", "U5", 0, "Customer credits fund customer debits"),
  lane("S2", "U8", 4, "Reuse limited to customer short coverage"),
  lane("S3", "U5", 0, "Reinvestment into Prime"),
  lane("S3", "U6", 0, "Cash collateral reinvestment"),
  lane("S3", "U8", 0, "Recycled into borrows"),
  lane("S3", "U10", 8, "Reinvestment risk in matched book"),
  lane("S4", "U4", 0, "Collateral-matched financing"),
  lane("S4", "U10", 0, "Matched-book funding leg"),
  lane("S4", "U1", 3, "Cash posted after repo settlement"),
  lane("S4", "U3", 2, "Same-day settlement liquidity"),
  lane("S5", "U4", 0, "Collateral-matched financing"),
  lane("S5", "U10", 0, "Matched-book funding leg"),
  lane("S6", "U7", 0, "Collateral-matched financing"),
  lane("S6", "U9", 5, "Hedge collateral substitution"),
  ...["U2", "U6", "U7", "U9"].map((u) => lane("S7", u, 0, "Downstreamed from Holdings")),
  lane("S7", "U5", 6, "Two-hop downstream via Securities"),
  ...["U1", "U2", "U3", "U6", "U7", "U9"].map((u) => lane("S8", u, 0, "Downstreamed from Holdings")),
];

/** The base book. Returns a fresh deep copy each call; no randomness. */
export function baseProblem(): SimProblem {
  return {
    sources: BASE_SOURCES.map((s) => ({ ...s })),
    uses: BASE_USES.map((u) => ({ ...u })),
    lanes: BASE_LANES.map((l) => ({ ...l })),
  };
}

// ── Penalty configuration ───────────────────────────────────────────────────

export type PriorityMode = "lexicographic" | "weighted";

export interface PenaltyConfig {
  /**
   * lexicographic: tiers solved in order before economics (spec012 SU-004, default).
   * weighted: one penalised transport solve; shown for comparison only.
   */
  priorityMode: PriorityMode;
  /** Added to every lane whose source and use sit in different legal entities. */
  crossEntityBps: number;
  /** Per 30 days that the use's tenor exceeds the source's tenor (rollover risk). */
  tenorMismatchBpsPer30d: number;
  /** Charge on the haircut portion of nominal (encumbered over-collateral), bp × hᵢ. */
  haircutChargeBps: number;
  /** Convex concentration penalty on a single lane above a share of the use's demand. */
  concentration: { enabled: boolean; thresholdPct: number; penaltyBps: number };
  /** Price idle source capacity at each source's idle penalty (dummy demand node). */
  idleEnabled: boolean;
  /** Penalise draws below each source's minimum draw. */
  minDrawEnabled: boolean;
  /** Per-pair penalty overrides keyed by laneKey. */
  lanePenaltyOverrides: Record<string, number>;
  /** Per-use shortfall penalty overrides (soft uses). */
  shortfallOverrides: Record<string, number>;
  /** Per-source idle penalty overrides. */
  idleOverrides: Record<string, number>;
}

export const DEFAULT_PENALTIES: PenaltyConfig = {
  priorityMode: "lexicographic",
  crossEntityBps: 10,
  tenorMismatchBpsPer30d: 1.5,
  haircutChargeBps: 40,
  concentration: { enabled: true, thresholdPct: 70, penaltyBps: 12 },
  idleEnabled: true,
  minDrawEnabled: true,
  lanePenaltyOverrides: {},
  shortfallOverrides: {},
  idleOverrides: {},
};

export interface LaneCost {
  base: number;
  pair: number;
  crossEntity: number;
  tenor: number;
  haircut: number;
  /** Unit cost per nominal $ below the concentration threshold. */
  total: number;
}

export function laneCost(problem: SimProblem, config: PenaltyConfig, l: SimLane): LaneCost {
  const s = problem.sources.find((x) => x.id === l.sourceId)!;
  const u = problem.uses.find((x) => x.id === l.useId)!;
  const base = s.costBps;
  const pair = config.lanePenaltyOverrides[laneKey(l.sourceId, l.useId)] ?? l.penaltyBps;
  const crossEntity = s.legalEntity !== u.legalEntity ? config.crossEntityBps : 0;
  const tenor = config.tenorMismatchBpsPer30d * Math.max(0, u.tenorDays - s.tenorDays) / 30;
  const haircut = config.haircutChargeBps * s.haircutPct / 100;
  return { base, pair, crossEntity, tenor, haircut, total: base + pair + crossEntity + tenor + haircut };
}

export const shortfallPenalty = (config: PenaltyConfig, u: SimUse) => config.shortfallOverrides[u.id] ?? u.penaltyBps;
export const idlePenalty = (config: PenaltyConfig, s: SimSource) => (config.idleEnabled ? config.idleOverrides[s.id] ?? s.idlePenaltyBps : 0);
const minDrawActive = (config: PenaltyConfig, s: SimSource) => config.minDrawEnabled && s.minDraw > 0 && s.amount > 0;
/** Nominal a single lane may carry before the concentration penalty applies. */
export const concentrationCap = (config: PenaltyConfig, s: SimSource, u: SimUse) =>
  (config.concentration.thresholdPct / 100) * u.amount / Math.max(1e-9, 1 - s.haircutPct / 100);

// ── Stress controls & scenarios ─────────────────────────────────────────────

export interface StressKnobs {
  capacity: Record<SourceFamily, number>; // multiplier
  haircutShiftPp: number; // added to secured + sec-lending haircuts
  demandScale: number; // multiplier on all uses
  unsecuredCostShiftBps: number;
  deniedLanes: string[]; // "S1>U2"
}

export const NEUTRAL_KNOBS: StressKnobs = {
  capacity: { internal: 1, secured: 1, unsecured: 1 },
  haircutShiftPp: 0,
  demandScale: 1,
  unsecuredCostShiftBps: 0,
  deniedLanes: [],
};

export const laneKey = (sourceId: string, useId: string) => `${sourceId}>${useId}`;

export function applyKnobs(problem: SimProblem, knobs: StressKnobs): SimProblem {
  const denied = new Set(knobs.deniedLanes);
  return {
    sources: problem.sources.map((s) => ({
      ...s,
      amount: s.amount * knobs.capacity[s.family],
      haircutPct: s.family === "secured" || s.id === "S3" ? clamp(s.haircutPct + knobs.haircutShiftPp, 0, 95) : s.haircutPct,
      costBps: s.family === "unsecured" ? s.costBps + knobs.unsecuredCostShiftBps : s.costBps,
    })),
    uses: problem.uses.map((u) => ({ ...u, amount: u.amount * knobs.demandScale })),
    lanes: problem.lanes.filter((l) => !denied.has(laneKey(l.sourceId, l.useId))),
  };
}

export interface Scenario {
  id: string;
  title: string;
  kicker: string;
  narrative: string;
  build: () => SimProblem;
}

/** Scale the amount of the named sources and/or uses. */
const scale = (p: SimProblem, ids: string[], factor: number): SimProblem => ({
  ...p,
  sources: p.sources.map((s) => (ids.includes(s.id) ? { ...s, amount: s.amount * factor } : s)),
  uses: p.uses.map((u) => (ids.includes(u.id) ? { ...u, amount: u.amount * factor } : u)),
});

export const SCENARIOS: Scenario[] = [
  {
    id: "base",
    title: "Balanced book",
    kicker: "Base case",
    narrative: "A normal funding day. Internal cash and collateral-matched repo clear every obligation, term uses lean on term funding, and the committed revolver stays undrawn.",
    build: baseProblem,
  },
  {
    id: "repo-squeeze",
    title: "Repo market squeeze",
    kicker: "Liquidity",
    narrative: "Repo capacity falls 45%. Government inventory is a hard obligation, so it pulls firm cash away from lower tiers. The matched book is shed first, at its low shortfall penalty.",
    build: () => scale(baseProblem(), ["S4", "S5", "S6"], 0.55),
  },
  {
    id: "haircut-shock",
    title: "Haircut shock",
    kicker: "Collateral",
    narrative: "Secured haircuts widen by 8pp and sec-lending by 4pp. Each repo dollar now covers less and carries a larger haircut charge, so the model refinances the drag.",
    build: () => {
      const p = baseProblem();
      return { ...p, sources: p.sources.map((s) => ({ ...s, haircutPct: s.family === "secured" ? s.haircutPct + 8 : s.id === "S3" ? s.haircutPct + 4 : s.haircutPct })) };
    },
  },
  {
    id: "margin-surge",
    title: "Margin-call surge",
    kicker: "Priority",
    narrative: "CCP initial margin rises 2.6×. Tier 1 is solved first, so the call is met in full even though the revolver must be drawn. Lower tiers absorb the displacement.",
    build: () => scale(baseProblem(), ["U1"], 2.6),
  },
  {
    id: "rate-shock",
    title: "Unsecured rate shock",
    kicker: "Economics",
    narrative: "CP and revolver costs rise 150bp. With tiers locked, the allocation holds and only cost and shadow prices reprice. Switch to weighted priority to see the penalties shed demand and breach the CP floor instead.",
    build: () => {
      const p = baseProblem();
      return { ...p, sources: p.sources.map((s) => (s.family === "unsecured" ? { ...s, costBps: s.costBps + 150 } : s)) };
    },
  },
  {
    id: "cascade",
    title: "Funding cascade",
    kicker: "Infeasible",
    narrative: "The bank pulls the revolver, CP rolls only 20%, and initial margin jumps 2.5×. Hard obligations exceed every eligible dollar, so the elastic diagnostic names the gap instead of inventing a plan.",
    build: () => scale(scale(scale(baseProblem(), ["S8"], 0), ["S7"], 0.2), ["U1"], 2.5),
  },
];

// ── Model ───────────────────────────────────────────────────────────────────

export interface FlowResult {
  sourceId: string;
  useId: string;
  nominal: number;
  coverage: number;
  /** Nominal above the concentration threshold (carries the concentration penalty). */
  excess: number;
  cost: LaneCost;
  /** Reduced cost of the below-threshold segment (0 when basic). */
  reducedCostBps: number;
}

export interface TierStage {
  tier: number;
  weightedShortfall: number; // bps·$mm
  shortfall: number; // $mm coverage
  softUses: number;
}

export interface SolveStats {
  variables: number;
  rows: number;
  stages: number;
  pivots: number;
  millis: number;
}

export interface CostBreakdown {
  funding: number;
  pair: number;
  crossEntity: number;
  tenor: number;
  haircut: number;
  concentration: number;
  idle: number;
  minDraw: number;
  shortfall: number;
}

export interface FeasibleResult {
  status: "optimal";
  problem: SimProblem;
  config: PenaltyConfig;
  flows: FlowResult[];
  shortfall: Record<string, number>;
  idle: Record<string, number>;
  minDrawGap: Record<string, number>;
  sourceUsed: Record<string, number>;
  /** Objective change per extra $ of capacity (bp). Negative when idle capacity is penalised. */
  capacityDualBps: Record<string, number>;
  useDualBps: Record<string, number>;
  stages: TierStage[];
  /** Annual $mm per component (bps·$mm / 10,000). */
  breakdown: CostBreakdown;
  objectiveBpsMm: number;
  totals: Totals;
  stats: SolveStats;
  /** The exact final-stage LP and its primal/dual solution, for certification. */
  lp: { problem: LpProblem; x: number[]; duals: number[] };
}

export interface InfeasibleResult {
  status: "infeasible";
  problem: SimProblem;
  config: PenaltyConfig;
  shortUses: { useId: string; gap: number }[];
  exhaustedSources: string[];
  totalGap: number;
  stats: SolveStats;
}

export type SimResult = FeasibleResult | InfeasibleResult;

export interface Totals {
  demand: number;
  nominal: number;
  coverage: number;
  haircutDrag: number;
  shortfall: number;
  idle: number;
  fundingCostMm: number;
  penaltyCostMm: number;
  totalCostMm: number;
  weightedCostBps: number;
  coveragePct: number;
  bindingSources: number;
  byFamily: Record<SourceFamily, number>;
}

const TIER_TOL_ABS = 1e-7;
const TIER_TOL_REL = 1e-9;

interface Layout {
  lanes: SimLane[];
  costs: LaneCost[];
  /** Column of the below-threshold segment of lane k. */
  x1: number[];
  /** Column of the above-threshold segment of lane k (−1 when concentration is off). */
  x2: number[];
  s: Map<string, number>;
  u: Map<string, number>;
  m: Map<string, number>;
  n: number;
  cost: number[];
  shortWeight: Map<string, number>;
}

function layout(problem: SimProblem, config: PenaltyConfig): Layout {
  const sourceIds = new Set(problem.sources.map((s) => s.id));
  const useIds = new Set(problem.uses.map((u) => u.id));
  const lanes = problem.lanes.filter((l) => sourceIds.has(l.sourceId) && useIds.has(l.useId));
  const costs = lanes.map((l) => laneCost(problem, config, l));
  const cost: number[] = [];
  const x1: number[] = [];
  const x2: number[] = [];
  lanes.forEach((_, k) => {
    x1.push(cost.length); cost.push(costs[k].total);
    if (config.concentration.enabled) { x2.push(cost.length); cost.push(costs[k].total + config.concentration.penaltyBps); }
    else x2.push(-1);
  });
  const s = new Map<string, number>();
  const shortWeight = new Map<string, number>();
  problem.uses.filter((u) => u.policy === "soft").forEach((u) => {
    s.set(u.id, cost.length); cost.push(shortfallPenalty(config, u)); shortWeight.set(u.id, shortfallPenalty(config, u));
  });
  const u = new Map<string, number>();
  problem.sources.forEach((source) => { u.set(source.id, cost.length); cost.push(idlePenalty(config, source)); });
  const m = new Map<string, number>();
  problem.sources.filter((source) => minDrawActive(config, source)).forEach((source) => { m.set(source.id, cost.length); cost.push(source.minDrawPenaltyBps); });
  return { lanes, costs, x1, x2, s, u, m, n: cost.length, cost, shortWeight };
}

function laneColumns(lay: Layout, k: number): number[] {
  return lay.x2[k] >= 0 ? [lay.x1[k], lay.x2[k]] : [lay.x1[k]];
}

/** Balanced transport rows: supply (with dummy idle sink), demand (with dummy shortfall source). */
function baseRows(problem: SimProblem, config: PenaltyConfig, lay: Layout, hardSlack?: Map<string, number>): LpRow[] {
  const rows: LpRow[] = [];
  problem.sources.forEach((s) => {
    const coeffs: [number, number][] = [];
    lay.lanes.forEach((l, k) => { if (l.sourceId === s.id) laneColumns(lay, k).forEach((c) => coeffs.push([c, 1])); });
    coeffs.push([lay.u.get(s.id)!, 1]);
    rows.push({ name: `supply:${s.id}`, sense: "=", rhs: Math.max(0, s.amount), coeffs });
  });
  problem.uses.forEach((u) => {
    const coeffs: [number, number][] = [];
    lay.lanes.forEach((l, k) => {
      if (l.useId !== u.id) return;
      const h = problem.sources.find((s) => s.id === l.sourceId)!.haircutPct / 100;
      laneColumns(lay, k).forEach((c) => coeffs.push([c, 1 - h]));
    });
    const sc = lay.s.get(u.id);
    if (sc !== undefined) coeffs.push([sc, 1]);
    const e = hardSlack?.get(u.id);
    if (e !== undefined) coeffs.push([e, 1]);
    rows.push({ name: `demand:${u.id}`, sense: "=", rhs: u.amount, coeffs });
  });
  if (config.concentration.enabled) {
    lay.lanes.forEach((l, k) => {
      const s = problem.sources.find((x) => x.id === l.sourceId)!;
      const u = problem.uses.find((x) => x.id === l.useId)!;
      rows.push({ name: `conc:${laneKey(l.sourceId, l.useId)}`, sense: "<=", rhs: concentrationCap(config, s, u), coeffs: [[lay.x1[k], 1]] });
    });
  }
  problem.sources.forEach((s) => {
    const mc = lay.m.get(s.id);
    if (mc === undefined) return;
    const coeffs: [number, number][] = [];
    lay.lanes.forEach((l, k) => { if (l.sourceId === s.id) laneColumns(lay, k).forEach((c) => coeffs.push([c, 1])); });
    coeffs.push([mc, 1]);
    rows.push({ name: `mindraw:${s.id}`, sense: ">=", rhs: Math.min(s.minDraw, s.amount), coeffs });
  });
  return rows;
}

export function solveSim(problem: SimProblem, config: PenaltyConfig = DEFAULT_PENALTIES): SimResult {
  const started = now();
  const lay = layout(problem, config);
  const rows = baseRows(problem, config, lay);
  const stages: TierStage[] = [];
  let pivots = 0;

  if (config.priorityMode === "lexicographic") {
    const tiers = [...new Set(problem.uses.map((u) => u.tier))].sort((a, b) => a - b);
    for (const tier of tiers) {
      const tierSoft = problem.uses.filter((u) => u.tier === tier && u.policy === "soft");
      if (!tierSoft.length) continue;
      const cost = new Array<number>(lay.n).fill(0);
      const coeffs: [number, number][] = tierSoft.map((u) => [lay.s.get(u.id)!, lay.shortWeight.get(u.id)!]);
      for (const [col, v] of coeffs) cost[col] = v;
      const stage = solveLp({ cost, rows });
      pivots += stage.pivots;
      if (stage.status !== "optimal") return diagnose(problem, config, lay, started, pivots);
      rows.push({ name: `tier:${tier}`, sense: "<=", rhs: stage.objective + Math.max(TIER_TOL_ABS, Math.abs(stage.objective) * TIER_TOL_REL), coeffs });
      stages.push({
        tier,
        weightedShortfall: stage.objective,
        shortfall: tierSoft.reduce((sum, u) => sum + stage.x[lay.s.get(u.id)!], 0),
        softUses: tierSoft.length,
      });
    }
  }

  const finalLp: LpProblem = { cost: lay.cost, rows };
  const final = solveLp(finalLp);
  pivots += final.pivots;
  if (final.status !== "optimal") return diagnose(problem, config, lay, started, pivots);
  const x = final.x;

  const rowIndex = new Map(rows.map((r, i) => [r.name, i]));
  const dual = (name: string) => clean(final.duals[rowIndex.get(name) ?? -1] ?? 0);
  const capacityDualBps: Record<string, number> = {};
  const useDualBps: Record<string, number> = {};
  problem.sources.forEach((s) => { capacityDualBps[s.id] = clean(-dual(`supply:${s.id}`)); });
  problem.uses.forEach((u) => { useDualBps[u.id] = dual(`demand:${u.id}`); });

  const flows: FlowResult[] = lay.lanes.map((l, k) => {
    const s = problem.sources.find((v) => v.id === l.sourceId)!;
    const h = s.haircutPct / 100;
    const a = clean(x[lay.x1[k]]);
    const b = lay.x2[k] >= 0 ? clean(x[lay.x2[k]]) : 0;
    const concDual = config.concentration.enabled ? -dual(`conc:${laneKey(l.sourceId, l.useId)}`) : 0;
    const minDual = lay.m.has(s.id) ? dual(`mindraw:${s.id}`) : 0;
    const reduced = lay.costs[k].total + capacityDualBps[s.id] - minDual - (1 - h) * useDualBps[l.useId] + concDual;
    return { sourceId: l.sourceId, useId: l.useId, nominal: a + b, coverage: (a + b) * (1 - h), excess: b, cost: lay.costs[k], reducedCostBps: clean(reduced) };
  });

  const shortfall: Record<string, number> = {};
  problem.uses.forEach((u) => { const c = lay.s.get(u.id); shortfall[u.id] = c === undefined ? 0 : clean(x[c]); });
  const idle: Record<string, number> = {};
  const minDrawGap: Record<string, number> = {};
  problem.sources.forEach((s) => {
    idle[s.id] = clean(x[lay.u.get(s.id)!]);
    const mc = lay.m.get(s.id);
    minDrawGap[s.id] = mc === undefined ? 0 : clean(x[mc]);
  });
  const sourceUsed: Record<string, number> = {};
  problem.sources.forEach((s) => { sourceUsed[s.id] = flows.filter((f) => f.sourceId === s.id).reduce((a, f) => a + f.nominal, 0); });

  const breakdown = computeBreakdown(problem, config, flows, shortfall, idle, minDrawGap);
  return {
    status: "optimal",
    problem,
    config,
    flows,
    shortfall,
    idle,
    minDrawGap,
    sourceUsed,
    capacityDualBps,
    useDualBps,
    stages,
    breakdown,
    objectiveBpsMm: final.objective,
    totals: computeTotals(problem, flows, shortfall, idle, sourceUsed, breakdown),
    stats: { variables: lay.n, rows: rows.length, stages: stages.length + 1, pivots, millis: now() - started },
    lp: { problem: finalLp, x, duals: final.duals },
  };
}

function diagnose(problem: SimProblem, config: PenaltyConfig, lay: Layout, started: number, pivotsSoFar: number): InfeasibleResult {
  const hard = problem.uses.filter((u) => u.policy === "hard");
  const eIndex = new Map(hard.map((u, k) => [u.id, lay.n + k]));
  const rows = baseRows(problem, config, lay, eIndex);
  const cost = new Array<number>(lay.n + hard.length).fill(0);
  for (const idx of eIndex.values()) cost[idx] = 1;
  const elastic = solveLp({ cost, rows });
  const pivots = pivotsSoFar + elastic.pivots;
  const shortUses = hard
    .map((u) => ({ useId: u.id, gap: clean(elastic.x[eIndex.get(u.id)!] ?? 0) }))
    .filter((item) => item.gap > 1e-6)
    .sort((a, b) => b.gap - a.gap);
  // Supply rows come first; a negative equality dual means more capacity would shrink the gap.
  const exhaustedSources = problem.sources.filter((s, i) => s.amount > 0 && elastic.duals[i] < -1e-9).map((s) => s.id);
  return {
    status: "infeasible",
    problem,
    config,
    shortUses,
    exhaustedSources,
    totalGap: shortUses.reduce((a, u) => a + u.gap, 0),
    stats: { variables: cost.length, rows: rows.length, stages: 1, pivots, millis: now() - started },
  };
}

function computeBreakdown(
  problem: SimProblem, config: PenaltyConfig, flows: FlowResult[],
  shortfall: Record<string, number>, idle: Record<string, number>, minDrawGap: Record<string, number>,
): CostBreakdown {
  const sum = (f: (fl: FlowResult) => number) => flows.reduce((a, fl) => a + f(fl), 0) / 10_000;
  return {
    funding: sum((f) => f.cost.base * f.nominal),
    pair: sum((f) => f.cost.pair * f.nominal),
    crossEntity: sum((f) => f.cost.crossEntity * f.nominal),
    tenor: sum((f) => f.cost.tenor * f.nominal),
    haircut: sum((f) => f.cost.haircut * f.nominal),
    concentration: config.concentration.enabled ? sum((f) => config.concentration.penaltyBps * f.excess) : 0,
    idle: problem.sources.reduce((a, s) => a + idlePenalty(config, s) * idle[s.id], 0) / 10_000,
    minDraw: problem.sources.reduce((a, s) => a + (minDrawActive(config, s) ? s.minDrawPenaltyBps * minDrawGap[s.id] : 0), 0) / 10_000,
    shortfall: problem.uses.reduce((a, u) => a + (u.policy === "soft" ? shortfallPenalty(config, u) * shortfall[u.id] : 0), 0) / 10_000,
  };
}

function computeTotals(
  problem: SimProblem, flows: FlowResult[], shortfall: Record<string, number>, idle: Record<string, number>,
  used: Record<string, number>, breakdown: CostBreakdown,
): Totals {
  const demand = problem.uses.reduce((a, u) => a + u.amount, 0);
  const nominal = flows.reduce((a, f) => a + f.nominal, 0);
  const coverage = flows.reduce((a, f) => a + f.coverage, 0);
  const totalShort = Object.values(shortfall).reduce((a, v) => a + v, 0);
  const byFamily: Record<SourceFamily, number> = { internal: 0, secured: 0, unsecured: 0 };
  problem.sources.forEach((s) => { byFamily[s.family] += used[s.id]; });
  const totalCostMm = Object.values(breakdown).reduce((a, v) => a + v, 0);
  return {
    demand,
    nominal,
    coverage,
    haircutDrag: nominal - coverage,
    shortfall: totalShort,
    idle: Object.values(idle).reduce((a, v) => a + v, 0),
    fundingCostMm: breakdown.funding,
    penaltyCostMm: totalCostMm - breakdown.funding,
    totalCostMm,
    weightedCostBps: nominal > 0 ? (breakdown.funding * 10_000) / nominal : 0,
    coveragePct: demand > 0 ? coverage / demand : 1,
    bindingSources: problem.sources.filter((s) => s.amount > 0 && s.amount - used[s.id] < 1e-6 * Math.max(1, s.amount)).length,
    byFamily,
  };
}

// ── Independent verifier ────────────────────────────────────────────────────

export interface VerificationCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

/**
 * Business checks are recomputed from problem data and the reported flows.
 * Optimality is certified on the exact final-stage LP (tier rows fixed) with
 * a generic primal/dual certificate that does not use solver internals.
 */
export function verifySim(result: FeasibleResult): VerificationCheck[] {
  const { problem, config, flows, shortfall } = result;
  const tol = (ref: number) => 1e-6 * Math.max(1, Math.abs(ref));
  const laneSet = new Map(problem.lanes.map((l) => [laneKey(l.sourceId, l.useId), l]));
  const source = new Map(problem.sources.map((s) => [s.id, s]));
  const checks: VerificationCheck[] = [];
  const push = (id: string, label: string, failures: string[], ok: string) =>
    checks.push({ id, label, passed: failures.length === 0, detail: failures.length ? failures.slice(0, 3).join("; ") : ok });

  push("nonneg", "Non-negative flows", flows.filter((f) => f.nominal < -1e-9 || f.excess < -1e-9).map((f) => `${f.sourceId}→${f.useId} = ${f.nominal}`), `${flows.length} lane flows ≥ 0`);

  push("lanes", "Only allowed lanes carry flow", flows.filter((f) => !laneSet.has(laneKey(f.sourceId, f.useId)) && Math.abs(f.nominal) > 1e-9)
    .map((f) => `${f.sourceId}→${f.useId} not allowed`), `${problem.lanes.length} allowed lanes; all others denied`);

  const capFail: string[] = [];
  problem.sources.forEach((s) => {
    const used = flows.filter((f) => f.sourceId === s.id).reduce((a, f) => a + f.nominal, 0);
    if (used > s.amount + tol(s.amount)) capFail.push(`${s.id} uses ${used.toFixed(4)} of ${s.amount.toFixed(4)}`);
    if (Math.abs(used + result.idle[s.id] - Math.max(0, s.amount)) > tol(s.amount)) capFail.push(`${s.id}: used + idle ≠ capacity`);
  });
  push("capacity", "Supply balances (Σx + idle = A)", capFail, `${problem.sources.length} supply rows balance`);

  const covFail: string[] = [];
  const hardFail: string[] = [];
  problem.uses.forEach((u) => {
    const covered = flows.filter((f) => f.useId === u.id).reduce((a, f) => a + f.nominal * (1 - source.get(f.sourceId)!.haircutPct / 100), 0);
    const s = shortfall[u.id] ?? 0;
    if (Math.abs(covered + s - u.amount) > tol(u.amount)) covFail.push(`${u.id}: ${covered.toFixed(4)} + ${s.toFixed(4)} ≠ ${u.amount.toFixed(4)}`);
    if (u.policy === "hard" && s > tol(u.amount)) hardFail.push(`${u.id} short ${s.toFixed(4)}`);
  });
  push("coverage", "Demand balances (Σ(1−h)x + s = D)", covFail, `${problem.uses.length} uses reconcile after haircuts`);
  push("hard", "Hard uses fully covered", hardFail, `${problem.uses.filter((u) => u.policy === "hard").length} hard uses at 100%`);

  const concFail: string[] = [];
  if (config.concentration.enabled) {
    flows.forEach((f) => {
      const cap = concentrationCap(config, source.get(f.sourceId)!, problem.uses.find((u) => u.id === f.useId)!);
      if (f.excess > 1e-6 && f.nominal - f.excess < cap - tol(cap)) concFail.push(`${f.sourceId}→${f.useId} penalised below threshold`);
    });
  }
  push("conc", "Concentration penalty only above threshold", concFail, config.concentration.enabled ? `threshold ${config.concentration.thresholdPct}% of demand per lane` : "concentration penalty off");

  // Objective recomputed from configuration, independent of the solver's cost vector.
  const objective = flows.reduce((a, f) => {
    const c = laneCost(problem, config, laneSet.get(laneKey(f.sourceId, f.useId))!);
    return a + c.total * f.nominal + (config.concentration.enabled ? config.concentration.penaltyBps * f.excess : 0);
  }, 0)
    + problem.uses.reduce((a, u) => a + (u.policy === "soft" ? shortfallPenalty(config, u) * (shortfall[u.id] ?? 0) : 0), 0)
    + problem.sources.reduce((a, s) => a + idlePenalty(config, s) * result.idle[s.id] + (minDrawActive(config, s) ? s.minDrawPenaltyBps * result.minDrawGap[s.id] : 0), 0);
  push("objective", "Objective recomputes from penalties", Math.abs(objective - result.objectiveBpsMm) > tol(objective)
    ? [`recomputed ${objective.toFixed(4)} vs reported ${result.objectiveBpsMm.toFixed(4)}`] : [], `${(objective / 10_000).toFixed(3)} $mm/yr incl. penalties`);

  const cert = certifyLp(result.lp.problem, result.lp.x, result.lp.duals);
  const scale = Math.max(1, Math.abs(cert.primalObjective));
  push("primal", "LP primal feasibility", cert.primalViolation > 1e-6 * scale ? [`max violation ${cert.primalViolation.toExponential(2)}`] : [], `${result.lp.problem.rows.length} rows hold`);
  push("dual", "Dual feasibility (reduced costs ≥ 0)", cert.dualViolation > 1e-6 ? [`max violation ${cert.dualViolation.toExponential(2)}`] : [], `${result.lp.problem.cost.length} columns priced out`);
  push("cs", "Complementary slackness", cert.complementarity > 1e-5 * scale ? [`max product ${cert.complementarity.toExponential(2)}`] : [], "Basic columns price to zero; slack rows are free");
  const gap = Math.abs(cert.primalObjective - cert.dualObjective);
  push("gap", "Strong duality (gap = 0)", gap > 1e-6 * scale ? [`primal ${cert.primalObjective.toFixed(4)} vs dual ${cert.dualObjective.toFixed(4)}`] : [], `gap ${gap.toExponential(1)} bps·$mm`);
  push("bind", "Certificate matches reported flows", Math.abs(cert.primalObjective - objective) > tol(objective) ? ["LP solution differs from reported flows"] : [], "LP primal equals reported allocation");

  return checks;
}

// ── Workspace bridge (SIM-008) ──────────────────────────────────────────────

export function toWorkspaceConfiguration(problem: SimProblem, name: string, id: string, config: PenaltyConfig = DEFAULT_PENALTIES): SourcesUsesConfiguration {
  const allowed = new Map(problem.lanes.map((l) => [laneKey(l.sourceId, l.useId), l]));
  const sources: ConfigurableSource[] = problem.sources.map((s) => ({
    id: s.id, label: s.label, category: FAMILY_META[s.family].label, amount: round(s.amount, 6), costBps: s.costBps,
    currency: "USD", legalEntity: s.legalEntity, assetClass: s.family === "secured" ? "Secured funding" : "Cash", tenorDays: s.tenorDays,
    priorityTier: 1, minimum: s.minDraw > 0 ? s.minDraw : null, maximum: null, lotSize: null, haircutPct: s.haircutPct,
    internality: s.family === "internal" ? "internal" : "external", tags: ["SIM"], provenance: "sim",
  }));
  const uses: ConfigurableUse[] = problem.uses.map((u) => ({
    id: u.id, label: u.label, category: TIER_LABELS[u.tier] ?? `Tier ${u.tier}`, amount: round(u.amount, 6), bidBps: 0,
    currency: "USD", legalEntity: u.legalEntity, assetClass: "Funding need", tenorDays: u.tenorDays, priorityTier: u.tier,
    minimum: null, maximum: null, lotSize: null, policy: u.policy, shortfallPenaltyBps: shortfallPenalty(config, u), tags: ["SIM"], provenance: "sim",
  }));
  const compatibility = problem.sources.flatMap((s) => problem.uses.map((u) => {
    const l = allowed.get(laneKey(s.id, u.id));
    const pair = l ? config.lanePenaltyOverrides[laneKey(s.id, u.id)] ?? l.penaltyBps : 0;
    return { sourceId: s.id, useId: u.id, status: l ? "allowed" as const : "denied" as const, note: l ? `${l.note} · pair penalty ${pair}bp` : "Not eligible in SIM book", provenance: "sim" as const };
  }));
  return {
    schemaVersion: SOURCES_USES_SCHEMA_VERSION,
    id,
    name,
    description: "SIM — synthetic proof-of-concept book (spec012 SU-SIM). Not production data.",
    updatedAt: new Date().toISOString(),
    sources, uses, compatibility,
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function clean(v: number): number { return Math.abs(v) < 1e-9 ? 0 : v; }
function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
function round(v: number, dp: number): number { const f = 10 ** dp; return Math.round(v * f) / f; }
function now(): number { return typeof performance !== "undefined" ? performance.now() : Date.now(); }
