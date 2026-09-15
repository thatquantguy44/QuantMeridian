/**
 * MCS — Monte Carlo curve simulation engine.
 *
 * Fits a VAR(1) on the Nelson-Siegel factor history (β0 level, β1 slope,
 * β2 curvature) from `gold.yield_curve_ns_factors`, then simulates forward
 * paths by residual bootstrap (drawing historical factor shocks jointly,
 * not per-factor, so the level/slope/curvature covariance the desk actually
 * observes is preserved rather than assumed Gaussian). Each simulated factor
 * path is reconstructed into a full yield curve via the NS loading functions,
 * so any tenor's terminal distribution is available, not just the fitted ones.
 *
 * This is a genuine forecast built from real curve dynamics, not a canned
 * random walk — but it is a bootstrap over one historical sample, and some
 * regimes in that sample (e.g. 1970s stagflation) occurred once. Treat the
 * tails as "what has happened," not "what will happen."
 */

export interface NsFactorRow {
  observation_date: string;
  beta0: number;
  beta1: number;
  beta2: number;
  lambda: number;
  fit_valid: number;
}

export interface Var1Fit {
  /** 3x4: [intercept, coef_on_beta0, coef_on_beta1, coef_on_beta2] per equation. */
  coefficients: number[][];
  /** R² per equation (beta0, beta1, beta2). */
  rSquared: number[];
  /** Residuals, one row per fitted observation, columns [e_beta0, e_beta1, e_beta2]. */
  residuals: number[][];
  /** Last observed factor vector — the simulation's anchor point. */
  lastFactors: [number, number, number];
  avgLambda: number;
  fitObservations: number;
  fitStartDate: string;
  fitEndDate: string;
}

// ---------------------------------------------------------------------------
// Small linear algebra — hand-rolled since the systems here never exceed 4x4.
// ---------------------------------------------------------------------------

/** Solve Ax = b via Gaussian elimination with partial pivoting. A is n×n, b is n. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const pv = M[col][col];
    if (Math.abs(pv) < 1e-12) continue; // singular direction — leave as zero contribution
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / pv;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

/** Mulberry32 — small, fast, seedable PRNG (deterministic runs for a given seed). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// VAR(1) fit
// ---------------------------------------------------------------------------

/**
 * Fit a first-order vector autoregression on the three NS factors.
 * `rows` must be sorted ascending by date and already restricted to the
 * desired fit window (e.g. trailing N years) by the caller.
 */
export function fitVar1(rows: NsFactorRow[]): Var1Fit {
  const valid = rows.filter((r) => r.fit_valid === 1);
  if (valid.length < 30) {
    throw new Error(`insufficient fitted NS observations for a VAR(1) (${valid.length} rows, need >= 30)`);
  }

  const n = valid.length - 1; // one lag consumed
  // Design matrix: [1, beta0_{t-1}, beta1_{t-1}, beta2_{t-1}]
  const X: number[][] = new Array(n);
  const Y: number[][] = new Array(n); // [beta0_t, beta1_t, beta2_t]
  for (let t = 1; t < valid.length; t++) {
    const prev = valid[t - 1];
    const cur = valid[t];
    X[t - 1] = [1, prev.beta0, prev.beta1, prev.beta2];
    Y[t - 1] = [cur.beta0, cur.beta1, cur.beta2];
  }

  // Normal equations: (X'X) w = X'y, solved per equation.
  const XtX: number[][] = Array.from({ length: 4 }, () => new Array(4).fill(0));
  for (const row of X) {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) XtX[i][j] += row[i] * row[j];
    }
  }

  const coefficients: number[][] = [];
  const residuals: number[][] = Array.from({ length: n }, () => [0, 0, 0]);
  const rSquared: number[] = [];

  for (let eq = 0; eq < 3; eq++) {
    const Xty = new Array(4).fill(0);
    for (let t = 0; t < n; t++) {
      for (let i = 0; i < 4; i++) Xty[i] += X[t][i] * Y[t][eq];
    }
    const w = solveLinear(
      XtX.map((r) => [...r]),
      Xty
    );
    coefficients.push(w);

    const yMean = Y.reduce((s, row) => s + row[eq], 0) / n;
    let ssRes = 0;
    let ssTot = 0;
    for (let t = 0; t < n; t++) {
      const pred = w[0] + w[1] * X[t][1] + w[2] * X[t][2] + w[3] * X[t][3];
      const resid = Y[t][eq] - pred;
      residuals[t][eq] = resid;
      ssRes += resid * resid;
      ssTot += (Y[t][eq] - yMean) ** 2;
    }
    rSquared.push(ssTot > 0 ? 1 - ssRes / ssTot : 0);
  }

  const last = valid[valid.length - 1];
  const avgLambda = valid.reduce((s, r) => s + r.lambda, 0) / valid.length;

  return {
    coefficients,
    rSquared,
    residuals,
    lastFactors: [last.beta0, last.beta1, last.beta2],
    avgLambda,
    fitObservations: n,
    fitStartDate: valid[0].observation_date,
    fitEndDate: last.observation_date,
  };
}

// ---------------------------------------------------------------------------
// Nelson-Siegel curve reconstruction
// ---------------------------------------------------------------------------

/** Yield at tenor τ (years) from NS factors. */
export function nsYield(beta0: number, beta1: number, beta2: number, lambda: number, tenorYears: number): number {
  const x = tenorYears / lambda;
  const decay = Math.exp(-x);
  const loading = x < 1e-6 ? 1 : (1 - decay) / x;
  return beta0 + beta1 * loading + beta2 * (loading - decay);
}

// ---------------------------------------------------------------------------
// Monte Carlo simulation
// ---------------------------------------------------------------------------

export interface SimulationConfig {
  numPaths: number;
  horizonDays: number;
  /** Trading-day checkpoints at which percentiles are reported, e.g. [21, 63, 126, 252]. */
  checkpoints: number[];
  tenors: number[];
  seed?: number;
}

export interface HorizonPercentiles {
  horizonDays: number;
  /** tenorYears -> {p5,p25,p50,p75,p95} in percent. */
  byTenor: Record<number, { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number }>;
}

export interface SimulationResult {
  fit: Var1Fit;
  config: SimulationConfig;
  horizons: HorizonPercentiles[];
  /** Current (t=0) yield at each requested tenor, from the last observed factors. */
  currentCurve: Record<number, number>;
}

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/**
 * Simulate `numPaths` forward factor paths from `fit.lastFactors` using a
 * residual bootstrap (each step draws one historical shock vector jointly
 * across all three factors, preserving their observed covariance), then
 * reconstructs yields at the requested tenors at each checkpoint horizon.
 */
export function simulate(fit: Var1Fit, config: SimulationConfig): SimulationResult {
  const rng = mulberry32(config.seed ?? 20260914);
  const { coefficients, residuals, lastFactors, avgLambda } = fit;
  const checkpointSet = new Set(config.checkpoints);
  const maxHorizon = Math.max(...config.checkpoints, config.horizonDays);

  // horizon -> tenor -> array of simulated yields across all paths
  const collected = new Map<number, Map<number, number[]>>();
  for (const h of config.checkpoints) {
    collected.set(h, new Map(config.tenors.map((t) => [t, []])));
  }

  for (let p = 0; p < config.numPaths; p++) {
    let f: [number, number, number] = [...lastFactors];
    for (let step = 1; step <= maxHorizon; step++) {
      const shockIdx = Math.floor(rng() * residuals.length);
      const shock = residuals[shockIdx];
      const next: [number, number, number] = [0, 0, 0];
      for (let eq = 0; eq < 3; eq++) {
        const w = coefficients[eq];
        next[eq] = w[0] + w[1] * f[0] + w[2] * f[1] + w[3] * f[2] + shock[eq];
      }
      f = next;

      if (checkpointSet.has(step)) {
        const byTenor = collected.get(step)!;
        for (const tenor of config.tenors) {
          byTenor.get(tenor)!.push(nsYield(f[0], f[1], f[2], avgLambda, tenor));
        }
      }
    }
  }

  const horizons: HorizonPercentiles[] = config.checkpoints.map((h) => {
    const byTenor: HorizonPercentiles["byTenor"] = {};
    const tenorMap = collected.get(h)!;
    for (const tenor of config.tenors) {
      const vals = tenorMap.get(tenor)!.slice().sort((a, b) => a - b);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      byTenor[tenor] = {
        p5: percentile(vals, 5),
        p25: percentile(vals, 25),
        p50: percentile(vals, 50),
        p75: percentile(vals, 75),
        p95: percentile(vals, 95),
        mean,
      };
    }
    return { horizonDays: h, byTenor };
  });

  const currentCurve: Record<number, number> = {};
  for (const tenor of config.tenors) {
    currentCurve[tenor] = nsYield(lastFactors[0], lastFactors[1], lastFactors[2], avgLambda, tenor);
  }

  return { fit, config, horizons, currentCurve };
}
