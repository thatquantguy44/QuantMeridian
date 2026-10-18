export type LiquidityBucket = "SAME_DAY" | "NEXT_DAY";
export type FundType = "GOVERNMENT" | "PRIME";

export interface FundOption {
  id: string;
  name: string;
  fund_type: FundType;
  liquidity: LiquidityBucket;
  gross_7day_yield_pct: number;
  expense_ratio_pct: number;
  net_7day_yield_pct: number;
  aum_usd_bn: number;
  wam_days: number;
  wal_days: number;
  daily_liquid_assets_pct: number;
  weekly_liquid_assets_pct: number;
  treasury_assets_pct: number;
  repo_assets_pct: number;
  agency_assets_pct: number;
  other_assets_pct: number;
  snapshot_as_of: string;
}

// Fictional share classes and a fixed illustrative snapshot. Values are internally
// coherent for demos, but are not sourced from actual funds or market feeds.
export const POC_DATASET_ID = "mmfo-demo-us-institutional-2026-10-16";
export const POC_DATASET_AS_OF = "2026-10-16";
export const POC_FUND_UNIVERSE: FundOption[] = [
  { id: "GOV-TRE-01", name: "Treasury Select Institutional", fund_type: "GOVERNMENT", liquidity: "SAME_DAY", gross_7day_yield_pct: 4.72, expense_ratio_pct: 0.08, net_7day_yield_pct: 4.64, aum_usd_bn: 38.4, wam_days: 24, wal_days: 41, daily_liquid_assets_pct: 63, weekly_liquid_assets_pct: 82, treasury_assets_pct: 94, repo_assets_pct: 6, agency_assets_pct: 0, other_assets_pct: 0, snapshot_as_of: POC_DATASET_AS_OF },
  { id: "GOV-INS-02", name: "Government Liquidity Institutional", fund_type: "GOVERNMENT", liquidity: "SAME_DAY", gross_7day_yield_pct: 4.79, expense_ratio_pct: 0.13, net_7day_yield_pct: 4.66, aum_usd_bn: 52.7, wam_days: 31, wal_days: 57, daily_liquid_assets_pct: 58, weekly_liquid_assets_pct: 76, treasury_assets_pct: 71, repo_assets_pct: 25, agency_assets_pct: 4, other_assets_pct: 0, snapshot_as_of: POC_DATASET_AS_OF },
  { id: "GOV-SD-03", name: "Government Short Duration Institutional", fund_type: "GOVERNMENT", liquidity: "NEXT_DAY", gross_7day_yield_pct: 4.77, expense_ratio_pct: 0.10, net_7day_yield_pct: 4.67, aum_usd_bn: 21.6, wam_days: 39, wal_days: 72, daily_liquid_assets_pct: 45, weekly_liquid_assets_pct: 68, treasury_assets_pct: 64, repo_assets_pct: 28, agency_assets_pct: 8, other_assets_pct: 0, snapshot_as_of: POC_DATASET_AS_OF },
  { id: "GOV-TRE-04", name: "Treasury Liquidity Portfolio Institutional", fund_type: "GOVERNMENT", liquidity: "NEXT_DAY", gross_7day_yield_pct: 4.73, expense_ratio_pct: 0.07, net_7day_yield_pct: 4.66, aum_usd_bn: 16.9, wam_days: 28, wal_days: 49, daily_liquid_assets_pct: 52, weekly_liquid_assets_pct: 78, treasury_assets_pct: 89, repo_assets_pct: 11, agency_assets_pct: 0, other_assets_pct: 0, snapshot_as_of: POC_DATASET_AS_OF },
  { id: "PRM-INS-01", name: "Prime Institutional Cash Class A", fund_type: "PRIME", liquidity: "SAME_DAY", gross_7day_yield_pct: 5.08, expense_ratio_pct: 0.18, net_7day_yield_pct: 4.90, aum_usd_bn: 34.2, wam_days: 36, wal_days: 79, daily_liquid_assets_pct: 52, weekly_liquid_assets_pct: 71, treasury_assets_pct: 3, repo_assets_pct: 31, agency_assets_pct: 10, other_assets_pct: 56, snapshot_as_of: POC_DATASET_AS_OF },
  { id: "PRM-DLY-02", name: "Prime Daily Liquidity Institutional", fund_type: "PRIME", liquidity: "SAME_DAY", gross_7day_yield_pct: 5.13, expense_ratio_pct: 0.20, net_7day_yield_pct: 4.93, aum_usd_bn: 27.8, wam_days: 32, wal_days: 66, daily_liquid_assets_pct: 57, weekly_liquid_assets_pct: 74, treasury_assets_pct: 5, repo_assets_pct: 45, agency_assets_pct: 8, other_assets_pct: 42, snapshot_as_of: POC_DATASET_AS_OF },
  { id: "PRM-CASH-03", name: "Prime Cash Portfolio Institutional", fund_type: "PRIME", liquidity: "NEXT_DAY", gross_7day_yield_pct: 5.18, expense_ratio_pct: 0.22, net_7day_yield_pct: 4.96, aum_usd_bn: 18.3, wam_days: 43, wal_days: 91, daily_liquid_assets_pct: 39, weekly_liquid_assets_pct: 63, treasury_assets_pct: 0, repo_assets_pct: 36, agency_assets_pct: 12, other_assets_pct: 52, snapshot_as_of: POC_DATASET_AS_OF },
  { id: "GOV-SWEEP-04", name: "Treasury Government Sweep Institutional", fund_type: "GOVERNMENT", liquidity: "SAME_DAY", gross_7day_yield_pct: 4.74, expense_ratio_pct: 0.08, net_7day_yield_pct: 4.66, aum_usd_bn: 9.8, wam_days: 19, wal_days: 33, daily_liquid_assets_pct: 71, weekly_liquid_assets_pct: 88, treasury_assets_pct: 96, repo_assets_pct: 4, agency_assets_pct: 0, other_assets_pct: 0, snapshot_as_of: POC_DATASET_AS_OF },
];

export interface PocOptimizerInput {
  total_cash: number;
  cash_reserve_pct: number;
  min_same_day_pct: number;
  max_prime_pct: number;
  max_single_fund_pct: number;
}

interface LinearConstraint {
  label: string;
  coefficients: number[];
  bound: number;
}

export interface FundAllocation {
  fund: FundOption;
  allocated_amount: number;
  portfolio_weight_pct: number;
  estimated_annual_income: number;
}

function validateInput(input: PocOptimizerInput): void {
  if (!Number.isFinite(input.total_cash) || input.total_cash < 100) {
    throw new Error("Total cash must be at least $100.");
  }
  for (const [label, value] of [
    ["Cash reserve", input.cash_reserve_pct],
    ["Minimum same-day liquidity", input.min_same_day_pct],
    ["Maximum prime exposure", input.max_prime_pct],
    ["Maximum single-fund allocation", input.max_single_fund_pct],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(label + " must be between 0% and 100%.");
    }
  }
  if (input.cash_reserve_pct >= 100) throw new Error("Cash reserve must leave an amount to invest.");
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col];
    for (let j = col; j <= n; j += 1) a[col][j] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row[n]);
}

function combinations<T>(items: T[], count: number): T[][] {
  const output: T[][] = [];
  const selected: T[] = [];
  function visit(start: number) {
    if (selected.length === count) {
      output.push([...selected]);
      return;
    }
    const needed = count - selected.length;
    for (let i = start; i <= items.length - needed; i += 1) {
      selected.push(items[i]);
      visit(i + 1);
      selected.pop();
    }
  }
  visit(0);
  return output;
}

/** Small, deterministic vertex-enumeration LP for the illustrative six-fund POC universe. */
export function optimizeFundAllocation(input: PocOptimizerInput) {
  validateInput(input);
  const funds = POC_FUND_UNIVERSE;
  const n = funds.length;
  const investable = input.total_cash * (1 - input.cash_reserve_pct / 100);
  const constraints: LinearConstraint[] = [];

  funds.forEach((fund, index) => {
    const unit = funds.map((_, i) => (i === index ? 1 : 0));
    constraints.push({ label: "fund_max_" + fund.id, coefficients: unit, bound: investable * input.max_single_fund_pct / 100 });
    constraints.push({ label: "fund_min_" + fund.id, coefficients: unit.map((x) => -x), bound: 0 });
  });

  constraints.push({
    label: "prime_exposure_max",
    coefficients: funds.map((fund) => (fund.fund_type === "PRIME" ? 1 : 0)),
    bound: investable * input.max_prime_pct / 100,
  });
  constraints.push({
    label: "same_day_liquidity_min",
    coefficients: funds.map((fund) => (fund.liquidity === "SAME_DAY" ? -1 : 0)),
    bound: -investable * input.min_same_day_pct / 100,
  });

  const totalRow = funds.map(() => 1);
  let best: number[] | null = null;
  let bestYield = Number.NEGATIVE_INFINITY;
  for (const active of combinations(constraints, n - 1)) {
    const candidate = solveLinearSystem(
      [totalRow, ...active.map((constraint) => constraint.coefficients)],
      [investable, ...active.map((constraint) => constraint.bound)],
    );
    if (!candidate) continue;
    const feasible = constraints.every((constraint) => {
      const lhs = constraint.coefficients.reduce((sum, coefficient, i) => sum + coefficient * candidate[i], 0);
      return lhs <= constraint.bound + 0.01;
    });
    if (!feasible || candidate.some((value) => value < -0.01)) continue;
    const weightedYield = candidate.reduce((sum, amount, i) => sum + amount * funds[i].net_7day_yield_pct, 0) / investable;
    if (weightedYield > bestYield) {
      best = candidate.map((value) => Math.max(0, value));
      bestYield = weightedYield;
    }
  }

  if (!best) {
    throw new Error("These limits cannot be satisfied together. Reduce the same-day minimum or prime cap, or raise the per-fund cap.");
  }

  const allocations: FundAllocation[] = funds.map((fund, i) => ({
    fund,
    allocated_amount: best![i],
    portfolio_weight_pct: best![i] / investable * 100,
    estimated_annual_income: best![i] * fund.net_7day_yield_pct / 100,
  }));
  const allocated = best.reduce((sum, value) => sum + value, 0);
  const sameDayAmount = allocations.reduce((sum, row) => sum + (row.fund.liquidity === "SAME_DAY" ? row.allocated_amount : 0), 0);
  const primeAmount = allocations.reduce((sum, row) => sum + (row.fund.fund_type === "PRIME" ? row.allocated_amount : 0), 0);
  const checks = [
    { check: "Investable cash fully allocated", passed: Math.abs(allocated - investable) <= 0.01, observed: allocated, required: investable },
    { check: "Same-day liquidity minimum", passed: sameDayAmount + 0.01 >= investable * input.min_same_day_pct / 100, observed: sameDayAmount / investable * 100, required: input.min_same_day_pct },
    { check: "Prime exposure maximum", passed: primeAmount <= investable * input.max_prime_pct / 100 + 0.01, observed: primeAmount / investable * 100, required: input.max_prime_pct },
    { check: "Single-fund allocation maximum", passed: allocations.every((row) => row.portfolio_weight_pct <= input.max_single_fund_pct + 0.01), observed: Math.max(...allocations.map((row) => row.portfolio_weight_pct)), required: input.max_single_fund_pct },
  ];
  if (checks.some((check) => !check.passed)) throw new Error("POC allocation failed a constraint check.");

  const weightedNetYield = allocations.reduce((sum, row) => sum + row.allocated_amount * row.fund.net_7day_yield_pct, 0) / investable;
  const reserveAmount = input.total_cash - investable;
  return {
    model_id: "mmfo-synthetic-lp-v1",
    model_status: "POC_OPTIMAL" as const,
    source_mode: "SIM" as const,
    synthetic_mode: true as const,
    dataset_id: POC_DATASET_ID,
    dataset_as_of: POC_DATASET_AS_OF,
    independent_verification: "NOT_PROVIDED" as const,
    total_cash: input.total_cash,
    cash_reserve_amount: reserveAmount,
    investable_amount: investable,
    allocated_amount: allocated,
    estimated_weighted_net_yield_pct: weightedNetYield,
    estimated_annual_income: weightedNetYield / 100 * investable,
    same_day_liquidity_amount: sameDayAmount,
    same_day_liquidity_pct: sameDayAmount / investable * 100,
    prime_exposure_amount: primeAmount,
    prime_exposure_pct: primeAmount / investable * 100,
    fund_universe: funds,
    allocations,
    checks,
    limitations: [
      "Illustrative synthetic fund yields and liquidity labels; not live market data.",
      "The objective is a simple annualized net-yield proxy and does not model fees beyond the supplied net yield.",
      "No sponsor eligibility, NAV, credit, tax, regulatory, settlement, or investor-specific restrictions are represented.",
      "POC constraint checks are not an independent verifier; results are not investment recommendations.",
    ],
  };
}
