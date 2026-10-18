/**
 * Dependency-free dense two-phase simplex for small continuous LPs.
 *
 *   minimise  cᵀx   subject to   aᵢx (≤ | = | ≥) bᵢ,   x ≥ 0
 *
 * Bland's rule guarantees termination on degenerate problems. Sized for
 * showcase models (tens of rows, low hundreds of columns), not production.
 * Duals follow the minimisation convention: reduced cost c − Aᵀy ≥ 0, so
 * y ≤ 0 on ≤ rows, y ≥ 0 on ≥ rows, and y is free on = rows.
 */

export type RowSense = "<=" | "=" | ">=";

export interface LpRow {
  name: string;
  sense: RowSense;
  rhs: number;
  /** Sparse coefficients as [column, value] pairs. */
  coeffs: [number, number][];
}

export interface LpProblem {
  cost: number[];
  rows: LpRow[];
}

export type LpStatus = "optimal" | "infeasible" | "unbounded" | "iteration_limit";

export interface LpResult {
  status: LpStatus;
  x: number[];
  objective: number;
  /** One dual per row in the original row orientation (see module note). */
  duals: number[];
  /** Row activity aᵢx for each row. */
  activity: number[];
  pivots: number;
}

const EPS = 1e-9;
const MAX_PIVOTS = 20_000;

export function solveLp(problem: LpProblem): LpResult {
  const n = problem.cost.length;
  const m = problem.rows.length;
  const slackCount = problem.rows.filter((row) => row.sense !== "=").length;
  const width = n + slackCount + m; // structural | slack/surplus | artificial
  const rhsCol = width;
  const artStart = n + slackCount;

  // Standardised equality matrix (kept unpivoted for dual recovery).
  const A: number[][] = [];
  const b: number[] = [];
  const flip: number[] = [];
  let slackIdx = n;
  problem.rows.forEach((row, i) => {
    const line = new Array<number>(width).fill(0);
    for (const [col, value] of row.coeffs) line[col] += value;
    if (row.sense === "<=") line[slackIdx++] = 1;
    else if (row.sense === ">=") line[slackIdx++] = -1;
    const sign = row.rhs < 0 ? -1 : 1;
    for (let j = 0; j < artStart; j++) line[j] *= sign;
    line[artStart + i] = 1;
    A.push(line);
    b.push(row.rhs * sign);
    flip.push(sign);
  });

  const T = A.map((line, i) => [...line, b[i]]);
  const basis = Array.from({ length: m }, (_, i) => artStart + i);
  let pivots = 0;

  const pivot = (r: number, c: number) => {
    const pr = T[r];
    const pv = pr[c];
    for (let j = 0; j <= width; j++) pr[j] /= pv;
    for (let i = 0; i < m; i++) {
      if (i === r) continue;
      const row = T[i];
      const factor = row[c];
      if (Math.abs(factor) < 1e-15) continue;
      for (let j = 0; j <= width; j++) row[j] -= factor * pr[j];
    }
    basis[r] = c;
    pivots++;
  };

  const iterate = (costs: number[], canEnter: (j: number) => boolean): "optimal" | "unbounded" | "iteration_limit" => {
    while (pivots < MAX_PIVOTS) {
      let enter = -1;
      for (let j = 0; j < width; j++) {
        if (!canEnter(j)) continue;
        let reduced = costs[j];
        for (let i = 0; i < m; i++) reduced -= costs[basis[i]] * T[i][j];
        if (reduced < -EPS) { enter = j; break; }
      }
      if (enter < 0) return "optimal";
      let leave = -1;
      let best = Infinity;
      for (let i = 0; i < m; i++) {
        const a = T[i][enter];
        if (a <= EPS) continue;
        const ratio = T[i][rhsCol] / a;
        if (ratio < best - EPS || (Math.abs(ratio - best) <= EPS && basis[i] < basis[leave])) {
          best = ratio;
          leave = i;
        }
      }
      if (leave < 0) return "unbounded";
      pivot(leave, enter);
    }
    return "iteration_limit";
  };

  const empty = (status: LpStatus): LpResult => ({
    status, x: new Array(n).fill(0), objective: NaN, duals: new Array(m).fill(0), activity: new Array(m).fill(0), pivots,
  });

  // Phase 1: minimise the sum of artificials.
  const phase1 = new Array<number>(width).fill(0);
  for (let i = 0; i < m; i++) phase1[artStart + i] = 1;
  const p1 = iterate(phase1, () => true);
  if (p1 === "iteration_limit") return empty(p1);
  const scale = Math.max(1, ...b.map(Math.abs));
  const infeasibility = basis.reduce((sum, col, i) => sum + (col >= artStart ? T[i][rhsCol] : 0), 0);
  if (infeasibility > 1e-7 * scale) return empty("infeasible");

  // Drive remaining (zero-valued) artificials out of the basis where possible.
  for (let i = 0; i < m; i++) {
    if (basis[i] < artStart) continue;
    for (let j = 0; j < artStart; j++) {
      if (Math.abs(T[i][j]) > 1e-7) { pivot(i, j); break; }
    }
  }

  // Phase 2: original objective; artificials may not re-enter.
  const phase2 = new Array<number>(width).fill(0);
  for (let j = 0; j < n; j++) phase2[j] = problem.cost[j];
  const p2 = iterate(phase2, (j) => j < artStart);
  if (p2 !== "optimal") return empty(p2);

  const x = new Array<number>(n).fill(0);
  basis.forEach((col, i) => { if (col < n) x[col] = Math.max(0, T[i][rhsCol]); });
  const objective = problem.cost.reduce((sum, c, j) => sum + c * x[j], 0);

  // Duals: solve Bᵀw = c_B on the unpivoted standardised matrix, then undo row flips.
  const BT = basis.map((_, k) => basis.map((col) => A[k][col]));
  const transposed = BT[0] ? BT[0].map((_, r) => BT.map((row) => row[r])) : [];
  const w = solveDense(transposed, basis.map((col) => phase2[col]));
  const duals = w.map((value, i) => value * flip[i]);
  const activity = problem.rows.map((row) => row.coeffs.reduce((sum, [col, value]) => sum + value * x[col], 0));

  return { status: "optimal", x, objective, duals, activity, pivots };
}

/** Gaussian elimination with partial pivoting; singular directions resolve to 0. */
function solveDense(M: number[][], rhs: number[]): number[] {
  const size = rhs.length;
  const a = M.map((row, i) => [...row, rhs[i]]);
  const where = new Array<number>(size).fill(-1);
  let row = 0;
  for (let col = 0; col < size && row < size; col++) {
    let sel = row;
    for (let i = row; i < size; i++) if (Math.abs(a[i][col]) > Math.abs(a[sel][col])) sel = i;
    if (Math.abs(a[sel][col]) < 1e-12) continue;
    [a[sel], a[row]] = [a[row], a[sel]];
    where[col] = row;
    for (let i = 0; i < size; i++) {
      if (i === row) continue;
      const factor = a[i][col] / a[row][col];
      if (factor === 0) continue;
      for (let j = col; j <= size; j++) a[i][j] -= factor * a[row][j];
    }
    row++;
  }
  return where.map((r, col) => (r < 0 ? 0 : a[r][size] / a[r][col]));
}

export interface LpCertificate {
  /** Largest violation of a row or of x ≥ 0. */
  primalViolation: number;
  /** Largest violation of reduced-cost or dual-sign feasibility. */
  dualViolation: number;
  /** Largest product of a positive primal/slack value and its non-zero partner. */
  complementarity: number;
  primalObjective: number;
  dualObjective: number;
}

/**
 * Independent optimality certificate for a claimed primal/dual pair. It is
 * recomputed from the problem data only and does not use any solver state.
 */
export function certifyLp(problem: LpProblem, x: number[], duals: number[]): LpCertificate {
  let primalViolation = 0;
  let dualViolation = 0;
  let complementarity = 0;
  x.forEach((v) => { primalViolation = Math.max(primalViolation, -v); });
  const reduced = [...problem.cost];
  let dualObjective = 0;
  problem.rows.forEach((row, i) => {
    const y = duals[i] ?? 0;
    const activity = row.coeffs.reduce((sum, [col, value]) => sum + value * (x[col] ?? 0), 0);
    const slack = row.rhs - activity; // ≥ 0 for ≤ rows, ≤ 0 for ≥ rows
    if (row.sense === "<=") { primalViolation = Math.max(primalViolation, -slack); dualViolation = Math.max(dualViolation, y); complementarity = Math.max(complementarity, Math.abs(slack * y)); }
    else if (row.sense === ">=") { primalViolation = Math.max(primalViolation, slack); dualViolation = Math.max(dualViolation, -y); complementarity = Math.max(complementarity, Math.abs(slack * y)); }
    else primalViolation = Math.max(primalViolation, Math.abs(slack));
    for (const [col, value] of row.coeffs) reduced[col] -= value * y;
    dualObjective += row.rhs * y;
  });
  reduced.forEach((d, j) => {
    dualViolation = Math.max(dualViolation, -d);
    complementarity = Math.max(complementarity, Math.abs((x[j] ?? 0) * d));
  });
  const primalObjective = problem.cost.reduce((sum, c, j) => sum + c * (x[j] ?? 0), 0);
  return { primalViolation, dualViolation, complementarity, primalObjective, dualObjective };
}
