/**
 * Desk dataset registry (spec009 T-029 declarations; consumed by the metric registry, T-004).
 *
 * A desk dataset is a simulated book exposed to agent workflows through declared fields only.
 * Each dataset names its module, the getter that produces its rows, the data file's declared
 * source (which must be "SIM" — REQ-029, REQ-033), the row fields it exposes, its dimensions,
 * and the metrics computed over it. The getters themselves are loaded by the desk-data route and
 * the verifier (T-029); this module holds declarations only, so it can be imported by scripts.
 */
import { DATA_SOURCE as SECURITIES_LENDING_SOURCE } from "@/data/securitiesLending";
import type { DeskExpr } from "@/lib/agent/contracts/metric-registry.generated";

export type { DeskExpr };

export type DeskFieldType = "string" | "number" | "boolean";

export interface DeskMetricDef {
  name: string;
  label: string;
  /** Plain aggregation, or a ratio of two aggregations over the same rows. */
  measure: DeskExpr | { numerator: DeskExpr; denominator: DeskExpr };
  unit: "currency" | "bps" | "ratio" | "count" | "shares";
  decimals: number;
  agg: "sum" | "mean" | "count" | "last" | "ratio";
  additivity: "additive" | "semi_additive" | "non_additive" | "ratio";
  additivityRationale: string;
  domains: string[];
  synonyms: string[];
}

export interface DeskDatasetDef {
  id: string;
  module: string;
  /** Name of the exported getter in the data file (resolved by the loader, not here). */
  getter: string;
  dataFile: string;
  /** The data file's DATA_SOURCE constant, read at import time. */
  declaredSource: string;
  fields: Record<string, DeskFieldType>;
  /** Dimension name -> row field it groups by. */
  dimensions: Record<string, string>;
  metrics: DeskMetricDef[];
}

const PRIME = ["securities_financing_prime"];

export const DESK_DATASETS: readonly DeskDatasetDef[] = [
  {
    id: "sl_inventory",
    module: "SLAB",
    getter: "getInventory",
    dataFile: "src/data/securitiesLending.ts",
    declaredSource: SECURITIES_LENDING_SOURCE,
    fields: {
      ticker: "string", assetClass: "string", source: "string", classification: "string",
      available: "number", onLoan: "number", restricted: "number", utilization: "number",
      feeBps: "number", marketValue: "number",
    },
    dimensions: { ticker: "ticker", asset_class: "assetClass", source: "source", classification: "classification" },
    metrics: [
      {
        name: "sl_utilization",
        label: "Lending utilization",
        // `available` in the getter excludes on-loan and restricted shares, so total lendable is
        // their sum (this is the page's own definition: onLoan / base).
        measure: {
          numerator: { fn: "sum", terms: [["onLoan"]] },
          denominator: { fn: "sum", terms: [["available"], ["onLoan"], ["restricted"]] },
        },
        unit: "ratio", decimals: 4, agg: "ratio", additivity: "ratio",
        additivityRationale: "Ratio of two additive sums; never summed or averaged across groups.",
        domains: PRIME,
        synonyms: ["utilization", "utilisation", "lending utilization"],
      },
      {
        name: "sl_inventory_value",
        label: "Lendable inventory value",
        measure: { fn: "sum", terms: [["marketValue"]] },
        unit: "currency", decimals: 0, agg: "sum", additivity: "semi_additive",
        additivityRationale: "Adds across positions at one date; a stock, so it is not summed across periods.",
        domains: PRIME,
        synonyms: ["inventory value", "lendable inventory", "inventory market value"],
      },
    ],
  },
  {
    id: "sl_loans",
    module: "SLAB",
    getter: "getLoanBook",
    dataFile: "src/data/securitiesLending.ts",
    declaredSource: SECURITIES_LENDING_SOURCE,
    fields: {
      ticker: "string", borrower: "string", collateralType: "string",
      qty: "number", notional: "number", rateBps: "number", revenueDay: "number",
      daysOpen: "number", recallable: "boolean",
    },
    dimensions: { ticker: "ticker", borrower: "borrower", collateral_type: "collateralType" },
    metrics: [
      {
        name: "sl_daily_revenue",
        label: "Daily lending revenue",
        measure: { fn: "sum", terms: [["revenueDay"]] },
        unit: "currency", decimals: 0, agg: "sum", additivity: "additive",
        additivityRationale: "Each loan's daily revenue is a flow that adds across loans and days.",
        domains: PRIME,
        synonyms: ["lending revenue", "revenue", "daily revenue"],
      },
      {
        name: "sl_on_loan_notional",
        label: "On-loan notional",
        measure: { fn: "sum", terms: [["notional"]] },
        unit: "currency", decimals: 0, agg: "sum", additivity: "semi_additive",
        additivityRationale: "Adds across loans at one date; a stock, so it is not summed across periods.",
        domains: PRIME,
        synonyms: ["on loan", "on-loan value", "loan balance", "on loan notional"],
      },
      {
        name: "sl_weighted_fee_bps",
        label: "Notional-weighted borrow fee",
        measure: {
          numerator: { fn: "sum", terms: [["rateBps", "notional"]] },
          denominator: { fn: "sum", terms: [["notional"]] },
        },
        unit: "bps", decimals: 1, agg: "ratio", additivity: "ratio",
        additivityRationale: "Weighted average rate: a ratio of two additive sums, never summed or simply averaged.",
        domains: PRIME,
        synonyms: ["borrow fee", "weighted fee", "average fee", "lending fee"],
      },
    ],
  },
  {
    id: "sl_borrow_demand",
    module: "SLAB",
    getter: "getBorrowDemand",
    dataFile: "src/data/securitiesLending.ts",
    declaredSource: SECURITIES_LENDING_SOURCE,
    fields: {
      ticker: "string", borrower: "string", qty: "number", bidBps: "number",
      classification: "string", filled: "number", urgency: "string",
    },
    dimensions: { ticker: "ticker", borrower: "borrower", classification: "classification", urgency: "urgency" },
    metrics: [],
  },
];

export const DESK_DATASET_IDS: ReadonlySet<string> = new Set(DESK_DATASETS.map((d) => d.id));

export interface DeskRegistryProblem {
  dataset: string;
  message: string;
}

/** Declarations must be internally consistent and entirely simulated. */
export function validateDeskDatasets(datasets: readonly DeskDatasetDef[] = DESK_DATASETS): DeskRegistryProblem[] {
  const problems: DeskRegistryProblem[] = [];
  const seenMetrics = new Set<string>();
  const seenIds = new Set<string>();
  for (const ds of datasets) {
    const bad = (message: string) => problems.push({ dataset: ds.id, message });
    if (seenIds.has(ds.id)) bad("duplicate dataset id");
    seenIds.add(ds.id);
    if (ds.declaredSource !== "SIM") bad(`DATA_CLASS_NOT_APPROVED: declared source is "${ds.declaredSource}", not "SIM"`);
    for (const [dim, field] of Object.entries(ds.dimensions)) {
      if (!(field in ds.fields)) bad(`dimension "${dim}" groups by undeclared field "${field}"`);
    }
    const checkExpr = (expr: DeskExpr, where: string) => {
      for (const term of expr.terms) {
        for (const field of term) {
          if (ds.fields[field] !== "number" && !(expr.fn === "count" && field in ds.fields)) {
            bad(`${where} uses "${field}", which is not a declared numeric field`);
          }
        }
      }
    };
    for (const m of ds.metrics) {
      if (seenMetrics.has(m.name)) bad(`duplicate metric name "${m.name}"`);
      seenMetrics.add(m.name);
      if ("numerator" in m.measure) {
        checkExpr(m.measure.numerator, `${m.name} numerator`);
        checkExpr(m.measure.denominator, `${m.name} denominator`);
        if (m.agg !== "ratio" || m.additivity !== "ratio") bad(`${m.name} is a ratio and must declare agg and additivity "ratio"`);
      } else {
        checkExpr(m.measure, m.name);
        if (m.agg === "ratio") bad(`${m.name} declares agg "ratio" without a numerator and denominator`);
      }
    }
  }
  return problems;
}
