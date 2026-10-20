import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import * as sl from "./securitiesLending";
import * as ri from "./reinvestment";

/**
 * spec020 AC-020: the INDEM book extension must not change any value the SLAB, reinvestment, utilization,
 * copilot or agent desk-dataset consumers already see. These are SHA-256 hashes of the JSON of each existing
 * output, captured before the extension was written. A change here means an existing output changed: fix the
 * code, not the hash, unless the change is deliberate and owner-approved.
 */
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const GOLDEN: Record<string, [() => unknown, string]> = {
  "securitiesLending.getInventory": [sl.getInventory, "a015cc804532d8c3ac66afb6900354d8be9a130afd6cd46e1e8cca5cc8c35d3b"],
  "securitiesLending.getLoanBook": [sl.getLoanBook, "23a9b3f352d052597a01c492feeccc562636ba388aa66349a98613dabfd2cb3f"],
  "securitiesLending.getBorrowDemand": [sl.getBorrowDemand, "2fb967ee2a8676703c7e102ab1544a5e5f08aca9ed8335c5e5ac13dcff340975"],
  "securitiesLending.getSLSummary": [sl.getSLSummary, "4c327a29587e822086dca9c15a7cb45cc3dd47efc00e1d8ee39af040fcee621d"],
  "securitiesLending.getRevenueSankey": [sl.getRevenueSankey, "1cd1a194559ea7c3e24ac490d40f572653a9aee06f2a3b5da21e195f1e99f76c"],
  "reinvestment.getReinvestmentPositions": [ri.getReinvestmentPositions, "f3603a91bcb9e2e29ba11d85a9c1259190676519eb7d8253cc37fdc65a773ef6"],
  "reinvestment.getReinvestmentSummary": [ri.getReinvestmentSummary, "dbf3bc7a8d3617b7bd85d3e68ff85eb865d5bb33a62b808edf2850b27a8d13d3"],
};

describe("existing securities lending and reinvestment outputs are unchanged (spec020 AC-020)", () => {
  for (const [name, [getter, hash]] of Object.entries(GOLDEN)) {
    test(name, () => {
      expect(sha(getter())).toBe(hash);
    });
  }
});
