/**
 * MMKT (spec011) client-side contract types, the illustrative request builder, named
 * what-if scenarios, and pure analytics over a verified run result.
 *
 * The model lives in `services/money_market_api` and is reached through
 * `POST /api/econ/mmkt-runs`. Everything here only shapes inputs and reads results; the
 * terminal never computes an allocation itself.
 */

// ── Contract (mirrors services/money_market_api/contracts.py v1.0.0) ────────────────────────

export type InstrumentType =
  | "government_mmf" | "prime_mmf" | "treasury_bill" | "tri_party_repo" | "bilateral_repo"
  | "fed_rrp" | "commercial_paper" | "certificate_of_deposit" | "bank_deposit";

export type ForecastCase = "p10" | "p50" | "p90";

export interface CashForecastPoint {
  period_date: string;
  legal_entity_id: string;
  account_id: string;
  currency: string;
  opening_cash: number;
  known_net_flow: number;
  estimated_residual_p10: number;
  estimated_residual_p50: number;
  estimated_residual_p90: number;
}

export interface InstrumentCandidate {
  candidate_id: string;
  rate_instrument_id: string;
  instrument_type: InstrumentType;
  currency: string;
  issuer_id: string | null;
  counterparty_id: string | null;
  rating: string | null;
  settlement_date: string;
  maturity_date: string;
  cutoff_at: string | null;
  minimum_ticket_amount: number;
  lot_size_amount: number;
  maximum_amount: number | null;
  explicit_cost_bps: number;
}

export interface LiquidityFloor { period_date: string; legal_entity_id: string; currency: string; minimum_cash: number }

export interface ExposureLimit {
  dimension: "issuer" | "counterparty" | "fund" | "rating" | "fed_rrp";
  key: string;
  currency: string;
  maximum_amount: number | null;
  maximum_portfolio_fraction: number | null;
  minimum_rating: string | null;
}

export interface PolicyInputs {
  policy_id: string;
  cash_forecast_case: ForecastCase;
  objective_currency: string | null;
  daily_liquidity_floors: LiquidityFloor[];
  weekly_liquidity_floors: LiquidityFloor[];
  maximum_wam_days: number | null;
  maximum_wal_days: number | null;
  maximum_ticket_count: number | null;
  exposure_limits: ExposureLimit[];
}

/** Client body for /api/econ/mmkt-runs. The terminal attaches the rate snapshot. */
export interface MmktRunInput {
  rate_source: "gold" | "sim";
  sim_set_id?: string;
  request_id: string;
  horizon: { start_date: string; end_date: string; period_dates: string[] };
  cash_forecast: CashForecastPoint[];
  instrument_candidates: InstrumentCandidate[];
  policy: PolicyInputs;
}

export interface AllocationLine {
  candidate_id: string;
  rate_instrument_id: string;
  legal_entity_id: string;
  account_id: string;
  currency: string;
  purchase_date: string;
  settlement_date: string;
  maturity_date: string;
  amount: number;
  mm_yield_pct: number;
  explicit_cost_bps: number;
  modeled_net_return_pct: number;
}

export interface CashBalance { legal_entity_id: string; account_id: string; currency: string; period_date: string; cash: number }

export interface CurrencyResult {
  currency: string;
  objective_value: number;
  backend: string;
  backend_version: string;
  iterations: number | null;
  allocations: AllocationLine[];
  cash_balances: CashBalance[];
  verification: { passed: true; max_variable_bound_violation: number; max_row_violation: number; objective_delta: number };
}

export interface MmktRunResult {
  api_schema_version: "1.0.0";
  code: "SOLVE_COMPLETE";
  correlation_id: string;
  run: {
    run_id: string;
    request_id: string;
    received_at: string;
    request_hash: string;
    rate_snapshot_hash: string;
    status: "optimal_verified";
    model_family: "continuous_lp_relaxation";
    rate_source: "gold" | "sim";
    cash_forecast_case: ForecastCase;
    rate_as_of_date: string;
    sim_set_id: string | null;
  };
  currency_results: CurrencyResult[];
  excluded_currencies: string[];
  execution_ready: false;
  assumptions: string[];
}

export interface MmktRunError {
  code: string;
  message: string;
  [key: string]: unknown;
}

export interface RateRow {
  instrument_id: string;
  quoted_rate_pct: number | null;
  quoted_basis: string | null;
  mm_yield_pct: number | null;
  observation_date: string | null;
  staleness_days: number | null;
  status: string;
  status_detail: string | null;
}

// ── Illustrative book (user inputs, not market data) ─────────────────────────────────────────

export const ENTITY_LABELS: Record<string, string> = {
  QMS: "QM Securities LLC",
  QMP: "QM Prime Services",
};

export const PERIOD_DATES = [
  "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23",
  "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30",
];

interface AccountSeed {
  legal_entity_id: string;
  account_id: string;
  opening: number;
  known: number[];
  residual: [number, number, number]; // p10, p50, p90 per period
}

/** Two operating accounts ($mm). Friday 10-23 carries payroll and tax; 10-30 is month-end. */
export const DEMO_ACCOUNTS: AccountSeed[] = [
  { legal_entity_id: "QMS", account_id: "QMS-OPER-USD", opening: 2400, known: [120, -60, -40, 80, -650, 200, -90, 60, -30, -420], residual: [-80, 0, 60] },
  { legal_entity_id: "QMP", account_id: "QMP-SWEEP-USD", opening: 900, known: [40, -20, 10, -150, 30, 20, -10, -60, 15, -120], residual: [-40, 0, 25] },
];

export interface CandidateMeta { label: string; family: Family; note: string }
export type Family = "government" | "secured" | "bank" | "credit";

export const FAMILY_OF: Record<InstrumentType, Family> = {
  government_mmf: "government", treasury_bill: "government", fed_rrp: "government",
  tri_party_repo: "secured", bilateral_repo: "secured",
  certificate_of_deposit: "bank", bank_deposit: "bank",
  commercial_paper: "credit", prime_mmf: "credit",
};

export const FAMILY_META: Record<Family, { label: string; color: string }> = {
  government: { label: "Government", color: "#3987e5" },
  secured: { label: "Secured repo", color: "#199e70" },
  bank: { label: "Bank", color: "#c98500" },
  credit: { label: "Credit", color: "#d55181" },
};

const usd = (c: Omit<InstrumentCandidate, "currency" | "cutoff_at" | "minimum_ticket_amount" | "lot_size_amount"> & Partial<InstrumentCandidate>): InstrumentCandidate => ({
  currency: "USD", cutoff_at: null, minimum_ticket_amount: 5, lot_size_amount: 1, ...c,
});

/** Candidate universe. Overnight RRP and tri-party repo roll daily as one candidate per day. */
export function demoCandidates(): InstrumentCandidate[] {
  const overnight = PERIOD_DATES.slice(0, -1).flatMap((day, i) => {
    const next = PERIOD_DATES[i + 1];
    return [
      usd({ candidate_id: `RRP-${day}`, rate_instrument_id: "RRPONTSYAWARD", instrument_type: "fed_rrp", issuer_id: null, counterparty_id: "FRBNY", rating: "AAA", settlement_date: day, maturity_date: next, maximum_amount: null, explicit_cost_bps: 0, cutoff_at: `${day}T13:15:00-04:00` }),
      usd({ candidate_id: `TPR-${day}`, rate_instrument_id: "SOFR", instrument_type: "tri_party_repo", issuer_id: null, counterparty_id: "DEALER-A", rating: "A+", settlement_date: day, maturity_date: next, maximum_amount: null, explicit_cost_bps: 0.1, cutoff_at: `${day}T15:00:00-04:00` }),
    ];
  });
  return [
    ...overnight,
    usd({ candidate_id: "TB-4W-1117", rate_instrument_id: "DTB4WK", instrument_type: "treasury_bill", issuer_id: "UST", counterparty_id: null, rating: "AAA", settlement_date: "2026-10-20", maturity_date: "2026-11-17", maximum_amount: null, explicit_cost_bps: 0.2 }),
    usd({ candidate_id: "TB-3M-0121", rate_instrument_id: "DTB3", instrument_type: "treasury_bill", issuer_id: "UST", counterparty_id: null, rating: "AAA", settlement_date: "2026-10-22", maturity_date: "2027-01-21", maximum_amount: null, explicit_cost_bps: 0.2 }),
    usd({ candidate_id: "TB-6M-0422", rate_instrument_id: "DTB6", instrument_type: "treasury_bill", issuer_id: "UST", counterparty_id: null, rating: "AAA", settlement_date: "2026-10-22", maturity_date: "2027-04-22", maximum_amount: null, explicit_cost_bps: 0.2 }),
    usd({ candidate_id: "TB-52W-1014", rate_instrument_id: "DTB1YR", instrument_type: "treasury_bill", issuer_id: "UST", counterparty_id: null, rating: "AAA", settlement_date: "2026-10-22", maturity_date: "2027-10-14", maximum_amount: null, explicit_cost_bps: 0.2 }),
    usd({ candidate_id: "CP-1M-ACME", rate_instrument_id: "DCPF1M", instrument_type: "commercial_paper", issuer_id: "ACME-FIN", counterparty_id: "DEALER-B", rating: "A+", settlement_date: "2026-10-19", maturity_date: "2026-11-18", maximum_amount: 250, explicit_cost_bps: 1.0 }),
    usd({ candidate_id: "CP-3M-BETA", rate_instrument_id: "DCPN3M", instrument_type: "commercial_paper", issuer_id: "BETA-IND", counterparty_id: "DEALER-B", rating: "AA-", settlement_date: "2026-10-19", maturity_date: "2027-01-19", maximum_amount: 200, explicit_cost_bps: 1.0 }),
    usd({ candidate_id: "CD-3M-BANKA", rate_instrument_id: "CD.3M", instrument_type: "certificate_of_deposit", issuer_id: "BANK-A", counterparty_id: "BANK-A", rating: "AA-", settlement_date: "2026-10-19", maturity_date: "2027-01-19", maximum_amount: 300, explicit_cost_bps: 0.5 }),
    usd({ candidate_id: "GMMF-USG", rate_instrument_id: "MMF.GOVT.7D", instrument_type: "government_mmf", issuer_id: "GOVT-FUND-1", counterparty_id: null, rating: "AAA", settlement_date: "2026-10-19", maturity_date: "2026-10-30", maximum_amount: null, explicit_cost_bps: 0 }),
    usd({ candidate_id: "PMMF-INST", rate_instrument_id: "MMF.PRIME.7D", instrument_type: "prime_mmf", issuer_id: "PRIME-FUND-X", counterparty_id: null, rating: "A", settlement_date: "2026-10-19", maturity_date: "2026-10-30", maximum_amount: 400, explicit_cost_bps: 0 }),
    usd({ candidate_id: "DEP-BANKB", rate_instrument_id: "DEP.ON", instrument_type: "bank_deposit", issuer_id: "BANK-B", counterparty_id: "BANK-B", rating: "A", settlement_date: "2026-10-19", maturity_date: "2026-10-30", maximum_amount: null, explicit_cost_bps: 0 }),
  ];
}

export function demoPolicy(): PolicyInputs {
  const fridays = new Set(["2026-10-23", "2026-10-30"]);
  const floors = (entity: string, daily: number, weekly: number) => ({
    daily: PERIOD_DATES.filter((d) => !fridays.has(d)).map((d) => ({ period_date: d, legal_entity_id: entity, currency: "USD", minimum_cash: daily })),
    weekly: PERIOD_DATES.filter((d) => fridays.has(d)).map((d) => ({ period_date: d, legal_entity_id: entity, currency: "USD", minimum_cash: weekly })),
  });
  const qms = floors("QMS", 400, 550);
  const qmp = floors("QMP", 120, 160);
  return {
    policy_id: "ILLUSTRATIVE-TREASURY-POLICY-1",
    cash_forecast_case: "p50",
    objective_currency: null,
    daily_liquidity_floors: [...qms.daily, ...qmp.daily],
    weekly_liquidity_floors: [...qms.weekly, ...qmp.weekly],
    maximum_wam_days: 60,
    maximum_wal_days: 90,
    maximum_ticket_count: null,
    exposure_limits: [
      { dimension: "rating", key: "portfolio", currency: "USD", maximum_amount: null, maximum_portfolio_fraction: null, minimum_rating: "A-" },
      { dimension: "fed_rrp", key: "fed_rrp", currency: "USD", maximum_amount: 900, maximum_portfolio_fraction: null, minimum_rating: null },
      { dimension: "counterparty", key: "DEALER-A", currency: "USD", maximum_amount: null, maximum_portfolio_fraction: 0.35, minimum_rating: null },
      { dimension: "issuer", key: "ACME-FIN", currency: "USD", maximum_amount: 250, maximum_portfolio_fraction: null, minimum_rating: null },
      { dimension: "fund", key: "PMMF-INST", currency: "USD", maximum_amount: null, maximum_portfolio_fraction: 0.25, minimum_rating: null },
    ],
  };
}

/** Build a cash forecast whose opening balances continue the p50 path, as the service requires. */
export function demoCashForecast(accounts: AccountSeed[] = DEMO_ACCOUNTS): CashForecastPoint[] {
  return accounts.flatMap((acct) => {
    let opening = acct.opening;
    return PERIOD_DATES.map((day, i) => {
      const point: CashForecastPoint = {
        period_date: day,
        legal_entity_id: acct.legal_entity_id,
        account_id: acct.account_id,
        currency: "USD",
        opening_cash: round2(opening),
        known_net_flow: acct.known[i],
        estimated_residual_p10: acct.residual[0],
        estimated_residual_p50: acct.residual[1],
        estimated_residual_p90: acct.residual[2],
      };
      opening += acct.known[i] + acct.residual[1];
      return point;
    });
  });
}

export interface BookInputs {
  candidates: InstrumentCandidate[];
  enabled: Record<string, boolean>;
  forecast: CashForecastPoint[];
  policy: PolicyInputs;
}

export function demoBook(): BookInputs {
  const candidates = demoCandidates();
  return {
    candidates,
    enabled: Object.fromEntries(candidates.map((c) => [c.candidate_id, true])),
    forecast: demoCashForecast(),
    policy: demoPolicy(),
  };
}

/**
 * Candidates that can enter a run: enabled by the user and priced by an ok, normalized rate.
 * Non-ok rows stay visible in the UI but never enter the request (fail-closed pricing).
 */
export function runnableCandidates(book: BookInputs, rates: RateRow[] | null): InstrumentCandidate[] {
  const ok = new Set((rates ?? []).filter((r) => r.status === "ok" && r.mm_yield_pct !== null).map((r) => r.instrument_id));
  return book.candidates.filter((c) => book.enabled[c.candidate_id] && ok.has(c.rate_instrument_id));
}

export function buildRunInput(book: BookInputs, rates: RateRow[] | null, simSetId: string, requestId: string): MmktRunInput {
  return {
    rate_source: "sim",
    sim_set_id: simSetId,
    request_id: requestId,
    horizon: { start_date: PERIOD_DATES[0], end_date: PERIOD_DATES[PERIOD_DATES.length - 1], period_dates: PERIOD_DATES },
    cash_forecast: book.forecast,
    instrument_candidates: runnableCandidates(book, rates),
    policy: book.policy,
  };
}

// ── Named what-if scenarios (spec011 MM-007) ──────────────────────────────────────────────────

export interface MmktScenario {
  id: string;
  title: string;
  kicker: string;
  narrative: string;
  simSetId: string;
  apply: (book: BookInputs) => BookInputs;
}

export const BASE_SET = "SIM-MMKT-2026-10-BASE";
export const CUT_SET = "SIM-MMKT-2026-10-CUT25";

const mapCandidates = (book: BookInputs, f: (c: InstrumentCandidate) => InstrumentCandidate): BookInputs => ({ ...book, candidates: book.candidates.map(f) });

export const MMKT_SCENARIOS: MmktScenario[] = [
  {
    id: "base", title: "Base case", kicker: "Base", simSetId: BASE_SET,
    narrative: "The p50 cash forecast on the SIM base curve. Liquidity floors, a 60-day WAM cap and exposure limits shape where surplus cash goes.",
    apply: (book) => book,
  },
  {
    id: "rate-cut", title: "Rate cut priced", kicker: "Rates", simSetId: CUT_SET,
    narrative: "A 25bp cut priced into the curve: overnight rates fall the most and term bills the least, so term instruments gain relative value.",
    apply: (book) => book,
  },
  {
    id: "fund-fee-gate", title: "Prime fund fee & gate", kicker: "Fund stress", simSetId: BASE_SET,
    narrative: "The prime fund imposes a 25bp liquidity fee and caps new subscriptions at $100mm. Cash moves to government funds and bills.",
    apply: (book) => mapCandidates(book, (c) => (c.instrument_type === "prime_mmf" ? { ...c, explicit_cost_bps: c.explicit_cost_bps + 25, maximum_amount: 100 } : c)),
  },
  {
    id: "forecast-miss", title: "Cash forecast miss", kicker: "Forecast", simSetId: BASE_SET,
    narrative: "Residual flows come in at the p10 downside every day. Less surplus is available, and floors bind sooner.",
    apply: (book) => ({ ...book, policy: { ...book.policy, cash_forecast_case: "p10" } }),
  },
  {
    id: "downgrade", title: "Counterparty downgrade", kicker: "Credit", simSetId: BASE_SET,
    narrative: "The tri-party dealer is cut to BBB and the CP issuer to BBB+. Both fall below the A− floor and are excluded, so cash moves to RRP and bills.",
    apply: (book) => mapCandidates(book, (c) =>
      c.counterparty_id === "DEALER-A" ? { ...c, rating: "BBB" } : c.issuer_id === "ACME-FIN" ? { ...c, rating: "BBB+" } : c),
  },
];

// ── Analytics over a verified result ──────────────────────────────────────────────────────────

export interface RunAnalytics {
  currency: string;
  objective: number;
  grossPurchases: number;
  avgInvested: number;
  annualizedReturnPct: number;
  holdings: { day: string; cash: number; byFamily: Record<Family, number>; invested: number }[];
  ladder: { bucket: string; amount: number }[];
  heldAtEnd: number;
  floorHeadroom: { entity: string; day: string; cash: number; floor: number; headroom: number }[];
  minHeadroom: number | null;
  byFamilyPurchases: Record<Family, number>;
  lines: number;
}

const LADDER = [
  { bucket: "≤ 7d", max: 7 },
  { bucket: "8–30d", max: 30 },
  { bucket: "31–90d", max: 90 },
  { bucket: "91–180d", max: 180 },
  { bucket: "> 180d", max: Infinity },
];

export function analyzeCurrency(result: CurrencyResult, input: MmktRunInput): RunAnalytics {
  const types = new Map(input.instrument_candidates.map((c) => [c.candidate_id, c.instrument_type]));
  const days = input.horizon.period_dates;
  const end = input.horizon.end_date;
  const familyZero = (): Record<Family, number> => ({ government: 0, secured: 0, bank: 0, credit: 0 });

  const holdings = days.map((day) => {
    const byFamily = familyZero();
    for (const a of result.allocations) {
      if (a.purchase_date <= day && day < a.maturity_date) byFamily[FAMILY_OF[types.get(a.candidate_id) ?? "bank_deposit"]] += a.amount;
    }
    const cash = result.cash_balances.filter((b) => b.period_date === day).reduce((s, b) => s + b.cash, 0);
    const invested = Object.values(byFamily).reduce((s, v) => s + v, 0);
    return { day, cash, byFamily, invested };
  });

  const ladderTotals = LADDER.map((b) => ({ bucket: b.bucket, amount: 0 }));
  let heldAtEnd = 0;
  for (const a of result.allocations) {
    if (a.maturity_date <= end) continue;
    const daysOut = dayDiff(end, a.maturity_date);
    const idx = LADDER.findIndex((b) => daysOut <= b.max);
    ladderTotals[idx].amount += a.amount;
    heldAtEnd += a.amount;
  }

  const floors = [...input.policy.daily_liquidity_floors, ...input.policy.weekly_liquidity_floors].filter((f) => f.currency === result.currency);
  const floorHeadroom = floors.map((f) => {
    const cash = result.cash_balances.filter((b) => b.legal_entity_id === f.legal_entity_id && b.period_date === f.period_date).reduce((s, b) => s + b.cash, 0);
    return { entity: f.legal_entity_id, day: f.period_date, cash, floor: f.minimum_cash, headroom: cash - f.minimum_cash };
  }).sort((a, b) => a.day.localeCompare(b.day) || a.entity.localeCompare(b.entity));

  const byFamilyPurchases = familyZero();
  for (const a of result.allocations) byFamilyPurchases[FAMILY_OF[types.get(a.candidate_id) ?? "bank_deposit"]] += a.amount;

  const avgInvested = holdings.reduce((s, h) => s + h.invested, 0) / Math.max(1, holdings.length);
  const horizonDays = Math.max(1, dayDiff(input.horizon.start_date, end));
  return {
    currency: result.currency,
    objective: result.objective_value,
    grossPurchases: result.allocations.reduce((s, a) => s + a.amount, 0),
    avgInvested,
    annualizedReturnPct: avgInvested > 0 ? (result.objective_value / avgInvested) * (365 / horizonDays) * 100 : 0,
    holdings,
    ladder: ladderTotals,
    heldAtEnd,
    floorHeadroom,
    minHeadroom: floorHeadroom.length ? Math.min(...floorHeadroom.map((f) => f.headroom)) : null,
    byFamilyPurchases,
    lines: result.allocations.length,
  };
}

/** CSV of the LP allocation lines exactly as returned (one row per line, stable order). */
export function allocationsCsv(result: MmktRunResult): string {
  const header = ["run_id", "rate_snapshot_hash", "rate_source", "sim_set_id", "cash_forecast_case", "currency", "purchase_date", "candidate_id", "rate_instrument_id", "legal_entity_id", "account_id", "settlement_date", "maturity_date", "amount", "mm_yield_pct", "explicit_cost_bps", "modeled_net_return_pct", "execution_ready"];
  const rows = result.currency_results.flatMap((cr) => cr.allocations.map((a) => [
    result.run.run_id, result.run.rate_snapshot_hash, result.run.rate_source, result.run.sim_set_id ?? "", result.run.cash_forecast_case,
    a.currency, a.purchase_date, a.candidate_id, a.rate_instrument_id, a.legal_entity_id, a.account_id, a.settlement_date, a.maturity_date,
    a.amount, a.mm_yield_pct, a.explicit_cost_bps, a.modeled_net_return_pct, "false",
  ]));
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function round2(v: number): number { return Math.round(v * 100) / 100; }

/** Guidance for each failure code the run route or service can return. */
export function explainRunError(err: MmktRunError): { title: string; fix: string } {
  switch (err.code) {
    case "MMKT_TOKEN_MISSING": return { title: "The terminal has no service token", fix: "Set MONEY_MARKET_API_TOKEN in .env.local (same value as the service) and restart the dev server." };
    case "MMKT_SERVICE_UNAVAILABLE": return { title: "The MMKT service is not reachable", fix: "Start services/money_market_api on port 8014 (see the setup panel)." };
    case "MODEL_NOT_CONFIGURED": return { title: "The service has no model binding", fix: "Start the service with MONEY_MARKET_MODEL_BINDING=local-mmkt-lp-v1." };
    case "INFEASIBLE": return { title: "No feasible allocation", fix: "Cash floors cannot be met with this forecast and universe. No allocation is shown. Lower a floor or switch to a less severe forecast case." };
    case "RATE_CANDIDATES_INELIGIBLE": return { title: "A candidate has no eligible rate", fix: "Only status=ok rows with a normalized mm_yield_pct can be priced. Disable the flagged candidates." };
    case "SIM_SET_UNAVAILABLE": return { title: "SIM set not registered", fix: "Choose one of the registered SIM sets." };
    case "MODEL_INPUT_UNSUPPORTED": return { title: "The model rejected an input", fix: String(err.message) };
    case "REQUEST_CONTRACT_INVALID": return { title: "The request failed contract validation", fix: "See the issue list below." };
    case "VERIFICATION_FAILED": return { title: "The verifier rejected the solver output", fix: "No allocation is shown. Report the request hash." };
    default: return { title: err.code, fix: String(err.message ?? "") };
  }
}
