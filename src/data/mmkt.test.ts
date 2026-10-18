import { describe, expect, test } from "vitest";
import {
  BASELINES, DEFAULT_BASELINE, MMKT_SCENARIOS, PERIOD_DATES, allocationsCsv, analyzeCurrency, buildBaselineInput, buildRunInput,
  compareToBaseline, demoBook, demoCashForecast,
  runnableCandidates, type CurrencyResult, type MmktRunResult, type RateRow,
} from "./mmkt";

const rate = (id: string, status = "ok", y: number | null = 3.8): RateRow => ({
  instrument_id: id, quoted_rate_pct: y, quoted_basis: "simple_act360", mm_yield_pct: status === "ok" ? y : null,
  observation_date: "2026-10-16", staleness_days: 0, status, status_detail: null,
});
const RATES = ["RRPONTSYAWARD", "SOFR", "DTB4WK", "DTB3", "DTB6", "DCPF1M", "MMF.GOVT.7D", "MMF.PRIME.7D", "CD.3M", "DEP.ON"].map((id) => rate(id))
  .concat([rate("DTB1YR", "stale"), rate("DCPN3M", "unavailable", null)]);

describe("illustrative MMKT book", () => {
  test("opening cash continues the p50 path, as the service requires", () => {
    const forecast = demoCashForecast();
    for (const account of new Set(forecast.map((f) => f.account_id))) {
      const pts = forecast.filter((f) => f.account_id === account);
      for (let i = 1; i < pts.length; i++) {
        expect(pts[i].opening_cash).toBeCloseTo(pts[i - 1].opening_cash + pts[i - 1].known_net_flow + pts[i - 1].estimated_residual_p50, 6);
      }
      expect(pts.map((p) => p.period_date)).toEqual(PERIOD_DATES);
    }
  });

  test("residual bands are ordered p10 ≤ p50 ≤ p90", () => {
    for (const p of demoCashForecast()) {
      expect(p.estimated_residual_p10).toBeLessThanOrEqual(p.estimated_residual_p50);
      expect(p.estimated_residual_p50).toBeLessThanOrEqual(p.estimated_residual_p90);
    }
  });

  test("candidates priced off non-ok rows or disabled by the user never enter a run", () => {
    const book = demoBook();
    const ids = runnableCandidates(book, RATES).map((c) => c.candidate_id);
    expect(ids).not.toContain("TB-52W-1014");
    expect(ids).not.toContain("CP-3M-BETA");
    expect(ids).toContain("CP-1M-ACME");
    const disabled = runnableCandidates({ ...book, enabled: { ...book.enabled, "CP-1M-ACME": false } }, RATES).map((c) => c.candidate_id);
    expect(disabled).not.toContain("CP-1M-ACME");
    expect(runnableCandidates(book, null)).toEqual([]);
  });

  test("the run input names its SIM set explicitly and never carries a snapshot", () => {
    const input = buildRunInput(demoBook(), RATES, "SIM-MMKT-2026-10-BASE", "00000000-0000-4000-8000-000000000000");
    expect(input.rate_source).toBe("sim");
    expect(input.sim_set_id).toBe("SIM-MMKT-2026-10-BASE");
    expect(input).not.toHaveProperty("rate_snapshot");
    expect(input.horizon.period_dates[0]).toBe(input.horizon.start_date);
    expect(input.horizon.period_dates.at(-1)).toBe(input.horizon.end_date);
  });

  test("liquidity floors are unique per entity and date across daily and weekly lists", () => {
    const p = demoBook().policy;
    const keys = [...p.daily_liquidity_floors, ...p.weekly_liquidity_floors].map((f) => `${f.legal_entity_id}|${f.period_date}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("named scenarios", () => {
  const byId = (id: string) => MMKT_SCENARIOS.find((s) => s.id === id)!;

  test("five scenarios, each on a registered SIM set", () => {
    expect(MMKT_SCENARIOS.map((s) => s.id)).toEqual(["base", "rate-cut", "fund-fee-gate", "forecast-miss", "downgrade"]);
    expect(byId("rate-cut").simSetId).toBe("SIM-MMKT-2026-10-CUT25");
  });

  test("transforms change only what they describe", () => {
    const base = demoBook();
    const gated = byId("fund-fee-gate").apply(base).candidates.find((c) => c.instrument_type === "prime_mmf")!;
    expect(gated.explicit_cost_bps).toBe(25);
    expect(gated.maximum_amount).toBe(100);
    expect(byId("forecast-miss").apply(base).policy.cash_forecast_case).toBe("p10");
    const down = byId("downgrade").apply(base).candidates;
    expect(down.filter((c) => c.counterparty_id === "DEALER-A").every((c) => c.rating === "BBB")).toBe(true);
    expect(down.find((c) => c.issuer_id === "ACME-FIN")!.rating).toBe("BBB+");
    expect(base.candidates.find((c) => c.issuer_id === "ACME-FIN")!.rating).toBe("A+");
  });
});

describe("result analytics", () => {
  const input = buildRunInput(demoBook(), RATES, "SIM-MMKT-2026-10-BASE", "00000000-0000-4000-8000-000000000000");
  const result: CurrencyResult = {
    currency: "USD", objective_value: 1.5, backend: "scipy-highs", backend_version: "1", iterations: 3,
    verification: { passed: true, max_variable_bound_violation: 0, max_row_violation: 0, objective_delta: 0 },
    allocations: [
      { candidate_id: "RRP-2026-10-19", rate_instrument_id: "RRPONTSYAWARD", legal_entity_id: "QMS", account_id: "QMS-OPER-USD", currency: "USD", purchase_date: "2026-10-19", settlement_date: "2026-10-19", maturity_date: "2026-10-20", amount: 100, mm_yield_pct: 3.8, explicit_cost_bps: 0, modeled_net_return_pct: 0.0104 },
      { candidate_id: "CD-3M-BANKA", rate_instrument_id: "CD.3M", legal_entity_id: "QMS", account_id: "QMS-OPER-USD", currency: "USD", purchase_date: "2026-10-19", settlement_date: "2026-10-19", maturity_date: "2027-01-19", amount: 300, mm_yield_pct: 3.97, explicit_cost_bps: 0.5, modeled_net_return_pct: 0.11 },
      { candidate_id: "TB-4W-1117", rate_instrument_id: "DTB4WK", legal_entity_id: "QMP", account_id: "QMP-SWEEP-USD", currency: "USD", purchase_date: "2026-10-20", settlement_date: "2026-10-20", maturity_date: "2026-11-17", amount: 50, mm_yield_pct: 3.84, explicit_cost_bps: 0.2, modeled_net_return_pct: 0.1 },
    ],
    cash_balances: PERIOD_DATES.flatMap((d) => [
      { legal_entity_id: "QMS", account_id: "QMS-OPER-USD", currency: "USD", period_date: d, cash: 400 },
      { legal_entity_id: "QMP", account_id: "QMP-SWEEP-USD", currency: "USD", period_date: d, cash: 200 },
    ]),
  };
  const a = analyzeCurrency(result, input);

  test("holdings by day follow purchase and maturity dates", () => {
    expect(a.holdings[0].byFamily.government).toBe(100);
    expect(a.holdings[0].byFamily.bank).toBe(300);
    expect(a.holdings[1].byFamily.government).toBe(50);
    expect(a.holdings[0].cash).toBe(600);
  });

  test("the maturity ladder reconciles to allocations maturing after the horizon", () => {
    expect(a.heldAtEnd).toBe(350);
    expect(a.ladder.reduce((s, l) => s + l.amount, 0)).toBe(350);
    expect(a.ladder.find((l) => l.bucket === "8–30d")!.amount).toBe(50);
    expect(a.ladder.find((l) => l.bucket === "> 180d")!.amount).toBe(0);
  });

  test("floor headroom is entity cash minus its floor, and a breach shows as negative", () => {
    expect(a.floorHeadroom.find((f) => f.entity === "QMS" && f.day === "2026-10-19")!.headroom).toBe(0);
    // Friday floor for QMS is 550 against 400 of cash in this fixture.
    expect(a.floorHeadroom.find((f) => f.entity === "QMS" && f.day === "2026-10-23")!.headroom).toBe(-150);
    expect(a.minHeadroom).toBe(-150);
  });

  test("CSV has one row per allocation and keeps SIM lineage", () => {
    const run = {
      run: { run_id: "r", request_id: "q", received_at: "", request_hash: "h", rate_snapshot_hash: "s", status: "optimal_verified", model_family: "continuous_lp_relaxation", rate_source: "sim", cash_forecast_case: "p50", rate_as_of_date: "2026-10-16", sim_set_id: "SIM-MMKT-2026-10-BASE" },
      currency_results: [result],
    } as unknown as MmktRunResult;
    const lines = allocationsCsv(run).split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("SIM-MMKT-2026-10-BASE");
    expect(lines[1].endsWith(",false")).toBe(true);
  });
});

describe("baselines (owner decision 2026-10-18)", () => {
  const book = demoBook();
  const build = (kind: (typeof BASELINES)[number]["id"]) => buildBaselineInput(kind, book, RATES, "SIM-MMKT-2026-10-BASE", "00000000-0000-4000-8000-000000000000");

  test("all four options exist and the government MMF sweep is the default", () => {
    expect(BASELINES.map((b) => b.id)).toEqual(["government_mmf", "cash", "overnight", "current_allocation"]);
    expect(DEFAULT_BASELINE).toBe("government_mmf");
  });

  test("government MMF sweep restricts the universe to government funds only", () => {
    const r = build("government_mmf");
    if (!("input" in r)) throw new Error("expected an input");
    expect(r.input.instrument_candidates.map((c) => c.instrument_type)).toEqual(["government_mmf"]);
    expect(r.input.policy).toEqual(book.policy);
    expect(r.input.cash_forecast).toEqual(book.forecast);
  });

  test("uninvested cash keeps one anchor candidate capped at zero", () => {
    const r = build("cash");
    if (!("input" in r)) throw new Error("expected an input");
    expect(r.input.instrument_candidates).toHaveLength(1);
    expect(r.input.instrument_candidates[0].maximum_amount).toBe(0);
  });

  test("overnight roll uses only overnight repo and RRP candidates", () => {
    const r = build("overnight");
    if (!("input" in r)) throw new Error("expected an input");
    const types = new Set(r.input.instrument_candidates.map((c) => c.instrument_type));
    expect(types).toEqual(new Set(["fed_rrp", "tri_party_repo"]));
    expect(r.input.instrument_candidates).toHaveLength(18);
  });

  test("current allocation fails closed until a positions feed exists", () => {
    expect(build("current_allocation")).toEqual({ unavailable: expect.stringContaining("positions feed") });
  });

  test("a baseline with no eligible instruments is reported, not guessed", () => {
    const noFund = { ...book, enabled: { ...book.enabled, "GMMF-USG": false } };
    expect(buildBaselineInput("government_mmf", noFund, RATES, "S", "id")).toEqual({ unavailable: expect.stringContaining("government MMF") });
  });

  test("uplift is optimized minus baseline, annualized on the average total balance", () => {
    const holdings = PERIOD_DATES.map((day) => ({ day, cash: 500, invested: 500, byFamily: { government: 500, secured: 0, bank: 0, credit: 0 } }));
    const optimized = { objective: 2, holdings } as unknown as Parameters<typeof compareToBaseline>[0];
    const baseline = { objective: 1.5, holdings } as unknown as Parameters<typeof compareToBaseline>[1];
    const c = compareToBaseline(optimized, baseline, 11);
    expect(c.upliftMm).toBeCloseTo(0.5, 12);
    // 0.5 / 1000 × 365/11 × 10,000 bp
    expect(c.upliftBps).toBeCloseTo((0.5 / 1000) * (365 / 11) * 10_000, 9);
  });
});
