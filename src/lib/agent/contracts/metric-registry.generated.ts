/* eslint-disable */
/**
 * GENERATED from contracts/agent/metric-registry.schema.json by scripts/generate-agent-contracts.mjs.
 * Do not edit by hand; run `npm run generate:agent-contracts`.
 */

/**
 * This interface was referenced by `MetricRegistry`'s JSON-Schema
 * via the `definition` "Metric".
 */
export type Metric = {
  name: string;
  label: string;
  short?: string;
  source: GoldSource | DeskSource;
  data_class: "public_market_data" | "desk_simulated";
  unit: "pct" | "pp" | "bps" | "index" | "currency" | "count" | "ratio" | "hours" | "days" | "shares";
  display_unit?: string;
  chart_unit?: "pct" | "pp" | "bps" | "index" | "currency" | "count" | "ratio" | "hours" | "days" | "shares";
  chart_display_unit?: string;
  unit_review?: "catalog" | "reviewed";
  decimals: number;
  grain: "day" | "week" | "month" | "quarter";
  agg: "sum" | "mean" | "count" | "last" | "ratio";
  snapshot?: boolean;
  additivity: "additive" | "semi_additive" | "non_additive" | "ratio";
  additivity_rationale?: string;
  dimensions: string[];
  /**
   * @minItems 1
   */
  domains: [string, ...string[]];
  synonyms: string[];
  owner: string;
};

/**
 * contracts/agent/generated/metric_registry.json: the metrics workflows may plan over (metric-registry/1). Generated; never edited by hand.
 */
export interface MetricRegistry {
  schema_version: "metric-registry/1";
  registry_version: string;
  /**
   * @minItems 1
   */
  metrics: [Metric, ...Metric[]];
  excluded: {
    name: string;
    reason: "sim_only" | "lin_unit_unreviewed";
  }[];
  desk_datasets: DeskDataset[];
}
/**
 * This interface was referenced by `MetricRegistry`'s JSON-Schema
 * via the `definition` "GoldSource".
 */
export interface GoldSource {
  kind: "gold_series";
  source: "econ" | "fred" | "market";
  id: string;
  units: "lin";
}
/**
 * This interface was referenced by `MetricRegistry`'s JSON-Schema
 * via the `definition` "DeskSource".
 */
export interface DeskSource {
  kind: "desk_dataset";
  dataset: string;
  measure:
    | DeskExpr
    | {
        numerator: DeskExpr;
        denominator: DeskExpr;
      };
}
/**
 * Per row, the sum over terms of the product of each term's fields; then fn over rows.
 *
 * This interface was referenced by `MetricRegistry`'s JSON-Schema
 * via the `definition` "DeskExpr".
 */
export interface DeskExpr {
  fn: "sum" | "mean" | "count";
  /**
   * @minItems 1
   */
  terms: [[string, ...string[]], ...[string, ...string[]][]];
}
/**
 * This interface was referenced by `MetricRegistry`'s JSON-Schema
 * via the `definition` "DeskDataset".
 */
export interface DeskDataset {
  id: string;
  module: string;
  getter: string;
  fields: {
    [k: string]: "string" | "number" | "boolean";
  };
  dimensions: {
    [k: string]: string;
  };
}
