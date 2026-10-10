/**
 * QuantMeridian-Core replacement for the desk dataset registry. The upstream registry declares the
 * simulated securities-finance books (inventory, loans, borrow demand), which this repository does
 * not include. The exports keep the metric registry and config validators working with no desk data.
 */
import type { DeskExpr } from "@/lib/agent/contracts/metric-registry.generated";

export type { DeskExpr };

export type DeskFieldType = "string" | "number" | "boolean";

export interface DeskMetricDef {
  name: string;
  label: string;
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
  getter: string;
  dataFile: string;
  declaredSource: string;
  fields: Record<string, DeskFieldType>;
  dimensions: Record<string, string>;
  metrics: DeskMetricDef[];
}

export const DESK_DATASETS: readonly DeskDatasetDef[] = [];

export const DESK_DATASET_IDS: ReadonlySet<string> = new Set(DESK_DATASETS.map((d) => d.id));

export interface DeskRegistryProblem {
  dataset: string;
  message: string;
}

export function validateDeskDatasets(_datasets: readonly DeskDatasetDef[] = DESK_DATASETS): DeskRegistryProblem[] {
  return [];
}
