/**
 * Friendly sizing for InventoryBallast engine stress scenarios.
 *
 * The engine takes explicit entity-level parameters (route ids, quantities, fractions). This module
 * turns a few presentable controls (breadth, severity) into those parameters, sized against what the
 * optimizer actually allocated in the baseline run, so a stress moves the answer instead of
 * recalling shares the optimizer was never going to use. Everything here is pure.
 */
import type {
  DatasetEnvelope,
  IbalCounterpartyLimitRow,
  IbalInventoryRow,
  IbalResult,
  IbalRouteRow,
  IbalStressOutcome,
} from "@/lib/inventoryOptimizer";

export type SizingValues = Record<string, number>;

export interface SizingField {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
  hint?: string;
}

export interface ScenarioFamily {
  id: string;
  label: string;
  /** One line a presenter can read aloud. */
  story: string;
  fields: SizingField[];
}

const breadth = (max: number, def: number, noun: string): SizingField =>
  ({ key: "breadth", label: `Number of ${noun}`, unit: "", min: 1, max, step: 1, default: def });

export const SCENARIO_FAMILIES: ScenarioFamily[] = [
  {
    id: "recall_wave", label: "Recall wave", story: "Owners recall shares from the routes the book leans on most.",
    fields: [breadth(10, 3, "routes"), { key: "recallPct", label: "Share of each route recalled", unit: "%", min: 5, max: 100, step: 5, default: 50 }],
  },
  {
    id: "specials_squeeze", label: "Specials squeeze", story: "Borrow fees widen on the biggest lending routes.",
    fields: [breadth(10, 3, "routes"), { key: "spreadBps", label: "Fee widening", unit: "bp", min: 5, max: 500, step: 5, default: 100 }],
  },
  {
    id: "borrower_limit_cut", label: "Borrower limit cut", story: "Credit cuts counterparty limits.",
    fields: [breadth(5, 1, "limits"), { key: "reductionPct", label: "Limit reduction", unit: "%", min: 5, max: 100, step: 5, default: 50 }],
  },
  {
    id: "borrower_default", label: "Borrower default", story: "The largest borrower stops performing.",
    fields: [breadth(5, 1, "borrowers"), { key: "recoveryPct", label: "Capacity recovered", unit: "%", min: 0, max: 100, step: 5, default: 0, hint: "0 means no recovery, the engine default." }],
  },
  {
    id: "supply_shock", label: "Supply shock", story: "A block of lendable inventory is sold or pulled.",
    fields: [{ key: "lendablePct", label: "Available shares removed", unit: "%", min: 1, max: 100, step: 1, default: 30 }],
  },
  {
    id: "rate_shock_ladder", label: "Rate shock ladder", story: "Lending fees step up in three stages.",
    fields: [breadth(10, 3, "routes"), { key: "maxStepBps", label: "Largest step", unit: "bp", min: 10, max: 300, step: 10, default: 100 }],
  },
  {
    id: "quote_expiry", label: "Quote expiry", story: "External borrow quotes lapse before the trade settles.",
    fields: [breadth(5, 1, "quotes")],
  },
  {
    id: "balance_sheet_haircut", label: "Balance-sheet haircut", story: "Balance-sheet budgets are cut.",
    fields: [breadth(5, 1, "budgets"), { key: "haircutPct", label: "Budget haircut", unit: "%", min: 5, max: 100, step: 5, default: 25 }],
  },
];

const FAMILY_BY_ID = new Map(SCENARIO_FAMILIES.map((family) => [family.id, family]));

export function defaultSizing(familyId: string): SizingValues {
  const family = FAMILY_BY_ID.get(familyId);
  return Object.fromEntries((family?.fields ?? []).map((field) => [field.key, field.default]));
}

/** Fill, round and clamp so a half-typed or hostile value can never reach the engine request. */
export function clampSizing(familyId: string, values: Partial<SizingValues>): SizingValues {
  const family = FAMILY_BY_ID.get(familyId);
  const out: SizingValues = {};
  for (const field of family?.fields ?? []) {
    const raw = values[field.key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) { out[field.key] = field.default; continue; }
    const value = field.step >= 1 ? Math.round(raw) : raw;
    out[field.key] = Math.min(field.max, Math.max(field.min, value));
  }
  return out;
}

type Request = Record<string, unknown>;
const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

interface Quote { quote_id: string; expires_at: string; observed_at?: string; effective_from?: string }

function context(dataset: DatasetEnvelope | null) {
  const request = (dataset?.request ?? {}) as unknown as Request;
  const asOf = String(request.as_of ?? "2026-09-14T12:00:00Z");
  return {
    request,
    asOf,
    asOfDate: asOf.slice(0, 10),
    effectiveDate: String(request.effective_date ?? dataset?.summary?.effective_date ?? asOf.slice(0, 10)),
    routes: list<IbalRouteRow>(request.routes),
    inventory: list<IbalInventoryRow>(request.inventory),
    limits: list<IbalCounterpartyLimitRow>(request.counterparty_limits),
    quotes: list<Quote>(request.external_borrow_quotes),
    budgets: list<{ budget_id: string }>(request.balance_sheet_budgets),
  };
}

function activeLimits(ctx: ReturnType<typeof context>) {
  // Compare instants: the synthetic generator emits full timestamps, uploads may carry plain dates.
  const at = Date.parse(ctx.asOf);
  return ctx.limits.filter((row) => Date.parse(row.effective_from) <= at && (row.effective_to == null || at < Date.parse(row.effective_to)));
}
function liveQuotes(ctx: ReturnType<typeof context>) {
  return ctx.quotes.filter((row) => Date.parse(row.expires_at) > Date.parse(ctx.asOf));
}

/** Quantity each route holds in the baseline answer, or the current book when no baseline exists. */
function routeQuantities(ctx: ReturnType<typeof context>, baseline: IbalResult | null): Map<string, number> {
  const allocated = new Map((baseline?.allocations ?? []).map((row) => [row.route_id, row.post_quantity_shares]));
  return new Map(ctx.routes.map((row) => [row.route_id, allocated.get(row.route_id) ?? (baseline ? 0 : row.current_quantity_shares)]));
}

function topRoutes(ctx: ReturnType<typeof context>, qty: Map<string, number>, count: number) {
  const eligible = ctx.routes.filter((row) => row.eligible);
  const held = eligible.filter((row) => (qty.get(row.route_id) ?? 0) > 0);
  const pool = held.length ? held : eligible;
  return [...pool].sort((a, b) => (qty.get(b.route_id) ?? 0) - (qty.get(a.route_id) ?? 0) || a.route_id.localeCompare(b.route_id)).slice(0, count);
}

export function familyAvailability(familyId: string, dataset: DatasetEnvelope | null): { available: boolean; reason?: string } {
  const ctx = context(dataset);
  const ok = { available: true };
  const no = (reason: string) => ({ available: false, reason });
  if (!dataset) return no("Generate or upload a dataset first.");
  switch (familyId) {
    case "borrower_limit_cut": return activeLimits(ctx).length ? ok : no("This dataset has no counterparty limits in force.");
    case "supply_shock": return ctx.inventory.some((row) => row.eligible) ? ok : no("This dataset has no eligible inventory.");
    case "quote_expiry": return liveQuotes(ctx).length ? ok : no("This dataset has no live external borrow quotes (the default synthetic dataset has none).");
    case "balance_sheet_haircut": return ctx.budgets.length ? ok : no("This dataset has no balance-sheet budgets (the default synthetic dataset has none).");
    default: return ctx.routes.some((row) => row.eligible) ? ok : no("This dataset has no eligible routes.");
  }
}

function quoteExpiryBeforeAsOf(ctx: ReturnType<typeof context>, quote: Quote | undefined): string {
  if (!quote) return ctx.asOf;
  const expiry = Date.parse(quote.expires_at);
  const starts = [quote.observed_at, quote.effective_from].filter(Boolean).map((value) => Date.parse(String(value)));
  const start = starts.length ? Math.max(...starts) : Number.NaN;
  const end = Math.min(expiry, Date.parse(ctx.asOf));
  return Number.isFinite(start) && end > start ? new Date(start + (end - start) / 2).toISOString() : quote.expires_at;
}

const round = (value: number, places = 6) => Number(value.toFixed(places));

export function buildScenarioParameters(
  familyId: string,
  dataset: DatasetEnvelope | null,
  baseline: IbalResult | null,
  sizing: Partial<SizingValues>,
): Record<string, unknown> {
  const ctx = context(dataset);
  const size = clampSizing(familyId, sizing);
  const tag = Object.entries(size).map(([key, value]) => `${key}${value}`).join("-");
  const base = {
    scenario_id: `qm-${familyId}-${(dataset?.request_hash ?? "draft").slice(0, 8)}${tag ? `-${tag}` : ""}`,
    name: familyId.replaceAll("_", " "),
    source: "QuantMeridian Scenario Studio",
    source_version: "1.0.0",
  };
  const qty = routeQuantities(ctx, baseline);

  switch (familyId) {
    case "recall_wave": {
      const targets = topRoutes(ctx, qty, size.breadth)
        .map((row) => {
          const removable = row.maximum_quantity_shares - row.hard_minimum_quantity_shares;
          return { route_id: row.route_id, quantity_shares: round(Math.min(removable, ((qty.get(row.route_id) ?? 0) * size.recallPct) / 100)) };
        })
        .filter((target) => target.quantity_shares > 0);
      return { ...base, targets, trade_date: ctx.asOfDate, effective_date: ctx.effectiveDate, settlement_date: ctx.effectiveDate };
    }
    case "specials_squeeze":
      return { ...base, route_ids: topRoutes(ctx, qty, size.breadth).map((row) => row.route_id), spread_widening_bps: size.spreadBps };
    case "borrower_limit_cut":
      return { ...base, limit_ids: activeLimits(ctx).slice(0, size.breadth).map((row) => row.limit_id), reduction_fraction: round(size.reductionPct / 100) };
    case "borrower_default": {
      const exposure = new Map<string, number>();
      for (const row of ctx.routes.filter((r) => r.eligible)) exposure.set(row.borrower_id, (exposure.get(row.borrower_id) ?? 0) + (qty.get(row.route_id) ?? 0));
      const borrowers = [...exposure.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, size.breadth).map(([id]) => id);
      // Omitting recovery is deliberate: the engine treats it as zero capacity recovery.
      return { ...base, borrower_ids: borrowers, ...(size.recoveryPct > 0 ? { recovery_fraction: round(size.recoveryPct / 100) } : {}) };
    }
    case "supply_shock": {
      const eligible = ctx.inventory.filter((row) => row.eligible);
      const pick = [...eligible].sort((a, b) => b.available_to_lend_shares - a.available_to_lend_shares || a.inventory_id.localeCompare(b.inventory_id))[0];
      return {
        ...base,
        inventory_id: pick?.inventory_id ?? "",
        quantity_shares: pick ? Math.max(Number.EPSILON, round((pick.available_to_lend_shares * size.lendablePct) / 100)) : 1,
        event_type: "sell",
        trade_date: ctx.asOfDate,
        effective_date: ctx.effectiveDate,
        settlement_date: ctx.effectiveDate,
      };
    }
    case "rate_shock_ladder":
      return {
        ...base,
        factor: "lending_fee_spread",
        template: "spread_widening",
        direction: "increase",
        targets: topRoutes(ctx, qty, size.breadth).map((row) => ({ field: "route.fee_rate", target_id: row.route_id })),
        steps_bps: [round(size.maxStepBps / 4, 2), round(size.maxStepBps / 2, 2), size.maxStepBps],
      };
    case "quote_expiry": {
      const quotes = liveQuotes(ctx).slice(0, size.breadth);
      return { ...base, quote_ids: quotes.map((q) => q.quote_id), expires_at: quoteExpiryBeforeAsOf(ctx, quotes[0]) };
    }
    case "balance_sheet_haircut":
      return { ...base, budget_ids: ctx.budgets.slice(0, size.breadth).map((b) => b.budget_id), haircut_fraction: round(size.haircutPct / 100) };
    default: {
      // A family the engine registers that this module does not know how to size yet.
      const route = ctx.routes.find((row) => row.eligible) ?? ctx.routes[0];
      const demand = list<{ demand_group_id: string }>(ctx.request.demand);
      return { ...base, route_ids: route ? [route.route_id] : [], demand_group_ids: demand.slice(0, 1).map((row) => row.demand_group_id) };
    }
  }
}

export interface SuiteItem { family: string; label: string; parameters: Record<string, unknown> }

/** One default-sized scenario per family that this dataset can support. */
export function buildStressSuite(dataset: DatasetEnvelope | null, baseline: IbalResult | null): SuiteItem[] {
  return SCENARIO_FAMILIES
    .filter((family) => familyAvailability(family.id, dataset).available)
    .map((family) => ({ family: family.id, label: family.label, parameters: buildScenarioParameters(family.id, dataset, baseline, defaultSizing(family.id)) }));
}

export interface RankedOutcome { rank: number; family: string; outcome: IbalStressOutcome }

const unscored = (o: IbalStressOutcome) => o.objective_delta_usd == null || o.status !== "optimal" || !o.verification_passed;

/** Most damaging first. Infeasible, unverified or unscored outcomes outrank every feasible one. */
export function rankStressOutcomes(groups: { family: string; outcomes: IbalStressOutcome[] }[]): RankedOutcome[] {
  const flat = groups.flatMap((group) => group.outcomes.map((outcome) => ({ family: group.family, outcome })));
  return flat
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ua = unscored(a.item.outcome), ub = unscored(b.item.outcome);
      if (ua !== ub) return ua ? -1 : 1;
      const da = a.item.outcome.objective_delta_usd ?? 0, db = b.item.outcome.objective_delta_usd ?? 0;
      return da - db || a.index - b.index;
    })
    .map(({ item }, position) => ({ rank: position + 1, ...item }));
}
