// Pure helpers behind the INDEM page (spec020 IND-T14): number formatting, derived tables, the close-out
// setting specs (checked against the profile schema in the tests so they cannot drift), and profile diffs.
import type {
  BorrowerResult, ChannelMetrics, IndemnificationResult, Metric, Metrics, ProgramMetrics, Stress,
} from "./indemnificationApi";
import type { CloseoutProfile, CloseoutSettings } from "./indemnificationContract";

// ---------- formatting ----------

export function fmtMoney(x: number): string {
  if (!Number.isFinite(x)) return "n/a";
  const a = Math.abs(x);
  const sign = x < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}
export function fmtBps(x: number): string {
  return Number.isFinite(x) ? `${x.toFixed(2)} bp` : "n/a";
}
export function fmtPct(p: number, digits = 2): string {
  if (!Number.isFinite(p)) return "n/a";
  if (p !== 0 && Math.abs(p) * 100 < 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)}%`;
  return `${(p * 100).toFixed(digits)}%`;
}
/** "value ± standard error"; "n/a" for an error that was not estimated. */
export function fmtMetric(m: Metric, format: (x: number) => string = fmtMoney): string {
  return m.std_error === null ? `${format(m.value)} (SE n/a)` : `${format(m.value)} ± ${format(m.std_error)}`;
}
export function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

// ---------- results ----------

export const METRIC_COLUMNS: { key: keyof Metrics; label: string; hint: string }[] = [
  { key: "el", label: "EL", hint: "Expected loss over the horizon" },
  { key: "epe", label: "EPE", hint: "Expected positive exposure, time-averaged" },
  { key: "pfe95", label: "PFE 95", hint: "Peak potential future exposure at 95%" },
  { key: "pfe99", label: "PFE 99", hint: "Peak potential future exposure at 99%" },
  { key: "var99", label: "VaR 99", hint: "Loss quantile at 99%" },
  { key: "var999", label: "VaR 99.9", hint: "Loss quantile at 99.9%" },
  { key: "es99", label: "ES 99", hint: "Expected shortfall at 99%" },
  { key: "es999", label: "ES 99.9", hint: "Expected shortfall at 99.9%" },
];
export const CHANNELS: { key: keyof ChannelMetrics; label: string }[] = [
  { key: "total", label: "Total" },
  { key: "default_shortfall", label: "Default shortfall" },
  { key: "reinvestment", label: "Reinvestment" },
];
export type VariantKey = "with_wrong_way" | "without_wrong_way" | "student_t";
export const VARIANTS: { key: VariantKey; label: string }[] = [
  { key: "with_wrong_way", label: "Gaussian, wrong-way on" },
  { key: "without_wrong_way", label: "Gaussian, wrong-way off" },
  { key: "student_t", label: "Student-t sensitivity" },
];

export function channelsFor(program: ProgramMetrics, variant: VariantKey): ChannelMetrics | null {
  if (variant === "student_t") return program.student_t;
  return program.gaussian[variant];
}

/** How much the wrong-way link adds to total expected loss (a fraction), or null when the base is zero. */
export function wrongWayUplift(program: ProgramMetrics): number | null {
  const on = program.gaussian.with_wrong_way.total.el.value;
  const off = program.gaussian.without_wrong_way.total.el.value;
  return off > 0 ? on / off - 1 : null;
}

/** Whether the sampled tail has anything in it. With no defaults in the sampled paths VaR and ES are 0. */
export function tailIsEmpty(channels: ChannelMetrics): boolean {
  const m = channels.default_shortfall;
  return m.var99.value === 0 && m.var999.value === 0 && m.es99.value === 0 && m.es999.value === 0;
}

export function peakOf(values: number[]): number {
  return values.reduce((a, b) => (b > a ? b : a), 0);
}

export type BorrowerSortKey = "borrower" | "pd" | "el" | "pfe99" | "euler" | "estar" | "fee" | "cost" | "flag";
export interface BorrowerRow {
  id: string;
  name: string;
  rating: string;
  creditSource: BorrowerResult["credit_source"];
  pd: number;
  el: number;
  pfe99: number;
  euler: number;
  eStar: number | null;
  mcPfe99: number;
  feeBps: number | null;
  costBps: number | null;
  proxyCostBps: number | null;
  flagged: boolean | null;
}

export function borrowerRows(
  result: IndemnificationResult, names: Record<string, { name: string; rating: string }>,
): BorrowerRow[] {
  const cross = new Map(result.cross_check.borrowers.map((r) => [r.borrower_id, r]));
  return result.borrowers.map((b) => {
    const m = b.metrics.with_wrong_way;
    const c = cross.get(b.borrower_id);
    return {
      id: b.borrower_id,
      name: names[b.borrower_id]?.name ?? b.borrower_id,
      rating: names[b.borrower_id]?.rating ?? "",
      creditSource: b.credit_source,
      pd: b.pd_1y,
      el: m.total.el.value,
      pfe99: m.default_shortfall.pfe99.value,
      euler: b.euler_es99.value,
      eStar: c ? c.e_star : null,
      mcPfe99: c ? c.mc_pfe99 : m.default_shortfall.pfe99.value,
      feeBps: b.pricing ? b.pricing.fee_bps : null,
      costBps: b.pricing ? b.pricing.indemnification_cost_bps : null,
      proxyCostBps: b.pricing ? b.pricing.regulatory_proxy_cost_bps : null,
      flagged: b.pricing ? b.pricing.flagged : null,
    };
  });
}

const SORT_VALUE: Record<BorrowerSortKey, (r: BorrowerRow) => number | string> = {
  borrower: (r) => r.name,
  pd: (r) => r.pd,
  el: (r) => r.el,
  pfe99: (r) => r.pfe99,
  euler: (r) => r.euler,
  estar: (r) => r.eStar ?? -1,
  fee: (r) => r.feeBps ?? -1,
  cost: (r) => r.costBps ?? -1,
  flag: (r) => (r.flagged === null ? -1 : r.flagged ? 1 : 0),
};
export function sortBorrowers(rows: BorrowerRow[], key: BorrowerSortKey, direction: "asc" | "desc"): BorrowerRow[] {
  const value = SORT_VALUE[key];
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a), y = value(b);
    const order = typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : (x as number) - (y as number);
    return sign * order || a.name.localeCompare(b.name);
  });
}

export interface StressTotals { id: Stress["id"]; label: string; defaultShortfall: number; reinvestment: number; worstBorrower: { id: string; loss: number } | null }
export function stressTotals(stresses: Stress[]): StressTotals[] {
  return stresses.map((s) => {
    const rows = s.by_borrower.map((r) => ({ id: r.borrower_id, loss: r.default_shortfall + r.reinvestment }));
    const worst = rows.reduce<{ id: string; loss: number } | null>((best, r) => (r.loss > 0 && (!best || r.loss > best.loss) ? r : best), null);
    return {
      id: s.id,
      label: s.label,
      defaultShortfall: s.by_borrower.reduce((a, r) => a + r.default_shortfall, 0),
      reinvestment: s.by_borrower.reduce((a, r) => a + r.reinvestment, 0),
      worstBorrower: worst,
    };
  });
}

// ---------- close-out setting specs ----------

export type SettingKind = "int" | "number" | "boolean" | "enum";
export interface SettingSpec {
  key: keyof CloseoutSettings;
  label: string;
  hint: string;
  kind: SettingKind;
  min?: number;
  max?: number;
  exclusiveMin?: boolean;
  nullable?: boolean;
  options?: string[];
}
export const SETTING_SPECS: SettingSpec[] = [
  { key: "mpor_liquid_days", label: "Close-out, liquid (days)", hint: "Business days to close out a liquid position", kind: "int", min: 1, max: 60 },
  { key: "mpor_other_days", label: "Close-out, other (days)", hint: "Business days for other positions", kind: "int", min: 1, max: 60 },
  { key: "mpor_concentrated_days", label: "Close-out, concentrated (days)", hint: "Used above the concentration threshold or for hard-to-borrow names", kind: "int", min: 1, max: 60 },
  { key: "mpor_pool_forced_sale_days", label: "Pool forced sale (days)", hint: "Close-out period for reinvestment pool positions", kind: "int", min: 1, max: 60 },
  { key: "mpor_fixed_days", label: "Fixed close-out (days)", hint: "When set, replaces the four periods above", kind: "int", min: 1, max: 60, nullable: true },
  { key: "addon_days", label: "Add-on days", hint: "Extra days added to the close-out period", kind: "int", min: 0, max: 40 },
  { key: "concentration_threshold_pct_adv", label: "Concentration threshold (% ADV)", hint: "Position size above which the concentrated period applies", kind: "number", min: 0, max: 1000 },
  { key: "htb_uses_concentrated_period", label: "Hard-to-borrow uses concentrated period", hint: "Treat hard-to-borrow securities as concentrated", kind: "boolean" },
  { key: "impact_k", label: "Impact coefficient k", hint: "Market impact: k × volatility × (size / ADV)^α", kind: "number", min: 0 },
  { key: "impact_alpha", label: "Impact exponent α", hint: "Between 0 (exclusive) and 1", kind: "number", min: 0, max: 1, exclusiveMin: true },
  { key: "half_spread_floor_bps", label: "Half-spread floor (bp)", hint: "Minimum liquidity cost", kind: "number", min: 0 },
  { key: "cost_cap_bps", label: "Cost cap (bp)", hint: "Maximum liquidity cost; empty for none", kind: "number", min: 0, nullable: true },
  { key: "stress_beta", label: "Stress multiplier β", hint: "Cost × (1 + β × adverse move of the stress factor)", kind: "number", min: 0 },
  { key: "stress_factor", label: "Stress factor", hint: "Which factor raises liquidity cost when it moves against you", kind: "enum", options: ["equity", "credit_spread", "rates", "fx"] },
  { key: "unwind", label: "Unwind", hint: "Trade at the end of the period, or evenly over it", kind: "enum", options: ["end_of_period", "even"] },
  { key: "margin_call_every_days", label: "Margin call every (days)", hint: "Collateral is reset this often", kind: "int", min: 1, max: 20 },
];

/** Why a value is not allowed for a setting; null when it is. Mirrors closeout-profile-1.0.schema.json. */
export function validateSetting(spec: SettingSpec, value: unknown): string | null {
  if (value === null) return spec.nullable ? null : `${spec.label} must be set`;
  if (spec.kind === "boolean") return typeof value === "boolean" ? null : `${spec.label} must be true or false`;
  if (spec.kind === "enum") return spec.options!.includes(value as string) ? null : `${spec.label} must be one of ${spec.options!.join(", ")}`;
  if (typeof value !== "number" || !Number.isFinite(value)) return `${spec.label} must be a number`;
  if (spec.kind === "int" && !Number.isInteger(value)) return `${spec.label} must be a whole number`;
  if (spec.min !== undefined && (spec.exclusiveMin ? value <= spec.min : value < spec.min)) return `${spec.label} must be ${spec.exclusiveMin ? "above" : "at least"} ${spec.min}`;
  if (spec.max !== undefined && value > spec.max) return `${spec.label} must be at most ${spec.max}`;
  return null;
}

export type OverrideLevel = "asset_class_overrides" | "pool_bucket_overrides" | "borrower_overrides" | "position_overrides";
export const OVERRIDE_LEVELS: { key: OverrideLevel; label: string }[] = [
  { key: "asset_class_overrides", label: "Asset class" },
  { key: "pool_bucket_overrides", label: "Pool bucket" },
  { key: "borrower_overrides", label: "Borrower" },
  { key: "position_overrides", label: "Position" },
];

export interface ProfileChange { level: "defaults" | OverrideLevel; target: string | null; setting: string; from: unknown; to: unknown }
/** Every difference between two profiles, as a flat list (empty when they behave identically). */
export function diffProfiles(profile: CloseoutProfile, base: CloseoutProfile): ProfileChange[] {
  const changes: ProfileChange[] = [];
  for (const spec of SETTING_SPECS) {
    const a = profile.defaults[spec.key], b = base.defaults[spec.key];
    if (a !== b) changes.push({ level: "defaults", target: null, setting: spec.key, from: b, to: a });
  }
  for (const { key } of OVERRIDE_LEVELS) {
    const mine = profile[key] as Record<string, Record<string, unknown>>;
    const theirs = base[key] as Record<string, Record<string, unknown>>;
    for (const target of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const a = mine[target] ?? {}, b = theirs[target] ?? {};
      for (const setting of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (a[setting] !== b[setting]) changes.push({ level: key, target, setting, from: b[setting] ?? null, to: a[setting] ?? null });
      }
    }
  }
  return changes;
}
