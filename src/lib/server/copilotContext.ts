/**
 * Desk-data snapshot for the AI Copilot.
 *
 * Assembles a compact, factual JSON view of the securities-finance desks from the
 * same deterministic data getters the rest of the terminal renders. This is the
 * *ground truth* handed to Claude as context — the model answers from these
 * numbers rather than inventing them, keeping the Copilot provenance-honest.
 */
import { getSLSummary, getInventory } from "@/data/securitiesLending";
import { getFinancingOpportunities } from "@/data/primeFinance";
import { getCashSummary } from "@/data/cash";

/** Round to keep the payload small and readable. */
const r = (n: number, dp = 2) => (Number.isFinite(n) ? Number(n.toFixed(dp)) : null);

export function buildCopilotContext(): Record<string, unknown> {
  const sl = getSLSummary();
  const cash = getCashSummary();
  const opps = getFinancingOpportunities();
  const internalize = opps.filter((o) => o.type === "INTERNALIZE");
  const htb = getInventory()
    .filter((r) => (r.classification === "HTB" || r.classification === "SPECIAL") && r.utilization > 90)
    .sort((a, b) => b.utilization - a.utilization)
    .slice(0, 12);

  return {
    securities_lending: {
      day_revenue_usd: r(sl.dayRevenue, 0),
      day_change_pct: r(sl.dayChgPct, 2),
      avg_fee_bps: r(sl.avgFeeBps, 1),
      active_loans: sl.activeLoans,
      top_securities_by_revenue: sl.bySecurity.slice(0, 8).map((s) => ({ name: s.label, day_revenue_usd: r(s.dayRevenue, 0), share_pct: r(s.share * 100, 1) })),
      top_borrowers_by_revenue: sl.byBorrower.slice(0, 8).map((b) => ({ name: b.label, day_revenue_usd: r(b.dayRevenue, 0), share_pct: r(b.share * 100, 1) })),
    },
    collateral: {
      source_mode: "UNCONFIGURED",
      detail: "No governed collateral snapshot or operational run is registered. COLL offers a separate SIM model preview.",
    },
    cash_funding: {
      blended_rate_bps: r(cash.blendedRateBps, 1),
      optimized_rate_bps: r(cash.optimizedRateBps, 1),
      savings_bps: r(cash.savingsBps, 1),
      savings_usd: r(cash.savingsUsd, 0),
      funding_gap_usd: r(cash.fundingGap, 0),
      lcr_pct: r(cash.lcr * 100, 1),
      nsfr_pct: r(cash.nsfr * 100, 1),
    },
    internalization_opportunities: {
      count: internalize.length,
      total_savings_usd: r(internalize.reduce((a, o) => a + o.savings, 0), 0),
      top: internalize.slice(0, 8).map((o) => ({ client: o.client, ticker: o.ticker, current_bps: r(o.currentBps, 1), optimized_bps: r(o.optimizedBps, 1), savings_usd: r(o.savings, 0) })),
    },
    hard_to_borrow: {
      count_over_90pct_util: htb.length,
      names: htb.map((h) => ({ ticker: h.ticker, utilization_pct: r(h.utilization, 1), fee_bps: r(h.feeBps, 1), classification: h.classification })),
    },
  };
}
