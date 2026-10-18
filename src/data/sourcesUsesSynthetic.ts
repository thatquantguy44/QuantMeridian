/**
 * Spec012 SU-SIM — synthetic proof-of-concept book, scenarios, lexicographic
 * transport model, and independent verifier.
 *
 * Everything here is SIM data: handwritten, deterministic, single-currency
 * (USD, $mm). It is a showcase of model behaviour, never a recommendation.
 */
import { solveLp, type LpRow } from "@/lib/optimization/simplex";
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
}

export interface SimUse {
  id: string;
  label: string;
  short: string;
  legalEntity: string;
  amount: number;
  tier: number;
  policy: "hard" | "soft";
  penaltyBps: number;
}

export interface SimLane {
  sourceId: string;
  useId: string;
  frictionBps: number;
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

const BASE_SOURCES: SimSource[] = [
  { id: "S1", label: "Firm cash pool", short: "Cash pool", family: "internal", legalEntity: QMS, amount: 1400, costBps: 8, haircutPct: 0 },
  { id: "S2", label: "Prime free credits", short: "Free credits", family: "internal", legalEntity: QMP, amount: 820, costBps: 18, haircutPct: 0 },
  { id: "S3", label: "Sec-lending cash collateral", short: "SBL cash", family: "internal", legalEntity: QMS, amount: 640, costBps: 34, haircutPct: 1 },
  { id: "S4", label: "Tri-party repo · UST", short: "TP repo UST", family: "secured", legalEntity: QMS, amount: 1700, costBps: 26, haircutPct: 2 },
  { id: "S5", label: "Tri-party repo · Agency MBS", short: "TP repo MBS", family: "secured", legalEntity: QMS, amount: 900, costBps: 38, haircutPct: 5 },
  { id: "S6", label: "Bilateral repo · IG credit", short: "Bilat repo IG", family: "secured", legalEntity: QMS, amount: 620, costBps: 64, haircutPct: 8 },
  { id: "S7", label: "Commercial paper", short: "CP", family: "unsecured", legalEntity: QMH, amount: 850, costBps: 88, haircutPct: 0 },
  { id: "S8", label: "Committed revolver", short: "Revolver", family: "unsecured", legalEntity: QMH, amount: 1000, costBps: 135, haircutPct: 0 },
];

const BASE_USES: SimUse[] = [
  { id: "U1", label: "CCP initial margin", short: "CCP IM", legalEntity: QMS, amount: 880, tier: 1, policy: "hard", penaltyBps: 0 },
  { id: "U2", label: "Liquidity buffer top-up", short: "Liq buffer", legalEntity: QMS, amount: 520, tier: 1, policy: "hard", penaltyBps: 0 },
  { id: "U3", label: "Intraday settlement buffer", short: "Intraday", legalEntity: QMS, amount: 300, tier: 1, policy: "hard", penaltyBps: 0 },
  { id: "U4", label: "Govt & agency inventory", short: "Govt inv", legalEntity: QMS, amount: 1350, tier: 2, policy: "hard", penaltyBps: 0 },
  { id: "U5", label: "Prime margin lending", short: "Prime margin", legalEntity: QMP, amount: 1050, tier: 2, policy: "soft", penaltyBps: 320 },
  { id: "U6", label: "Equity inventory", short: "Equity inv", legalEntity: QMS, amount: 640, tier: 2, policy: "soft", penaltyBps: 260 },
  { id: "U7", label: "Credit inventory", short: "Credit inv", legalEntity: QMS, amount: 520, tier: 3, policy: "soft", penaltyBps: 210 },
  { id: "U8", label: "Securities borrow collateral", short: "Sec borrow", legalEntity: QMS, amount: 430, tier: 3, policy: "soft", penaltyBps: 180 },
  { id: "U9", label: "Structured note hedges", short: "SN hedges", legalEntity: QMS, amount: 330, tier: 3, policy: "soft", penaltyBps: 150 },
  { id: "U10", label: "Matched-book reverse repo", short: "Matched book", legalEntity: QMS, amount: 600, tier: 4, policy: "soft", penaltyBps: 45 },
];

const lane = (sourceId: string, useId: string, frictionBps: number, note: string): SimLane => ({ sourceId, useId, frictionBps, note });

const BASE_LANES: SimLane[] = [
  ...["U1", "U2", "U3", "U4", "U6", "U7", "U8", "U9", "U10"].map((u) => lane("S1", u, 0, "Fungible firm cash")),
  lane("S1", "U5", 6, "Intercompany transfer to Prime"),
  lane("S2", "U5", 0, "Customer credits fund customer debits"),
  lane("S2", "U8", 4, "Reuse limited to customer short coverage"),
  lane("S3", "U5", 6, "Reinvestment into Prime via intercompany"),
  lane("S3", "U6", 0, "Cash collateral reinvestment"),
  lane("S3", "U8", 0, "Recycled into borrows"),
  lane("S3", "U10", 0, "Reinvested in matched book"),
  lane("S4", "U4", 0, "Collateral-matched financing"),
  lane("S4", "U10", 0, "Matched-book funding leg"),
  lane("S4", "U1", 3, "Cash posted after repo settlement"),
  lane("S4", "U3", 2, "Same-day settlement liquidity"),
  lane("S5", "U4", 0, "Collateral-matched financing"),
  lane("S5", "U10", 0, "Matched-book funding leg"),
  lane("S6", "U7", 0, "Collateral-matched financing"),
  lane("S6", "U9", 5, "Hedge collateral substitution"),
  ...["U2", "U6", "U7", "U9"].map((u) => lane("S7", u, 12, "Downstreamed from Holdings")),
  lane("S7", "U5", 18, "Downstreamed from Holdings to Prime"),
  ...["U1", "U2", "U3", "U6", "U7", "U9"].map((u) => lane("S8", u, 12, "Downstreamed from Holdings")),
];

/** The base book. Returns a fresh deep copy each call; no randomness. */
export function baseProblem(): SimProblem {
  return {
    sources: BASE_SOURCES.map((s) => ({ ...s })),
    uses: BASE_USES.map((u) => ({ ...u })),
    lanes: BASE_LANES.map((l) => ({ ...l })),
  };
}

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
    narrative: "A normal funding day. Internal cash and collateral-matched repo clear every obligation. CP covers the remainder and the committed revolver stays undrawn.",
    build: baseProblem,
  },
  {
    id: "repo-squeeze",
    title: "Repo market squeeze",
    kicker: "Liquidity",
    narrative: "Tri-party and bilateral repo capacity falls 45%. Government inventory is a hard obligation, so it pulls firm cash away from lower tiers, and the matched book is shed first.",
    build: () => scale(baseProblem(), ["S4", "S5", "S6"], 0.55),
  },
  {
    id: "haircut-shock",
    title: "Haircut shock",
    kicker: "Collateral",
    narrative: "Secured haircuts widen by 8pp and sec-lending by 4pp. Every nominal dollar of repo now buys less coverage. The gap is the haircut drag that the model must refinance.",
    build: () => {
      const p = baseProblem();
      return { ...p, sources: p.sources.map((s) => ({ ...s, haircutPct: s.family === "secured" ? s.haircutPct + 8 : s.id === "S3" ? s.haircutPct + 4 : s.haircutPct })) };
    },
  },
  {
    id: "margin-surge",
    title: "Margin-call surge",
    kicker: "Priority",
    narrative: "CCP initial margin rises 2.6×. Tier 1 is solved first, so the call is met in full even though the expensive revolver must be drawn. Lower tiers absorb the displacement.",
    build: () => scale(baseProblem(), ["U1"], 2.6),
  },
  {
    id: "rate-shock",
    title: "Unsecured rate shock",
    kicker: "Economics",
    narrative: "CP and revolver costs rise 150bp. Tier outcomes are locked and the allocation does not move. Total carry and every shadow price reprice, which shows the cost of staying whole.",
    build: () => {
      const p = baseProblem();
      return { ...p, sources: p.sources.map((s) => (s.family === "unsecured" ? { ...s, costBps: s.costBps + 150 } : s)) };
    },
  },
  {
    id: "cascade",
    title: "Funding cascade",
    kicker: "Infeasible",
    narrative: "The bank pulls the revolver, CP rolls only 20%, and initial margin jumps 2.5×. Hard obligations exceed every eligible dollar. The elastic diagnostic names the gap instead of inventing a plan.",
    build: () => scale(scale(scale(baseProblem(), ["S8"], 0), ["S7"], 0.2), ["U1"], 2.5),
  },
];

// ── Model ───────────────────────────────────────────────────────────────────

export interface FlowResult {
  sourceId: string;
  useId: string;
  nominal: number;
  coverage: number;
  unitCostBps: number;
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

export interface FeasibleResult {
  status: "optimal";
  problem: SimProblem;
  flows: FlowResult[];
  shortfall: Record<string, number>;
  sourceUsed: Record<string, number>;
  capacityDualBps: Record<string, number>; // ≥ 0: saving per extra $ capacity
  useDualBps: Record<string, number>; // marginal cost per extra $ coverage
  tierDuals: Record<number, number>; // ≤ 0 multipliers on fixed tier rows
  tierBounds: Record<number, number>;
  shortfallReducedBps: Record<string, number>;
  stages: TierStage[];
  objectiveBpsMm: number;
  totals: Totals;
  stats: SolveStats;
}

export interface InfeasibleResult {
  status: "infeasible";
  problem: SimProblem;
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
  annualCostMm: number;
  weightedCostBps: number;
  coveragePct: number;
  bindingSources: number;
  byFamily: Record<SourceFamily, number>;
}

const TIER_TOL_ABS = 1e-7;
const TIER_TOL_REL = 1e-9;

interface Layout {
  lanes: SimLane[];
  softUses: SimUse[];
  nX: number;
  n: number;
  sIndex: Map<string, number>;
  unitCost: number[];
}

function layout(problem: SimProblem): Layout {
  const sourceIds = new Set(problem.sources.map((s) => s.id));
  const useIds = new Set(problem.uses.map((u) => u.id));
  const lanes = problem.lanes.filter((l) => sourceIds.has(l.sourceId) && useIds.has(l.useId));
  const softUses = problem.uses.filter((u) => u.policy === "soft");
  const nX = lanes.length;
  const sIndex = new Map(softUses.map((u, k) => [u.id, nX + k]));
  const source = (id: string) => problem.sources.find((s) => s.id === id)!;
  const unitCost = [
    ...lanes.map((l) => source(l.sourceId).costBps + l.frictionBps),
    ...softUses.map((u) => u.penaltyBps),
  ];
  return { lanes, softUses, nX, n: nX + softUses.length, sIndex, unitCost };
}

function baseRows(problem: SimProblem, lay: Layout, extraHardSlack?: Map<string, number>): LpRow[] {
  const caps: LpRow[] = problem.sources.map((s) => ({
    name: `cap:${s.id}`, sense: "<=", rhs: s.amount,
    coeffs: lay.lanes.flatMap((l, k) => (l.sourceId === s.id ? [[k, 1] as [number, number]] : [])),
  }));
  const covs: LpRow[] = problem.uses.map((u) => {
    const coeffs: [number, number][] = lay.lanes.flatMap((l, k) => {
      if (l.useId !== u.id) return [];
      const h = problem.sources.find((s) => s.id === l.sourceId)!.haircutPct / 100;
      return [[k, 1 - h] as [number, number]];
    });
    const s = lay.sIndex.get(u.id);
    if (s !== undefined) coeffs.push([s, 1]);
    const e = extraHardSlack?.get(u.id);
    if (e !== undefined) coeffs.push([e, 1]);
    return { name: `cov:${u.id}`, sense: "=", rhs: u.amount, coeffs };
  });
  return [...caps, ...covs];
}

export function solveSim(problem: SimProblem): SimResult {
  const started = now();
  const lay = layout(problem);
  const tiers = [...new Set(problem.uses.map((u) => u.tier))].sort((a, b) => a - b);
  const rows = baseRows(problem, lay);
  const stages: TierStage[] = [];
  const tierBounds: Record<number, number> = {};
  const tierRowIndex: Record<number, number> = {};
  let pivots = 0;

  for (const tier of tiers) {
    const tierSoft = lay.softUses.filter((u) => u.tier === tier);
    if (!tierSoft.length) continue;
    const cost = new Array<number>(lay.n).fill(0);
    const coeffs: [number, number][] = tierSoft.map((u) => [lay.sIndex.get(u.id)!, u.penaltyBps]);
    for (const [col, v] of coeffs) cost[col] = v;
    const stage = solveLp({ cost, rows });
    pivots += stage.pivots;
    if (stage.status !== "optimal") return diagnose(problem, lay, started, pivots);
    const bound = stage.objective + Math.max(TIER_TOL_ABS, Math.abs(stage.objective) * TIER_TOL_REL);
    tierBounds[tier] = bound;
    tierRowIndex[tier] = rows.length;
    rows.push({ name: `tier:${tier}`, sense: "<=", rhs: bound, coeffs });
    stages.push({
      tier,
      weightedShortfall: stage.objective,
      shortfall: tierSoft.reduce((sum, u) => sum + stage.x[lay.sIndex.get(u.id)!], 0),
      softUses: tierSoft.length,
    });
  }

  const final = solveLp({ cost: lay.unitCost, rows });
  pivots += final.pivots;
  if (final.status !== "optimal") return diagnose(problem, lay, started, pivots);

  const nSources = problem.sources.length;
  const capDual = (i: number) => final.duals[i];
  const useDual = (j: number) => final.duals[nSources + j];
  const capacityDualBps: Record<string, number> = {};
  const useDualBps: Record<string, number> = {};
  problem.sources.forEach((s, i) => { capacityDualBps[s.id] = clean(-capDual(i)); });
  problem.uses.forEach((u, j) => { useDualBps[u.id] = clean(useDual(j)); });
  const tierDuals: Record<number, number> = {};
  for (const [tier, idx] of Object.entries(tierRowIndex)) tierDuals[Number(tier)] = clean(final.duals[idx]);

  const flows: FlowResult[] = lay.lanes.map((l, k) => {
    const src = problem.sources.find((s) => s.id === l.sourceId)!;
    const h = src.haircutPct / 100;
    const nominal = clean(final.x[k]);
    const reduced = lay.unitCost[k] + capacityDualBps[l.sourceId] - (1 - h) * useDualBps[l.useId];
    return { sourceId: l.sourceId, useId: l.useId, nominal, coverage: nominal * (1 - h), unitCostBps: lay.unitCost[k], reducedCostBps: clean(reduced) };
  });

  const shortfall: Record<string, number> = {};
  const shortfallReducedBps: Record<string, number> = {};
  problem.uses.forEach((u) => { shortfall[u.id] = 0; });
  lay.softUses.forEach((u) => {
    shortfall[u.id] = clean(final.x[lay.sIndex.get(u.id)!]);
    const mu = tierDuals[u.tier] ?? 0;
    shortfallReducedBps[u.id] = clean(u.penaltyBps - useDualBps[u.id] - mu * u.penaltyBps);
  });

  const sourceUsed: Record<string, number> = {};
  problem.sources.forEach((s) => { sourceUsed[s.id] = flows.filter((f) => f.sourceId === s.id).reduce((a, f) => a + f.nominal, 0); });

  return {
    status: "optimal",
    problem,
    flows,
    shortfall,
    sourceUsed,
    capacityDualBps,
    useDualBps,
    tierDuals,
    tierBounds,
    shortfallReducedBps,
    stages,
    objectiveBpsMm: final.objective,
    totals: computeTotals(problem, flows, shortfall, sourceUsed),
    stats: { variables: lay.n, rows: rows.length, stages: stages.length + 1, pivots, millis: now() - started },
  };
}

function diagnose(problem: SimProblem, lay: Layout, started: number, pivotsSoFar: number): InfeasibleResult {
  const hard = problem.uses.filter((u) => u.policy === "hard");
  const eIndex = new Map(hard.map((u, k) => [u.id, lay.n + k]));
  const rows = baseRows(problem, lay, eIndex);
  const cost = new Array<number>(lay.n + hard.length).fill(0);
  for (const idx of eIndex.values()) cost[idx] = 1;
  const elastic = solveLp({ cost, rows });
  const pivots = pivotsSoFar + elastic.pivots;
  const shortUses = hard
    .map((u) => ({ useId: u.id, gap: clean(elastic.x[eIndex.get(u.id)!] ?? 0) }))
    .filter((item) => item.gap > 1e-6)
    .sort((a, b) => b.gap - a.gap);
  const exhaustedSources = problem.sources
    .filter((s, i) => s.amount > 0 && elastic.duals[i] < -1e-9)
    .map((s) => s.id);
  return {
    status: "infeasible",
    problem,
    shortUses,
    exhaustedSources,
    totalGap: shortUses.reduce((a, u) => a + u.gap, 0),
    stats: { variables: cost.length, rows: rows.length, stages: 1, pivots, millis: now() - started },
  };
}

function computeTotals(problem: SimProblem, flows: FlowResult[], shortfall: Record<string, number>, used: Record<string, number>): Totals {
  const demand = problem.uses.reduce((a, u) => a + u.amount, 0);
  const nominal = flows.reduce((a, f) => a + f.nominal, 0);
  const coverage = flows.reduce((a, f) => a + f.coverage, 0);
  const costBpsMm = flows.reduce((a, f) => a + f.nominal * f.unitCostBps, 0);
  const totalShort = Object.values(shortfall).reduce((a, v) => a + v, 0);
  const byFamily: Record<SourceFamily, number> = { internal: 0, secured: 0, unsecured: 0 };
  problem.sources.forEach((s) => { byFamily[s.family] += used[s.id]; });
  return {
    demand,
    nominal,
    coverage,
    haircutDrag: nominal - coverage,
    shortfall: totalShort,
    annualCostMm: costBpsMm / 10_000,
    weightedCostBps: nominal > 0 ? costBpsMm / nominal : 0,
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
 * Re-derives every check from problem data and the reported primal/dual values.
 * Duals certify optimality of the final (economics) stage with tier rows fixed.
 */
export function verifySim(result: FeasibleResult): VerificationCheck[] {
  const { problem, flows, shortfall } = result;
  const tol = (ref: number) => 1e-6 * Math.max(1, Math.abs(ref));
  const laneSet = new Map(problem.lanes.map((l) => [laneKey(l.sourceId, l.useId), l]));
  const source = new Map(problem.sources.map((s) => [s.id, s]));
  const checks: VerificationCheck[] = [];
  const push = (id: string, label: string, failures: string[], ok: string) =>
    checks.push({ id, label, passed: failures.length === 0, detail: failures.length ? failures.slice(0, 3).join("; ") : ok });

  push("nonneg", "Non-negative flows", flows.filter((f) => f.nominal < -1e-9).map((f) => `${f.sourceId}→${f.useId} = ${f.nominal}`), `${flows.length} lane flows ≥ 0`);

  push("lanes", "Denied lanes carry zero flow", flows.filter((f) => !laneSet.has(laneKey(f.sourceId, f.useId)) && Math.abs(f.nominal) > 1e-9)
    .map((f) => `${f.sourceId}→${f.useId} not allowed`), `${problem.lanes.length} allowed lanes; all others denied`);

  const capFail: string[] = [];
  problem.sources.forEach((s) => {
    const used = flows.filter((f) => f.sourceId === s.id).reduce((a, f) => a + f.nominal, 0);
    if (used > s.amount + tol(s.amount)) capFail.push(`${s.id} uses ${used.toFixed(4)} of ${s.amount.toFixed(4)}`);
  });
  push("capacity", "Source capacity respected", capFail, `${problem.sources.length} capacity rows hold`);

  const covFail: string[] = [];
  const hardFail: string[] = [];
  problem.uses.forEach((u) => {
    const covered = flows.filter((f) => f.useId === u.id).reduce((a, f) => a + f.nominal * (1 - source.get(f.sourceId)!.haircutPct / 100), 0);
    const s = shortfall[u.id] ?? 0;
    if (Math.abs(covered + s - u.amount) > tol(u.amount)) covFail.push(`${u.id}: ${covered.toFixed(4)} + ${s.toFixed(4)} ≠ ${u.amount.toFixed(4)}`);
    if (u.policy === "hard" && s > tol(u.amount)) hardFail.push(`${u.id} short ${s.toFixed(4)}`);
  });
  push("coverage", "Coverage reconciles (Σ(1−h)x + s = D)", covFail, `${problem.uses.length} uses reconcile after haircuts`);
  push("hard", "Hard uses fully covered", hardFail, `${problem.uses.filter((u) => u.policy === "hard").length} hard uses at 100%`);

  const objective = flows.reduce((a, f) => {
    const lane = laneSet.get(laneKey(f.sourceId, f.useId));
    const unit = source.get(f.sourceId)!.costBps + (lane?.frictionBps ?? 0);
    return a + unit * f.nominal;
  }, 0) + problem.uses.reduce((a, u) => a + (u.policy === "soft" ? u.penaltyBps * (shortfall[u.id] ?? 0) : 0), 0);
  push("objective", "Objective recomputes", Math.abs(objective - result.objectiveBpsMm) > tol(objective)
    ? [`recomputed ${objective.toFixed(4)} vs reported ${result.objectiveBpsMm.toFixed(4)}`] : [], `${(objective / 10_000).toFixed(3)} $mm/yr incl. penalties`);

  // Dual feasibility: reduced costs from problem data, not from the solver's reported values.
  const dualTol = 1e-6;
  const reduced = (sourceId: string, useId: string) => {
    const s = source.get(sourceId)!;
    const lane = laneSet.get(laneKey(sourceId, useId))!;
    return s.costBps + lane.frictionBps + result.capacityDualBps[sourceId] - (1 - s.haircutPct / 100) * result.useDualBps[useId];
  };
  const shortReduced = (u: SimUse) => u.penaltyBps - result.useDualBps[u.id] - (result.tierDuals[u.tier] ?? 0) * u.penaltyBps;
  const dualFail: string[] = [];
  problem.lanes.forEach((l) => { const d = reduced(l.sourceId, l.useId); if (d < -dualTol) dualFail.push(`${l.sourceId}→${l.useId} reduced ${d.toFixed(6)}`); });
  problem.uses.filter((u) => u.policy === "soft").forEach((u) => { const d = shortReduced(u); if (d < -dualTol) dualFail.push(`s:${u.id} reduced ${d.toFixed(6)}`); });
  problem.sources.forEach((s) => { if (result.capacityDualBps[s.id] < -dualTol) dualFail.push(`${s.id} capacity price < 0`); });
  Object.entries(result.tierDuals).forEach(([t, mu]) => { if (mu > dualTol) dualFail.push(`tier ${t} multiplier > 0`); });
  push("dual", "Dual feasibility (reduced costs ≥ 0)", dualFail, `${problem.lanes.length + result.problem.uses.filter((u) => u.policy === "soft").length} columns priced out`);

  const csFail: string[] = [];
  flows.forEach((f) => {
    if (f.nominal > 1e-6 && Math.abs(reduced(f.sourceId, f.useId)) > 1e-5) csFail.push(`${f.sourceId}→${f.useId} basic with reduced ${reduced(f.sourceId, f.useId).toFixed(6)}`);
  });
  problem.sources.forEach((s) => {
    const slack = s.amount - flows.filter((f) => f.sourceId === s.id).reduce((a, f) => a + f.nominal, 0);
    if (slack > 1e-5 * Math.max(1, s.amount) && result.capacityDualBps[s.id] > 1e-5) csFail.push(`${s.id} slack ${slack.toFixed(4)} but priced`);
  });
  problem.uses.filter((u) => u.policy === "soft").forEach((u) => {
    if ((shortfall[u.id] ?? 0) > 1e-6 && Math.abs(shortReduced(u)) > 1e-5) csFail.push(`s:${u.id} short with reduced ${shortReduced(u).toFixed(6)}`);
  });
  push("cs", "Complementary slackness", csFail, "Every funded lane and shortfall prices to zero; slack capacity is free");

  const dualObjective =
    problem.sources.reduce((a, s) => a - result.capacityDualBps[s.id] * s.amount, 0) +
    problem.uses.reduce((a, u) => a + result.useDualBps[u.id] * u.amount, 0) +
    Object.entries(result.tierDuals).reduce((a, [t, mu]) => a + mu * (result.tierBounds[Number(t)] ?? 0), 0);
  const gap = Math.abs(objective - dualObjective);
  push("gap", "Strong duality (gap = 0)", gap > 1e-4 * Math.max(1, Math.abs(objective)) ? [`primal ${objective.toFixed(4)} vs dual ${dualObjective.toFixed(4)}`] : [],
    `gap ${gap.toExponential(1)} bps·$mm`);

  return checks;
}

// ── Workspace bridge (SIM-008) ──────────────────────────────────────────────

export function toWorkspaceConfiguration(problem: SimProblem, name: string, id: string): SourcesUsesConfiguration {
  const allowed = new Map(problem.lanes.map((l) => [laneKey(l.sourceId, l.useId), l]));
  const sources: ConfigurableSource[] = problem.sources.map((s) => ({
    id: s.id, label: s.label, category: FAMILY_META[s.family].label, amount: round(s.amount, 6), costBps: s.costBps,
    currency: "USD", legalEntity: s.legalEntity, assetClass: s.family === "secured" ? "Secured funding" : "Cash", tenorDays: null,
    priorityTier: 1, minimum: null, maximum: null, lotSize: null, haircutPct: s.haircutPct,
    internality: s.family === "internal" ? "internal" : "external", tags: ["SIM"],
  }));
  const uses: ConfigurableUse[] = problem.uses.map((u) => ({
    id: u.id, label: u.label, category: TIER_LABELS[u.tier] ?? `Tier ${u.tier}`, amount: round(u.amount, 6), bidBps: 0,
    currency: "USD", legalEntity: u.legalEntity, assetClass: "Funding need", tenorDays: null, priorityTier: u.tier,
    minimum: null, maximum: null, lotSize: null, policy: u.policy, shortfallPenaltyBps: u.penaltyBps, tags: ["SIM"],
  }));
  const compatibility = problem.sources.flatMap((s) => problem.uses.map((u) => {
    const l = allowed.get(laneKey(s.id, u.id));
    return { sourceId: s.id, useId: u.id, status: l ? "allowed" as const : "denied" as const, note: l ? `${l.note} · friction ${l.frictionBps}bp` : "Not eligible in SIM book" };
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
