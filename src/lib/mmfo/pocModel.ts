export type LiquidityBucket = "SAME_DAY" | "NEXT_DAY";
export type FundType = "GOVERNMENT" | "PRIME";

export interface FundOption {
  id: string;
  name: string;
  fund_type: FundType;
  liquidity: LiquidityBucket;
  net_7day_yield_pct: number;
}

export const POC_FUND_UNIVERSE: FundOption[] = [
  { id: "GOV-SD-01", name: "Treasury Government Liquidity", fund_type: "GOVERNMENT", liquidity: "SAME_DAY", net_7day_yield_pct: 4.78 },
  { id: "GOV-SD-02", name: "Government Cash Reserve", fund_type: "GOVERNMENT", liquidity: "SAME_DAY", net_7day_yield_pct: 4.72 },
  { id: "GOV-ND-01", name: "Treasury Liquidity Portfolio", fund_type: "GOVERNMENT", liquidity: "NEXT_DAY", net_7day_yield_pct: 4.91 },
  { id: "PRM-SD-01", name: "Institutional Prime Liquidity", fund_type: "PRIME", liquidity: "SAME_DAY", net_7day_yield_pct: 5.12 },
  { id: "PRM-ND-01", name: "Institutional Prime Cash", fund_type: "PRIME", liquidity: "NEXT_DAY", net_7day_yield_pct: 5.28 },
  { id: "PRM-ND-02", name: "Prime Treasury Plus", fund_type: "PRIME", liquidity: "NEXT_DAY", net_7day_yield_pct: 5.19 },
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
