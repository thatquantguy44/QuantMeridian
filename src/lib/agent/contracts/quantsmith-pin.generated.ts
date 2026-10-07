/* eslint-disable */
/**
 * GENERATED from contracts/agent/quantsmith-pin.schema.json by scripts/generate-agent-contracts.mjs.
 * Do not edit by hand; run `npm run generate:agent-contracts`.
 */

/**
 * contracts/agent/quantsmith-pin.json: reviewed content fingerprints of the locally supplied QuantSmith copy (quantsmith-pin/1).
 */
export interface QuantSmithPin {
  schema_version: "quantsmith-pin/1";
  package: {
    name: "quantsmith";
    version: string;
    code_digest: string;
  };
  assets: {
    digest: string;
    /**
     * @minItems 1
     */
    paths: [string, ...string[]];
  };
  reviewed: {
    on: string;
    source_commit: string;
    note?: string;
  };
}
