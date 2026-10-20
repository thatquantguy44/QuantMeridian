// Indemnification (INDEM) wire contract, spec020 IND-001/IND-014/IND-020. The JSON Schemas in
// contracts/indemnification/ are the source of truth; src/lib/indemnificationContract.test.ts keeps
// these types and the schemas in step and validates the shared fixtures. The Python service (IND-T13)
// will check the same fixtures and the same hash vectors.
import { canonicalJson } from "./sourcesUsesContract";

export const API_SCHEMA_VERSION = "1.0" as const;

export type Provenance = "sim" | "user_input";
export type DataLabel = "SIM" | "USER_INPUT" | "MIXED";
export type RunMode = "desk" | "annual";
export type StepSize = "daily" | "weekly" | "monthly";
export type StressFactor = "equity" | "credit_spread" | "rates" | "fx";
export type UnwindStyle = "end_of_period" | "even";

export type Rating =
  | "AAA" | "AA+" | "AA" | "AA-" | "A+" | "A" | "A-" | "BBB+" | "BBB" | "BBB-"
  | "BB+" | "BB" | "BB-" | "B+" | "B" | "B-" | "CCC" | "NR";

/** Every close-out and liquidity-cost setting (decision 4). */
export interface CloseoutSettings {
  mpor_liquid_days: number;
  mpor_other_days: number;
  mpor_concentrated_days: number;
  mpor_pool_forced_sale_days: number;
  /** When set, overrides the four period settings above for the positions it covers. */
  mpor_fixed_days: number | null;
  addon_days: number;
  concentration_threshold_pct_adv: number;
  htb_uses_concentrated_period: boolean;
  impact_k: number;
  impact_alpha: number;
  half_spread_floor_bps: number;
  cost_cap_bps: number | null;
  stress_beta: number;
  stress_factor: StressFactor;
  unwind: UnwindStyle;
  margin_call_every_days: number;
}
export type CloseoutSettingsOverride = Partial<CloseoutSettings>;
export interface PositionOverride extends CloseoutSettingsOverride {
  adv_units?: number;
  daily_vol?: number;
}

export interface CloseoutProfile {
  profile_schema_version: "1.0";
  name: string;
  profile_version: number;
  defaults: CloseoutSettings;
  asset_class_overrides: Record<string, CloseoutSettingsOverride>;
  pool_bucket_overrides: Record<string, CloseoutSettingsOverride>;
  borrower_overrides: Record<string, CloseoutSettingsOverride>;
  position_overrides: Record<string, PositionOverride>;
}

export interface SnapshotSource { label: DataLabel; book_seed: string | null; generator_version: string | null }
export interface RunSettings {
  mode: RunMode;
  seed: number;
  paths: number;
  preview: boolean;
  horizon_days: number;
  step: StepSize;
}
/** Factor model for prices. Factor order for factor_corr: equity, rates, credit_spread, fx. */
export interface MarketModel {
  equity_vol_annual: number;
  rates_vol_bps_daily: number;
  spread_vol_bps_daily: number;
  fx_vol_annual: number;
  factor_corr: number[][];
  jump_intensity_annual: number;
  jump_mean: number;
  jump_sd: number;
}
export interface ModelSettings {
  rho_d: number;
  rho_w: number;
  student_t_enabled: boolean;
  student_t_nu: number;
  default_recovery: number;
  market: MarketModel;
}
export interface RiskWeights {
  aaa_to_aa_minus: number;
  a_plus_to_a_minus: number;
  bbb_plus_to_bb_minus: number;
  below_bb_minus: number;
  unrated: number;
}
export interface PricingSettings { cost_of_capital: number; flag_threshold: number; risk_weights: RiskWeights }
export interface SecurityRecord {
  id: string;
  label: string;
  asset_class: string;
  liquidity_class: "liquid" | "other";
  hard_to_borrow: boolean;
  currency: string;
  price: number;
  adv_units: number;
  daily_vol: number;
  equity_beta: number;
  rate_duration: number;
  spread_duration: number;
}
/** Ratings from best to worst; NR (unrated) sits outside the order. */
export const RATING_ORDER: Rating[] = ["AAA", "AA+", "AA", "AA-", "A+", "A", "A-", "BBB+", "BBB", "BBB-", "BB+", "BB", "BB-", "B+", "B", "B-", "CCC"];

/** Illustrative annual default probability per rating (decision 2); travels inside the snapshot. */
export interface RatingPdTable {
  table_version: number;
  label: "ILLUSTRATIVE" | "USER_INPUT";
  pd_1y: Record<Rating, number>;
}

export interface BorrowerRecord {
  id: string;
  name: string;
  rating: Rating;
  /** A user-entered spread overrides the rating table (decision 2). */
  spread_bps: number | null;
  recovery: number | null;
  credit_provenance: Provenance;
}
export interface OwnerRecord { id: string; name: string }
export interface LoanRecord {
  id: string;
  borrower_id: string;
  owner_id: string;
  security_id: string;
  quantity: number;
  rate_bps: number;
  collateral_type: "CASH" | "NON_CASH";
  margin_pct: number;
  term: "open" | "term";
  maturity_days: number | null;
  recallable: boolean;
  provenance: Provenance;
}
export interface CollateralHoldingRecord {
  id: string;
  borrower_id: string;
  kind: "CASH" | "SECURITY";
  security_id: string | null;
  quantity: number | null;
  cash_amount: number | null;
  provenance: Provenance;
}
export interface PoolPositionRecord {
  id: string;
  instrument: string;
  liquidity_bucket: "T+0" | "T+1" | "T+7" | "TERM";
  credit_bucket: "HQLA" | "AGENCY" | "A1/P1" | "BANK" | "CREDIT";
  allocation: number;
  yield_bps: number;
  wam_days: number;
}
export interface OwnerShareRecord { owner_id: string; share: number }
export interface PoolRecord {
  positions: PoolPositionRecord[];
  owner_shares: OwnerShareRecord[];
  rescaled: boolean;
  source_total: number | null;
  note: string | null;
}

export interface IndemnificationSnapshot {
  api_schema_version: typeof API_SCHEMA_VERSION;
  snapshot_hash: string;
  as_of: string;
  source: SnapshotSource;
  currency: string;
  run: RunSettings;
  model: ModelSettings;
  pricing: PricingSettings;
  rating_pd_table: RatingPdTable;
  closeout_profile: CloseoutProfile;
  securities: SecurityRecord[];
  borrowers: BorrowerRecord[];
  owners: OwnerRecord[];
  loans: LoanRecord[];
  collateral: CollateralHoldingRecord[];
  pool: PoolRecord;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * SHA-256 of the canonical JSON of the snapshot without `snapshot_hash`. Arrays of records are sorted by
 * id (pool owner shares by owner_id), so record order never changes the hash. The Python service must
 * match this byte for byte.
 */
export async function snapshotHash(input: Omit<IndemnificationSnapshot, "snapshot_hash"> & { snapshot_hash?: string }): Promise<string> {
  const { snapshot_hash: _ignored, ...snapshot } = input;
  const byId = <T extends { id: string }>(records: T[]) => [...records].sort((a, b) => compare(a.id, b.id));
  return sha256Hex(canonicalJson({
    ...snapshot,
    securities: byId(snapshot.securities),
    borrowers: byId(snapshot.borrowers),
    owners: byId(snapshot.owners),
    loans: byId(snapshot.loans),
    collateral: byId(snapshot.collateral),
    pool: {
      ...snapshot.pool,
      positions: byId(snapshot.pool.positions),
      owner_shares: [...snapshot.pool.owner_shares].sort((a, b) => compare(a.owner_id, b.owner_id)),
    },
  }));
}

/** SHA-256 of the canonical JSON of a close-out profile, recorded on the model card. */
export async function profileHash(profile: CloseoutProfile): Promise<string> {
  return sha256Hex(canonicalJson(profile));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const POOL_BUCKETS = ["T+0", "T+1", "T+7", "TERM"];

/**
 * Rules the JSON Schema cannot state. Returns one message per problem (empty when the snapshot is
 * consistent); the service must reject a snapshot with any issue before simulating.
 */
export function snapshotIssues(snapshot: IndemnificationSnapshot): string[] {
  const issues: string[] = [];
  const { model, closeout_profile: profile } = snapshot;
  if (model.rho_w ** 2 > model.rho_d) issues.push(`rho_w^2 (${model.rho_w ** 2}) must not exceed rho_d (${model.rho_d})`);

  for (let i = 1; i < RATING_ORDER.length; i++) {
    const better = RATING_ORDER[i - 1];
    const worse = RATING_ORDER[i];
    if (snapshot.rating_pd_table.pd_1y[worse] < snapshot.rating_pd_table.pd_1y[better]) {
      issues.push(`rating_pd_table: PD for ${worse} is below PD for ${better}`);
    }
  }

  const corr = model.market.factor_corr;
  const size = corr.length;
  let correlationOk = true;
  for (let i = 0; i < size; i++) {
    if (Math.abs(corr[i][i] - 1) > 1e-12) { issues.push(`market.factor_corr diagonal [${i}] must be 1`); correlationOk = false; }
    for (let j = i + 1; j < size; j++) {
      if (Math.abs(corr[i][j] - corr[j][i]) > 1e-12) { issues.push(`market.factor_corr is not symmetric at [${i}][${j}]`); correlationOk = false; }
    }
  }
  if (correlationOk && !isPositiveSemiDefinite(corr)) issues.push("market.factor_corr is not positive semi-definite");

  const idSets: Record<string, Set<string>> = {};
  const collect = (name: string, records: { id: string }[]) => {
    const seen = new Set<string>();
    for (const r of records) {
      if (seen.has(r.id)) issues.push(`duplicate ${name} id ${r.id}`);
      seen.add(r.id);
    }
    idSets[name] = seen;
  };
  collect("security", snapshot.securities);
  collect("borrower", snapshot.borrowers);
  collect("owner", snapshot.owners);
  collect("loan", snapshot.loans);
  collect("collateral", snapshot.collateral);
  collect("pool position", snapshot.pool.positions);

  for (const l of snapshot.loans) {
    if (!idSets.borrower.has(l.borrower_id)) issues.push(`loan ${l.id} names unknown borrower ${l.borrower_id}`);
    if (!idSets.owner.has(l.owner_id)) issues.push(`loan ${l.id} names unknown owner ${l.owner_id}`);
    if (!idSets.security.has(l.security_id)) issues.push(`loan ${l.id} names unknown security ${l.security_id}`);
  }
  for (const c of snapshot.collateral) {
    if (!idSets.borrower.has(c.borrower_id)) issues.push(`collateral ${c.id} names unknown borrower ${c.borrower_id}`);
    if (c.security_id !== null && !idSets.security.has(c.security_id)) issues.push(`collateral ${c.id} names unknown security ${c.security_id}`);
  }

  for (const s of snapshot.pool.owner_shares) {
    if (!idSets.owner.has(s.owner_id)) issues.push(`pool share names unknown owner ${s.owner_id}`);
  }
  const shareTotal = snapshot.pool.owner_shares.reduce((a, s) => a + s.share, 0);
  if (snapshot.pool.positions.length > 0 && Math.abs(shareTotal - 1) > 1e-9) issues.push(`pool owner shares sum to ${shareTotal}, not 1`);

  const positionIds = new Set([...idSets.loan, ...idSets.collateral, ...idSets["pool position"]]);
  for (const id of Object.keys(profile.position_overrides)) {
    if (!positionIds.has(id)) issues.push(`profile position override names unknown position ${id}`);
  }
  for (const id of Object.keys(profile.borrower_overrides)) {
    if (!idSets.borrower.has(id)) issues.push(`profile borrower override names unknown borrower ${id}`);
  }
  for (const b of Object.keys(profile.pool_bucket_overrides)) {
    if (!POOL_BUCKETS.includes(b)) issues.push(`profile pool bucket override names unknown bucket ${b}`);
  }
  const assetClasses = new Set(snapshot.securities.map((s) => s.asset_class));
  for (const a of Object.keys(profile.asset_class_overrides)) {
    if (!assetClasses.has(a)) issues.push(`profile asset class override names unknown asset class ${a}`);
  }

  const levels: [string, { half_spread_floor_bps?: number; cost_cap_bps?: number | null }][] = [
    ["defaults", profile.defaults],
    ...Object.entries(profile.asset_class_overrides),
    ...Object.entries(profile.pool_bucket_overrides),
    ...Object.entries(profile.borrower_overrides),
    ...Object.entries(profile.position_overrides),
  ];
  for (const [where, s] of levels) {
    if (s.cost_cap_bps != null && s.half_spread_floor_bps != null && s.cost_cap_bps < s.half_spread_floor_bps) {
      issues.push(`profile ${where}: cost_cap_bps (${s.cost_cap_bps}) is below half_spread_floor_bps (${s.half_spread_floor_bps})`);
    }
  }
  return issues;
}

/** Cholesky with a small tolerance: true when the symmetric matrix has no meaningfully negative eigenvalue. */
export function isPositiveSemiDefinite(matrix: number[][], tolerance = 1e-10): boolean {
  const n = matrix.length;
  const l: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = matrix[i][j];
      for (let k = 0; k < j; k++) sum -= l[i][k] * l[j][k];
      if (i === j) {
        if (sum < -tolerance) return false;
        l[i][i] = Math.sqrt(Math.max(sum, 0));
      } else if (l[j][j] > Math.sqrt(tolerance)) {
        l[i][j] = sum / l[j][j];
      } else if (Math.abs(sum) > tolerance * 1e3) {
        return false;
      }
    }
  }
  return true;
}
