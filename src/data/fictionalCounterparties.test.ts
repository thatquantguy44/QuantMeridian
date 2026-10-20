import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COUNTERPARTIES } from "./universe";
import { getCounterpartyCreditOverlays } from "./econEnhancements";

/**
 * Simulated desks must not cast real firms as clients, borrowers, owners or counterparties: invented ratings,
 * margin calls, breaches or recalls attributed to a real firm are misleading. Real names remain fine as
 * market data (tickers such as JPM and GS, index names such as "ICE BofA").
 */
const REAL_FIRMS = /\b(Citadel|Millennium|Point72|Balyasny|D\.?\s?E\.? Shaw|Two Sigma|AQR|Marshall Wace|Brevan|Elliott|Goldman|Morgan Stanley|J\.?P\.? ?Morgan|JPMorgan|Bank of America|UBS|BNP|BlackRock|Vanguard|State Street|CalPERS|GPIF|Norges Bank IM|Bridgewater|Renaissance|BlueCrest|Barclays|Deutsche Bank|HSBC|Citigroup|Jefferies|Fidelity|PIMCO)\b/i;

describe("fictional counterparties", () => {
  it("uses only fictional names in the shared counterparty list", () => {
    for (const c of COUNTERPARTIES) expect(c.name, c.id).not.toMatch(REAL_FIRMS);
    expect(COUNTERPARTIES.every((c) => !/cp-(cit|mil|gs|ms|jpm|blk)/.test(c.id))).toBe(true);
  });

  it("keeps counterparty short codes unique", () => {
    const shorts = COUNTERPARTIES.map((c) => c.short);
    expect(new Set(shorts).size).toBe(shorts.length);
  });

  it("uses only fictional names in counterparty credit overlays", () => {
    for (const row of getCounterpartyCreditOverlays()) expect(row.counterparty).not.toMatch(REAL_FIRMS);
  });

  for (const file of ["alerts.ts", "cash.ts", "econEnhancements.ts"]) {
    it(`names no real firm in ${file}`, () => {
      const text = readFileSync(path.join(__dirname, file), "utf8").replace(/ICE BofA/g, "");
      expect(text).not.toMatch(REAL_FIRMS);
    });
  }
});
