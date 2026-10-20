// Turns the choices a person makes on the INDEM page into a service request (spec020 IND-T14).
// The browser sends only choices; the server builds the snapshot from the simulated book, so a client can
// never supply book data. Everything is checked (schema, cross-field rules) before any network call.
import { buildSimSnapshot, type SimSnapshotOptions } from "@/data/indemnificationBook";
import { snapshotSchemaIssues, type RunOptions, type RunRequest } from "./indemnificationApi";
import { snapshotHash, snapshotIssues, type IndemnificationSnapshot } from "./indemnificationContract";

export const DEFAULT_RUN_OPTIONS: RunOptions = { sensitivity_paths: 5000, stresses: true, stress_profile_overrides: null };

/** What the page sends. Every field is optional; omitted ones take the documented defaults. */
export interface UiRunInput {
  as_of?: string;
  run?: SimSnapshotOptions["run"];
  model?: SimSnapshotOptions["model"];
  pricing?: SimSnapshotOptions["pricing"];
  profile?: SimSnapshotOptions["profile"];
  rating_pd_table?: SimSnapshotOptions["ratingPdTable"];
  basel_haircuts?: SimSnapshotOptions["baselHaircuts"];
  borrower_credit?: SimSnapshotOptions["borrowerCredit"];
  options?: Partial<RunOptions>;
}

export class ComposeError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED = new Set(["as_of", "run", "model", "pricing", "profile", "rating_pd_table", "basel_haircuts", "borrower_credit", "options"]);

export async function composeRunRequest(input: UiRunInput, today: () => string = () => new Date().toISOString().slice(0, 10)): Promise<RunRequest> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new ComposeError(["the request must be a JSON object"]);
  const unknown = Object.keys(input).filter((key) => !ALLOWED.has(key));
  if (unknown.length) throw new ComposeError(unknown.map((key) => `unknown field ${key}`));
  const asOf = input.as_of ?? today();
  if (!DATE.test(asOf)) throw new ComposeError([`as_of must be a date like 2026-10-20, got ${asOf}`]);

  let snapshot;
  try {
    snapshot = await buildSimSnapshot({
      asOf, run: input.run, model: input.model, pricing: input.pricing, profile: input.profile,
      ratingPdTable: input.rating_pd_table, baselHaircuts: input.basel_haircuts, borrowerCredit: input.borrower_credit,
    });
  } catch (error) {
    throw new ComposeError([error instanceof Error ? error.message : String(error)]);
  }
  const issues = [...snapshotSchemaIssues(snapshot)];
  if (issues.length === 0) issues.push(...snapshotIssues(snapshot));
  if (issues.length) throw new ComposeError(issues);
  if ((await snapshotHash(snapshot)) !== snapshot.snapshot_hash) throw new ComposeError(["snapshot hash does not match its contents"]);

  const options: RunOptions = { ...DEFAULT_RUN_OPTIONS, ...input.options };
  if (options.sensitivity_paths !== null && !(Number.isInteger(options.sensitivity_paths) && options.sensitivity_paths >= 1000 && options.sensitivity_paths <= 500000))
    throw new ComposeError(["options.sensitivity_paths must be null or an integer from 1000 to 500000"]);
  if (typeof options.stresses !== "boolean") throw new ComposeError(["options.stresses must be true or false"]);
  return { api_schema_version: "1.0", snapshot, options };
}

/** Everything the page needs to start: who and what is in the book, and the documented defaults. */
export interface BookSummary {
  as_of: string;
  source: IndemnificationSnapshot["source"];
  borrowers: { id: string; name: string; rating: string }[];
  owners: { id: string; name: string }[];
  securities: { id: string; asset_class: string; hard_to_borrow: boolean }[];
  loans: { id: string; borrower_id: string; owner_id: string; security_id: string; quantity: number; margin_pct: number; term: string }[];
  pool_positions: { id: string; instrument: string; liquidity_bucket: string; credit_bucket: string; allocation: number }[];
  cash_collateral: number;
  defaults: {
    run: IndemnificationSnapshot["run"];
    model: IndemnificationSnapshot["model"];
    pricing: IndemnificationSnapshot["pricing"];
    profile: IndemnificationSnapshot["closeout_profile"];
    rating_pd_table: IndemnificationSnapshot["rating_pd_table"];
    basel_haircuts: IndemnificationSnapshot["basel_haircuts"];
    options: RunOptions;
  };
}

export async function bookSummary(today: () => string = () => new Date().toISOString().slice(0, 10)): Promise<BookSummary> {
  const s = await buildSimSnapshot({ asOf: today() });
  return {
    as_of: s.as_of,
    source: s.source,
    borrowers: s.borrowers.map((b) => ({ id: b.id, name: b.name, rating: b.rating })),
    owners: s.owners.map((o) => ({ id: o.id, name: o.name })),
    securities: s.securities.map((x) => ({ id: x.id, asset_class: x.asset_class, hard_to_borrow: x.hard_to_borrow })),
    loans: s.loans.map((l) => ({ id: l.id, borrower_id: l.borrower_id, owner_id: l.owner_id, security_id: l.security_id, quantity: l.quantity, margin_pct: l.margin_pct, term: l.term })),
    pool_positions: s.pool.positions.map((p) => ({ id: p.id, instrument: p.instrument, liquidity_bucket: p.liquidity_bucket, credit_bucket: p.credit_bucket, allocation: p.allocation })),
    cash_collateral: s.collateral.filter((c) => c.kind === "CASH").reduce((a, c) => a + (c.cash_amount ?? 0), 0),
    defaults: {
      run: s.run, model: s.model, pricing: s.pricing, profile: s.closeout_profile,
      rating_pd_table: s.rating_pd_table, basel_haircuts: s.basel_haircuts, options: DEFAULT_RUN_OPTIONS,
    },
  };
}
