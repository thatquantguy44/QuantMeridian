/**
 * Metric registry builder (spec009 REQ-009, AC-009).
 *
 * Builds the registry of metrics workflows may plan over from the Gold series catalog
 * (FRED_CATALOG), the desk dataset registry, a reviewed unit table, and curated synonyms. The
 * result is committed as contracts/agent/generated/metric_registry.json and drift-checked, so a
 * catalog change without regeneration fails CI.
 *
 * Rules (PLAN "Metric registry"):
 *  - The registry unit is the unit of the raw Gold `lin` level, because verified claims report
 *    levels (see metricUnits.ts). A series that is neither plain nor in the reviewed table is
 *    excluded, never guessed.
 *  - Additivity defaults to non_additive; relaxing it needs a recorded rationale.
 *  - Desk metrics come only from datasets whose declared source is simulated.
 */
import { createHash } from "node:crypto";
import synonymsFile from "../../../../settings/agent_metric_synonyms.json";
import { FRED_CATALOG, resolveFred, type EconCategory, type FredSeries } from "@/data/econSeries";
import { FUNDING_FRED_IDS } from "@/data/funding";
import type { MetricRegistry } from "@/lib/agent/contracts/metric-registry.generated";
import { SCHEMA_VERSIONS } from "@/lib/agent/compat";
import { DESK_DATASETS, validateDeskDatasets, type DeskDatasetDef, type DeskMetricDef } from "./deskDatasets";
import { CATALOG_UNITS, levelLabel, REVIEWED_LIN_UNITS } from "./metricUnits";
import type { MetricUnit } from "./metricTypes";

type Metric = MetricRegistry["metrics"][number];

/** Series the PLAN names as funding and money-market inputs, beyond the FUND module's own list. */
const EXTRA_FUNDING_IDS = ["SOFR", "EFFR", "FEDFUNDS", "IORB", "OBFR", "TGCRRATE", "BGCR", "RRPONTSYD", "DTB3", "SOFR30DAYAVG"];

const DOMAIN_BY_CATEGORY: Record<EconCategory, string> = {
  RATES: "rates_fixed_income",
  CREDIT: "credit_markets",
  FX: "fx_markets",
  GROWTH: "economics_macro",
  INFLATION: "economics_macro",
  LABOR: "economics_macro",
  HOUSING: "economics_macro",
  CONSUMER: "economics_macro",
  MONEY: "economics_macro",
  ACTIVITY: "economics_macro",
};

/** The catalog files the high-yield OAS under RATES; it is a credit spread and takes the credit pack. */
const DOMAIN_OVERRIDES: Readonly<Record<string, string>> = { BAMLH0A0HYM2: "credit_markets" };

const GRAIN_BY_FREQ: Record<FredSeries["freq"], Metric["grain"]> = { D: "day", W: "week", M: "month", Q: "quarter" };

const DESK_DISPLAY_UNIT: Record<DeskMetricDef["unit"], string> = {
  currency: "$", bps: "bps", ratio: "ratio", count: "count", shares: "shares",
};

const normalize = (s: string) => s.trim().toLowerCase();

function nonEmpty<T>(items: T[], what: string): [T, ...T[]] {
  const [first, ...rest] = items;
  if (first === undefined) throw new RegistryBuildError(`${what} must not be empty`);
  return [first, ...rest];
}

/** Stable JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function registryVersion(body: Omit<MetricRegistry, "registry_version">): string {
  return `sha256:${createHash("sha256").update(canonicalJson(body), "utf8").digest("hex")}`;
}

export interface BuildOptions {
  catalog?: readonly FredSeries[];
  datasets?: readonly DeskDatasetDef[];
  curatedSynonyms?: Readonly<Record<string, readonly string[]>>;
}

export class RegistryBuildError extends Error {}

export function buildMetricRegistry(opts: BuildOptions = {}): MetricRegistry {
  const catalog = opts.catalog ?? FRED_CATALOG;
  const datasets = opts.datasets ?? DESK_DATASETS;
  const deskSynonyms = Object.fromEntries(datasets.flatMap((d) => d.metrics.map((m) => [m.name, m.synonyms] as const)));
  const curated: Readonly<Record<string, readonly string[]>> = { ...(opts.curatedSynonyms ?? synonymsFile.synonyms), ...deskSynonyms };

  const deskProblems = validateDeskDatasets(datasets);
  if (deskProblems.length) {
    throw new RegistryBuildError(`desk dataset registry invalid:\n  ${deskProblems.map((p) => `${p.dataset}: ${p.message}`).join("\n  ")}`);
  }

  const fundingIds = new Set<string>([...FUNDING_FRED_IDS, ...EXTRA_FUNDING_IDS]);
  const metrics: Metric[] = [];
  const excluded: MetricRegistry["excluded"] = [];

  for (const s of catalog) {
    const resolved = resolveFred(s.id);
    if (resolved.simOnly) {
      excluded.push({ name: s.id, reason: "sim_only" });
      continue;
    }

    const reviewed = REVIEWED_LIN_UNITS[s.id];
    const plain = resolved.units === "lin" && resolved.scale === 1;
    let unit: MetricUnit;
    let displayUnit: string;
    let decimals: number;
    let review: "catalog" | "reviewed";
    if (reviewed) {
      ({ unit, displayUnit, decimals } = reviewed);
      review = "reviewed";
    } else if (plain && CATALOG_UNITS[s.unit]) {
      ({ unit, displayUnit } = CATALOG_UNITS[s.unit]);
      decimals = s.decimals;
      review = "catalog";
    } else {
      excluded.push({ name: s.id, reason: "lin_unit_unreviewed" });
      continue;
    }

    const domains = [DOMAIN_OVERRIDES[s.id] ?? DOMAIN_BY_CATEGORY[s.category]];
    if (fundingIds.has(s.id)) domains.push("short_term_markets_funding");

    // When the resolver transforms the series for display (pc1/pch/pca/chg), the chart engine
    // shows the transformed series by default while claims report the raw level.
    const transformed = resolved.units !== "lin";
    const chart = transformed ? CATALOG_UNITS[s.unit] : undefined;
    if (transformed && !chart) throw new RegistryBuildError(`${s.id}: no chart unit mapping for catalog unit "${s.unit}"`);

    metrics.push({
      name: s.id,
      label: transformed ? levelLabel(s.label) : s.label,
      short: s.short,
      source: { kind: "gold_series", source: "econ", id: s.id, units: "lin" },
      data_class: "public_market_data",
      unit,
      display_unit: displayUnit,
      ...(chart ? { chart_unit: chart.unit, chart_display_unit: chart.displayUnit } : {}),
      unit_review: review,
      decimals,
      grain: GRAIN_BY_FREQ[s.freq],
      agg: "mean",
      additivity: "non_additive",
      dimensions: [],
      domains: nonEmpty([...new Set(domains)].sort(), `${s.id} domains`),
      synonyms: [],
      owner: "gold:fred_latest_observation",
    });
  }

  for (const ds of datasets) {
    for (const m of ds.metrics) {
      metrics.push({
        name: m.name,
        label: m.label,
        source: { kind: "desk_dataset", dataset: ds.id, measure: m.measure },
        data_class: "desk_simulated",
        unit: m.unit,
        display_unit: DESK_DISPLAY_UNIT[m.unit],
        decimals: m.decimals,
        grain: "day",
        agg: m.agg,
        snapshot: true,
        additivity: m.additivity,
        additivity_rationale: m.additivityRationale,
        dimensions: Object.keys(ds.dimensions).sort(),
        domains: nonEmpty([...m.domains].sort(), `${m.name} domains`),
        synonyms: [],
        owner: `sim:${ds.dataFile.replace(/^src\/data\//, "").replace(/\.ts$/, "")}.${ds.getter}`,
      });
    }
  }

  metrics.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  assignSynonyms(metrics, curated);

  const body = {
    schema_version: SCHEMA_VERSIONS.registry,
    metrics,
    excluded: excluded.sort((a, b) => (a.name < b.name ? -1 : 1)),
    desk_datasets: datasets.map((d) => ({ id: d.id, module: d.module, getter: d.getter, fields: d.fields, dimensions: d.dimensions })),
  } as Omit<MetricRegistry, "registry_version">;
  return { ...body, registry_version: registryVersion(body) } as MetricRegistry;
}

/**
 * Curated synonyms must be globally unique and name real metrics (a duplicate would make the
 * keyword interpreter clarify forever). Automatic ones (label, short name, id) are added only
 * when nothing else has claimed them, curated first.
 */
function assignSynonyms(metrics: Metric[], curated: Readonly<Record<string, readonly string[]>>): void {
  const byName = new Map(metrics.map((m) => [m.name, m]));
  const owner = new Map<string, string>();
  const claim = (metric: Metric, raw: string, strict: boolean) => {
    const key = normalize(raw);
    if (!key) return;
    const held = owner.get(key);
    if (held && held !== metric.name) {
      if (strict) throw new RegistryBuildError(`synonym "${key}" is claimed by both ${held} and ${metric.name}`);
      return;
    }
    owner.set(key, metric.name);
    if (!metric.synonyms.includes(key)) metric.synonyms.push(key);
  };

  for (const [name, list] of Object.entries(curated)) {
    const metric = byName.get(name);
    if (!metric) throw new RegistryBuildError(`curated synonyms name unknown metric "${name}"`);
    for (const syn of list) claim(metric, syn, true);
  }
  for (const metric of metrics) {
    claim(metric, metric.name, false);
    claim(metric, metric.label, false);
    if (metric.short) claim(metric, metric.short, false);
  }
  for (const metric of metrics) metric.synonyms.sort();
}

export function serializeRegistry(registry: MetricRegistry): string {
  return `${JSON.stringify(registry, null, 2)}\n`;
}
