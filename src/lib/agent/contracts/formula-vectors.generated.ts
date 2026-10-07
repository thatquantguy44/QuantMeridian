/* eslint-disable */
/**
 * GENERATED from contracts/agent/formula-vectors.schema.json by scripts/generate-agent-contracts.mjs.
 * Do not edit by hand; run `npm run generate:agent-contracts`.
 */

/**
 * Shared golden vectors for one formula, run by the worker (QuantSmith 0028/0008) and the Node verifier (formula-vectors/1).
 */
export interface FormulaVectors {
  schema_version: "formula-vectors/1";
  formula:
    | "days_act"
    | "leg_cost"
    | "net_financing_cost"
    | "funding_rate_bps"
    | "shocked_net_cost"
    | "pct_to_bps"
    | "spread_bps"
    | "share"
    | "aggregate";
  description?: string;
  /**
   * @minItems 1
   */
  vectors: [
    {
      name: string;
      inputs: {};
      params?: {};
      expected: number | null | {};
      decimals: number;
      note?: string;
    },
    ...{
      name: string;
      inputs: {};
      params?: {};
      expected: number | null | {};
      decimals: number;
      note?: string;
    }[]
  ];
}
