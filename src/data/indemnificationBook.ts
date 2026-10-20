import { Rng } from "@/lib/rng";
import {
  API_SCHEMA_VERSION, snapshotHash,
  type BorrowerRecord, type CloseoutProfile, type CollateralHoldingRecord, type IndemnificationSnapshot,
  type LoanRecord, type ModelSettings, type OwnerRecord, type PoolPositionRecord, type PricingSettings,
  type Rating, type RunSettings, type SecurityRecord,
} from "@/lib/indemnificationContract";
import DEFAULT_PROFILE from "../../contracts/indemnification/closeout-profile.default.json";
import { getReinvestmentPositions, type ReinvestmentPosition } from "./reinvestment";
import { getIndemnificationBookExtension, getLoanBook } from "./securitiesLending";
import { COUNTERPARTIES, bySymbol, type Security } from "./universe";

/**
 * Simulated INDEM book (spec020 IND-002, IND-028): the SLAB loan book plus its indemnification terms and
 * collateral, the reinvestment pool rescaled to the book's cash collateral, and borrower credit inputs from
 * the counterparty list. Every value is simulated (`SIM`); names come from the fictional counterparty list.
 */
export const GENERATOR_VERSION = "indem-book-1";

export const DEFAULT_RUN: RunSettings = { mode: "desk", seed: 1, paths: 50000, preview: false, horizon_days: 21, step: "daily" };
export const DEFAULT_MODEL: ModelSettings = { rho_d: 0.25, rho_w: 0.3, student_t_enabled: true, student_t_nu: 5, default_recovery: 0.4 };
export const DEFAULT_PRICING: PricingSettings = {
  cost_of_capital: 0.1,
  flag_threshold: 0.5,
  risk_weights: { aaa_to_aa_minus: 0.2, a_plus_to_a_minus: 0.5, bbb_plus_to_bb_minus: 1, below_bb_minus: 1.5, unrated: 1 },
};

export interface SimSnapshotOptions {
  /** ISO date the snapshot is as of; required so the snapshot never depends on the clock. */
  asOf: string;
  run?: Partial<RunSettings>;
  model?: Partial<ModelSettings>;
  pricing?: Partial<PricingSettings>;
  profile?: CloseoutProfile;
}

/**
 * Scale every position by one factor so the pool totals `target`, keeping the liquidity and credit mix.
 * This is a view for INDEM only; the reinvestment page keeps its own positions.
 */
export function rescalePool(positions: ReinvestmentPosition[], target: number): PoolPositionRecord[] {
  if (!(target > 0)) throw new Error("rescalePool needs a positive target total");
  const total = positions.reduce((a, p) => a + p.allocation, 0);
  const factor = target / total;
  return positions.map((p, i) => ({
    id: `P${i + 1}`,
    instrument: p.instrument,
    liquidity_bucket: p.bucket,
    credit_bucket: p.credit,
    allocation: p.allocation * factor,
    yield_bps: p.yieldBps,
    wam_days: p.wamDays,
  }));
}

/** Liquidity inputs the universe does not carry, drawn per ticker so one security never shifts another. */
function securityRecord(sec: Security): SecurityRecord {
  const rng = new Rng(`indem-sec-${sec.ticker}`);
  const units = sec.marketCap / sec.px;
  let advShare: number;
  let beta: number;
  let rateDuration = 0;
  switch (sec.assetClass) {
    case "EQUITY": advShare = rng.float(0.004, 0.012); beta = sec.hardToBorrow ? rng.float(1.2, 1.8) : rng.float(0.7, 1.3); break;
    case "ETF": advShare = rng.float(0.02, 0.06); beta = rng.float(0.9, 1.1); break;
    case "GOVT": advShare = rng.float(0.01, 0.03); beta = 0; rateDuration = rng.float(1.5, 9); break;
    default: advShare = rng.float(0.002, 0.008); beta = rng.float(0.2, 0.5); rateDuration = rng.float(3, 8); break;
  }
  const liquid = sec.assetClass === "GOVT" || sec.assetClass === "ETF" || (sec.assetClass === "EQUITY" && !sec.hardToBorrow && sec.marketCap >= 5e10);
  return {
    id: sec.ticker,
    label: sec.name,
    asset_class: sec.assetClass,
    liquidity_class: liquid ? "liquid" : "other",
    hard_to_borrow: sec.hardToBorrow,
    currency: "USD",
    price: sec.px,
    adv_units: units * advShare,
    daily_vol: sec.vol,
    equity_beta: beta,
    rate_duration: rateDuration,
    spread_duration: sec.assetClass === "CORP" ? rateDuration : 0,
  };
}

export async function buildSimSnapshot(options: SimSnapshotOptions): Promise<IndemnificationSnapshot> {
  const loans = getLoanBook();
  const ext = getIndemnificationBookExtension();
  const terms = new Map(ext.loanTerms.map((t) => [t.loanId, t]));

  const loanRecords: LoanRecord[] = loans.map((l) => {
    const t = terms.get(l.id)!;
    return {
      id: l.id, borrower_id: l.borrowerId, owner_id: t.ownerId, security_id: l.ticker, quantity: l.qty,
      rate_bps: l.rateBps, collateral_type: l.collateralType, margin_pct: t.marginPct, term: t.term,
      maturity_days: t.maturityDays, recallable: l.recallable, provenance: "sim",
    };
  });
  const collateral: CollateralHoldingRecord[] = ext.collateral.map((c) => ({
    id: c.id, borrower_id: c.borrowerId, kind: c.kind, security_id: c.ticker, quantity: c.quantity,
    cash_amount: c.cashAmount, provenance: "sim",
  }));

  const tickers = [...new Set([...loanRecords.map((l) => l.security_id), ...collateral.flatMap((c) => (c.security_id ? [c.security_id] : []))])].sort();
  const securities = tickers.map((t) => securityRecord(bySymbol(t)!));

  const cp = new Map(COUNTERPARTIES.map((c) => [c.id, c]));
  const borrowers: BorrowerRecord[] = [...new Set(loanRecords.map((l) => l.borrower_id))].sort().map((id) => ({
    id, name: cp.get(id)!.name, rating: cp.get(id)!.rating as Rating, spread_bps: null, recovery: null, credit_provenance: "sim",
  }));
  const owners: OwnerRecord[] = [...new Set(loanRecords.map((l) => l.owner_id))].sort().map((id) => ({ id, name: cp.get(id)!.name }));

  const cash = collateral.filter((c) => c.kind === "CASH").reduce((a, c) => a + c.cash_amount!, 0);
  const sourcePool = getReinvestmentPositions();
  const cashByOwner = new Map<string, number>();
  for (const l of loans.filter((x) => x.collateralType === "CASH")) {
    const t = terms.get(l.id)!;
    cashByOwner.set(t.ownerId, (cashByOwner.get(t.ownerId) ?? 0) + (l.notional * t.marginPct) / 100);
  }

  const body: Omit<IndemnificationSnapshot, "snapshot_hash"> = {
    api_schema_version: API_SCHEMA_VERSION,
    as_of: options.asOf,
    source: { label: "SIM", book_seed: "sl-loan-1+indem-book-1", generator_version: GENERATOR_VERSION },
    currency: "USD",
    run: { ...DEFAULT_RUN, ...options.run },
    model: { ...DEFAULT_MODEL, ...options.model },
    pricing: { ...DEFAULT_PRICING, ...options.pricing },
    closeout_profile: options.profile ?? (JSON.parse(JSON.stringify(DEFAULT_PROFILE)) as CloseoutProfile),
    securities,
    borrowers,
    owners,
    loans: loanRecords,
    collateral,
    pool: {
      positions: rescalePool(sourcePool, cash),
      owner_shares: [...cashByOwner].sort(([a], [b]) => (a < b ? -1 : 1)).map(([owner_id, value]) => ({ owner_id, share: value / cash })),
      rescaled: true,
      source_total: sourcePool.reduce((a, p) => a + p.allocation, 0),
      note: "Reinvestment pool rescaled to the book's cash collateral; liquidity and credit mix unchanged.",
    },
  };
  return { ...body, snapshot_hash: await snapshotHash(body) };
}
