/**
 * Sized stress scenarios for a generated collateral book (spec016 COLL-014).
 *
 * Each control returns a NEW native snapshot with only inputs changed. Nothing here computes collateral
 * economics: the pinned service validates, solves and verifies every snapshot, and this module only ranks the
 * verified results the service returns.
 */
import type { NativeSnapshot } from "@/lib/collateralBooks";
import type { SizingField } from "@/lib/ibalScenarioSizing";

export type StressValues = Record<string, number>;

export interface StressFamily { id: string; label: string; story: string; fields: SizingField[] }

export const STRESS_FAMILIES: StressFamily[] = [
  {
    id: "call_spike", label: "Margin call spike", story: "The largest margin calls jump, as in a volatility event.",
    fields: [
      { key: "breadth", label: "Calls affected", unit: "", min: 1, max: 8, step: 1, default: 1 },
      { key: "increasePct", label: "Call increase", unit: "%", min: 5, max: 150, step: 5, default: 35 },
    ],
  },
  {
    id: "haircut_shock", label: "Haircut shock", story: "Counterparties widen haircuts on everything except cash.",
    fields: [{ key: "shiftPp", label: "Haircut increase", unit: "pp", min: 1, max: 15, step: 1, default: 5 }],
  },
  {
    id: "reserve_squeeze", label: "Liquidity reserve squeeze", story: "Treasury raises the minimum liquidity buffer the desk must keep.",
    fields: [{ key: "reservePct", label: "Reserve as share of today's", unit: "%", min: 100, max: 500, step: 25, default: 250 }],
  },
  {
    id: "cutoff_squeeze", label: "Tighter cutoffs", story: "Counterparties shorten the time allowed to deliver.",
    fields: [{ key: "deadlinePct", label: "Time allowed", unit: "% of today's", min: 10, max: 100, step: 5, default: 50 }],
  },
  {
    id: "cost_shock", label: "Settlement cost spike", story: "Moving collateral gets more expensive: move costs and activation fees rise.",
    fields: [{ key: "multiple", label: "Cost multiple", unit: "x", min: 1, max: 20, step: 1, default: 10 }],
  },
  {
    id: "issuer_denial", label: "Issuer denied", story: "The largest issuers in the free inventory become ineligible, as after a downgrade.",
    fields: [{ key: "breadth", label: "Issuers denied", unit: "", min: 1, max: 3, step: 1, default: 1 }],
  },
];

const FAMILY = new Map(STRESS_FAMILIES.map((family) => [family.id, family]));

/**
 * Sizes that visibly move each book without breaking it. Measured against the real service: the dealer book absorbs a
 * reserve of 4x today's (infeasible at 4.5x), the asset-manager book only 2.5x (infeasible at 3x).
 */
const PROFILE_DEFAULTS: Record<string, Record<string, Partial<StressValues>>> = {
  dealer: { reserve_squeeze: { reservePct: 400 }, cutoff_squeeze: { deadlinePct: 30 } },
  asset_manager: { reserve_squeeze: { reservePct: 250 }, cutoff_squeeze: { deadlinePct: 20 } },
};

export function defaultStress(familyId: string, profile?: string): StressValues {
  const generic = Object.fromEntries((FAMILY.get(familyId)?.fields ?? []).map((field) => [field.key, field.default]));
  const overrides = (profile && PROFILE_DEFAULTS[profile]?.[familyId]) || {};
  return Object.assign({}, generic, overrides) as StressValues;
}

/** The profile a generated book was built from, read from its source label. */
export function profileOf(book: NativeSnapshot): string | undefined {
  return /^GENERATED-DEMO:(\w+)/.exec(book.source)?.[1];
}

export function clampStress(familyId: string, values: Partial<StressValues>): StressValues {
  const out: StressValues = {};
  for (const field of FAMILY.get(familyId)?.fields ?? []) {
    const raw = values[field.key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) { out[field.key] = field.default; continue; }
    const value = field.step >= 1 ? Math.round(raw) : raw;
    out[field.key] = Math.min(field.max, Math.max(field.min, value));
  }
  return out;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;
const clone = (book: NativeSnapshot): NativeSnapshot => JSON.parse(JSON.stringify(book)) as NativeSnapshot;
const usdValue = (book: NativeSnapshot, currency: string, amount: number) =>
  amount * (book.fx.find((quote) => quote.currency === currency)?.usd_per_unit ?? 1);

const COMPARED: (keyof NativeSnapshot)[] = [
  "book_id", "source", "as_of", "horizon_days", "max_input_age_minutes", "minimum_liquidity_reserve_usd",
  "fx", "assets", "calls", "agreements", "current_pledges",
];

/** Top-level input fields whose content differs. Scenario labels and lineage are metadata, not inputs. */
export function changedFields(a: NativeSnapshot, b: NativeSnapshot): string[] {
  return COMPARED.filter((name) => JSON.stringify(a[name]) !== JSON.stringify(b[name])).map(String);
}

export function applyStress(base: NativeSnapshot, familyId: string, sizing: Partial<StressValues>): { snapshot: NativeSnapshot; changed: string[] } {
  const size = clampStress(familyId, sizing);
  const next = clone(base);

  switch (familyId) {
    case "call_spike": {
      const largest = [...base.calls]
        .sort((x, y) => usdValue(base, y.currency, y.required_value) - usdValue(base, x.currency, x.required_value) || x.call_id.localeCompare(y.call_id))
        .slice(0, size.breadth).map((call) => call.call_id);
      for (const call of next.calls) if (largest.includes(call.call_id)) call.required_value = round2(call.required_value * (1 + size.increasePct / 100));
      break;
    }
    case "haircut_shock":
      for (const agreement of next.agreements) {
        for (const rule of agreement.classes) if (rule.asset_class !== "CASH") rule.haircut = Math.min(0.95, round6(rule.haircut + size.shiftPp / 100));
      }
      break;
    case "reserve_squeeze":
      next.minimum_liquidity_reserve_usd = round2(base.minimum_liquidity_reserve_usd * (size.reservePct / 100));
      break;
    case "cutoff_squeeze":
      for (const call of next.calls) call.deadline_minutes = Math.max(5, Math.round(call.deadline_minutes * (size.deadlinePct / 100)));
      break;
    case "cost_shock":
      for (const asset of next.assets) {
        asset.variable_move_bps = round6(asset.variable_move_bps * size.multiple);
        asset.fixed_activation_fee_usd = round2(asset.fixed_activation_fee_usd * size.multiple);
      }
      break;
    case "issuer_denial": {
      const free = new Map<string, number>();
      for (const asset of base.assets.filter((a) => !a.asset_id.startsWith("GEN-HELD-"))) {
        free.set(asset.issuer, (free.get(asset.issuer) ?? 0) + usdValue(base, asset.currency, asset.allocatable_value));
      }
      const denied = [...free.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, size.breadth).map(([issuer]) => issuer);
      for (const agreement of next.agreements) agreement.denied_issuers = [...new Set([...agreement.denied_issuers, ...denied])];
      break;
    }
    default:
      throw new Error(`Unknown stress family: ${familyId}`);
  }

  next.scenario_id = `qm-${familyId}-${Object.entries(size).map(([key, value]) => `${key}${value}`).join("-")}`;
  return { snapshot: next, changed: changedFields(base, next) };
}

export interface SuiteScenario { family: string; label: string; snapshot: NativeSnapshot; changed: string[] }

/** One default-sized scenario per family, all built from the same base book. */
export function buildCollateralSuite(base: NativeSnapshot): SuiteScenario[] {
  return STRESS_FAMILIES.map((family) => ({
    family: family.id,
    label: family.label,
    ...applyStress(base, family.id, defaultStress(family.id, profileOf(base))),
  }));
}

export interface CollateralOutcome { family: string; label: string; lifecycle: string; verified: boolean; costUsd: number | null }
export interface RankedCollateral extends CollateralOutcome { rank: number; deltaUsd: number | null }

const scored = (o: CollateralOutcome) => o.lifecycle === "SUCCEEDED_VERIFIED" && o.verified && o.costUsd !== null;

/**
 * Most damaging first. Infeasible, errored or unverified outcomes rank ahead of every feasible one and carry no cost
 * (COLL-009); feasible ones are ordered by how much they raise verified target cost over the baseline.
 */
export function rankCollateralOutcomes(baselineCostUsd: number, outcomes: CollateralOutcome[]): RankedCollateral[] {
  return outcomes
    .map((outcome, index) => ({ outcome, index }))
    .sort((a, b) => {
      const sa = scored(a.outcome), sb = scored(b.outcome);
      if (sa !== sb) return sa ? 1 : -1;
      if (!sa) return a.index - b.index;
      return (b.outcome.costUsd! - a.outcome.costUsd!) || a.index - b.index;
    })
    .map(({ outcome }, position) => ({
      ...outcome,
      costUsd: scored(outcome) ? outcome.costUsd : null,
      rank: position + 1,
      deltaUsd: scored(outcome) ? outcome.costUsd! - baselineCostUsd : null,
    }));
}
