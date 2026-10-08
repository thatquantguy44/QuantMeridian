import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { NAV } from "./nav";

/**
 * Test that all nav items have corresponding routes registered in App.tsx.
 * This catches cases where a nav entry is advertised but 404s because the
 * router never registered it (e.g., EDA before G10 was fixed).
 *
 * The test extracts nav codes and hrefs, then verifies they match the routing
 * structure in App.tsx. A nav item's href must correspond to a route path
 * under the same module gate (on() code).
 */
describe("Nav/Route consistency", () => {
  it("all enabled nav items should have corresponding routes", () => {
    // Map of code → expected href patterns
    const expectedRoutes: Record<string, string[]> = {
      HOME: ["/"],
      MKT: ["/markets"],
      SNAP: ["/market-snapshot"],
      QUILT: ["/asset-quilt"],
      IRET: ["/index-returns"],
      LENS: ["/market-lens"],
      MKC: ["/market-chart"],
      MVOL: ["/market-volatility"],
      SLAB: ["/securities-lending"],
      SQZ: ["/securities-lending/squeeze"],
      PB: ["/prime-finance"],
      COLL: ["/collateral"],
      CASH: ["/cash-optimizer"],
      REINV: ["/reinvestment"],
      LIQ: ["/liquidity"],
      SXU: ["/sources-uses"],
      OPT: ["/optimization"],
      IBAL: ["/inventory-optimizer"],
      MCS: ["/simulations/mcs"],
      VOLF: ["/ml/volatility-forecaster"],
      DESK: ["/trading-desk"],
      TASSIST: ["/trading-assistant"],
      ECON: ["/economics"],
      ECOIQ: ["/economics/ecoiq"],
      CURV: ["/economics/curve"],
      INFL: ["/economics/inflation"],
      GCPI: ["/economics/global-cpi"],
      GPOL: ["/economics/policy-rates"],
      CRDT: ["/economics/credit"],
      FOMC: ["/economics/rates"],
      CAL: ["/economics/calendar"],
      STAT: ["/economics/stats"],
      REGIME: ["/economics/regime"],
      EML: ["/economics/ml"],
      SFE: ["/economics/sec-finance"],
      FUND: ["/economics/funding"],
      BMRK: ["/economics/benchmark"],
      BRA: ["/economics/rate-analysis"],
      UTIL: ["/economics/utilization"],
      YCURV: ["/economics/yield-curve"],
      RVOL: ["/economics/rate-vol"],
      FCOST: ["/economics/funding-cost"],
      MGC: ["/macro-chart"],
      EDA: ["/economics/eda"],
      MOTN: ["/economics/motion"],
      POLY: ["/polymarket"],
      NEWS: ["/news"],
      SENT: ["/sentiment"],
      AI: ["/copilot"],
      DATAOPS: ["/dataops"],
      ALRT: ["/alerts"],
    };

    const mismatches: { code: string; href: string; reason: string }[] = [];

    for (const item of NAV) {
      const expected = expectedRoutes[item.code];
      if (!expected) {
        mismatches.push({
          code: item.code,
          href: item.href,
          reason: `No route mapping defined for this code (test may need updating)`,
        });
      } else if (!expected.includes(item.href)) {
        mismatches.push({
          code: item.code,
          href: item.href,
          reason: `href does not match expected route(s): ${expected.join(", ")}`,
        });
      }
    }

    expect(mismatches, `Nav items without matching routes:\n${mismatches.map((m) => `  ${m.code}: ${m.href} (${m.reason})`).join("\n")}`).toEqual(
      []
    );
  });

  it("nav items should not point to routes that do not exist", () => {
    const validPaths = new Set([
      "/",
      "/markets",
      "/market-snapshot",
      "/asset-quilt",
      "/index-returns",
      "/market-lens",
      "/market-chart",
      "/market-volatility",
      "/securities-lending",
      "/securities-lending/squeeze",
      "/prime-finance",
      "/collateral",
      "/cash-optimizer",
      "/reinvestment",
      "/liquidity",
      "/sources-uses",
      "/optimization",
      "/inventory-optimizer",
      "/simulations/mcs",
      "/ml/volatility-forecaster",
      "/trading-desk",
      "/trading-assistant",
      "/economics",
      "/economics/ecoiq",
      "/economics/curve",
      "/economics/inflation",
      "/economics/global-cpi",
      "/economics/policy-rates",
      "/economics/credit",
      "/economics/rates",
      "/economics/calendar",
      "/economics/stats",
      "/economics/regime",
      "/economics/ml",
      "/economics/sec-finance",
      "/economics/funding",
      "/economics/benchmark",
      "/economics/rate-analysis",
      "/economics/utilization",
      "/economics/yield-curve",
      "/economics/rate-vol",
      "/economics/funding-cost",
      "/macro-chart",
      "/economics/eda",
      "/economics/motion",
      "/polymarket",
      "/news",
      "/sentiment",
      "/copilot",
      "/dataops",
      "/alerts",
    ]);

    const orphaned = NAV.filter((item) => !validPaths.has(item.href));

    expect(
      orphaned,
      `Nav items without valid routes:\n${orphaned.map((item) => `  ${item.code}: ${item.href}`).join("\n")}`
    ).toEqual([]);
  });

  it("every nav item is registered in App.tsx under its own module gate", () => {
    // The lists above can drift from the router; this reads the router itself. A route is
    // `on("CODE") && <Route ... path="segment" .../>`, and the nav href must end with that segment.
    const app = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");
    const missing: string[] = [];
    for (const item of NAV) {
      if (item.href === "/") continue;
      const line = new RegExp(`on\\("${item.code}"\\)[^\\n]*`).exec(app)?.[0];
      // An index route (ECON) renders at its parent's path, which the section list above covers.
      if (line && /\bindex\b/.test(line)) continue;
      const segment = line ? /path="([^"]+)"/.exec(line)?.[1] : undefined;
      if (!segment || !(item.href === `/${segment}` || item.href.endsWith(`/${segment}`))) {
        missing.push(`${item.code}: ${item.href} (App.tsx route: ${segment ?? "none"})`);
      }
    }
    expect(missing, `Nav items not routed under their gate:\n  ${missing.join("\n  ")}`).toEqual([]);
  });
});
