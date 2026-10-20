import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, test } from "vitest";
import { snapshotHash, snapshotIssues, type IndemnificationSnapshot } from "@/lib/indemnificationContract";
import { buildSimSnapshot, rescalePool } from "./indemnificationBook";
import { getIndemnificationBookExtension, getLoanBook } from "./securitiesLending";
import { getReinvestmentPositions } from "./reinvestment";
import { BENEFICIAL_OWNERS, COUNTERPARTIES, UNIVERSE } from "./universe";

const readSchema = (name: string) => JSON.parse(readFileSync(new URL(`../../contracts/indemnification/${name}`, import.meta.url), "utf-8"));
const price = (ticker: string) => UNIVERSE.find((s) => s.ticker === ticker)!.px;
const AS_OF = "2026-10-20";

describe("book extension (securitiesLending.getIndemnificationBookExtension)", () => {
  const loans = getLoanBook();
  const ext = getIndemnificationBookExtension();

  test("is deterministic", () => {
    expect(getIndemnificationBookExtension()).toEqual(ext);
  });

  test("has one set of terms per existing loan, in the same order", () => {
    expect(ext.loanTerms.map((t) => t.loanId)).toEqual(loans.map((l) => l.id));
  });

  test("assigns a beneficial owner, term and margin to every loan", () => {
    const owners = new Set(BENEFICIAL_OWNERS.map((o) => o.id));
    for (const t of ext.loanTerms) {
      const loan = loans.find((l) => l.id === t.loanId)!;
      expect(owners.has(t.ownerId), t.loanId).toBe(true);
      if (t.term === "open") expect(t.maturityDays).toBeNull();
      else {
        expect(t.maturityDays).toBeGreaterThanOrEqual(5);
        expect(t.maturityDays).toBeLessThanOrEqual(90);
      }
      const sec = UNIVERSE.find((s) => s.ticker === loan.ticker)!;
      if (sec.hardToBorrow) expect(t.marginPct, t.loanId).toBe(105);
      else if (sec.assetClass === "GOVT") expect(t.marginPct, t.loanId).toBe(102);
      else expect([102, 105], t.loanId).toContain(t.marginPct);
    }
    expect(ext.loanTerms.some((t) => t.term === "term")).toBe(true);
    expect(ext.loanTerms.some((t) => t.term === "open")).toBe(true);
  });

  test("holds collateral for each borrower equal to margin times loan value, split by collateral type", () => {
    const required = new Map<string, { cash: number; noncash: number }>();
    for (const loan of loans) {
      const t = ext.loanTerms.find((x) => x.loanId === loan.id)!;
      const entry = required.get(loan.borrowerId) ?? { cash: 0, noncash: 0 };
      entry[loan.collateralType === "CASH" ? "cash" : "noncash"] += (loan.notional * t.marginPct) / 100;
      required.set(loan.borrowerId, entry);
    }
    for (const [borrowerId, need] of required) {
      const held = ext.collateral.filter((c) => c.borrowerId === borrowerId);
      const cash = held.filter((c) => c.kind === "CASH").reduce((a, c) => a + c.cashAmount!, 0);
      const noncash = held.filter((c) => c.kind === "SECURITY").reduce((a, c) => a + c.quantity! * price(c.ticker!), 0);
      expect(cash, `${borrowerId} cash`).toBeCloseTo(need.cash, 4);
      expect(noncash, `${borrowerId} non-cash`).toBeCloseTo(need.noncash, 4);
    }
    expect(new Set(ext.collateral.map((c) => c.id)).size).toBe(ext.collateral.length);
  });

  test("a CASH holding has no security, and a SECURITY holding has a quantity and no cash amount", () => {
    for (const c of ext.collateral) {
      if (c.kind === "CASH") expect([c.ticker, c.quantity], c.id).toEqual([null, null]);
      else expect([c.cashAmount, typeof c.quantity], c.id).toEqual([null, "number"]);
    }
  });
});

describe("rescalePool", () => {
  const source = getReinvestmentPositions();
  const total = source.reduce((a, p) => a + p.allocation, 0);

  test("makes the pool total equal the target and keeps the mix", () => {
    const target = 123_456_789;
    const pool = rescalePool(source, target);
    expect(pool.reduce((a, p) => a + p.allocation, 0)).toBeCloseTo(target, 4);
    pool.forEach((p, i) => {
      expect(p.allocation / target).toBeCloseTo(source[i].allocation / total, 12);
      expect(p.liquidity_bucket).toBe(source[i].bucket);
      expect(p.credit_bucket).toBe(source[i].credit);
      expect(p.yield_bps).toBe(source[i].yieldBps);
      expect(p.wam_days).toBe(source[i].wamDays);
    });
  });

  test("does not modify the source positions", () => {
    const before = JSON.stringify(source);
    rescalePool(source, 5);
    expect(JSON.stringify(source)).toBe(before);
  });

  test("rejects a target that is not positive", () => {
    expect(() => rescalePool(source, 0)).toThrow(/positive/);
  });
});

describe("buildSimSnapshot", () => {
  let ajv: Ajv2020;
  let snapshot: IndemnificationSnapshot;
  beforeAll(async () => {
    ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    for (const name of ["closeout-profile-1.0.schema.json", "rating-pd-table-1.0.schema.json", "model-card-1.0.schema.json", "snapshot-1.0.schema.json", "result-1.0.schema.json"]) ajv.addSchema(readSchema(name));
    snapshot = await buildSimSnapshot({ asOf: AS_OF });
  });

  test("is valid against the snapshot schema and the cross-field rules", () => {
    const validate = ajv.getSchema("urn:quantmeridian:indemnification:snapshot:1.0")!;
    expect(validate(snapshot), JSON.stringify(validate.errors)).toBe(true);
    expect(snapshotIssues(snapshot)).toEqual([]);
  });

  test("the shared sim-book fixture is current", async () => {
    const file = JSON.parse(readFileSync(new URL("../../contracts/indemnification/fixtures/sim-book.example.json", import.meta.url), "utf-8"));
    const fresh = await buildSimSnapshot({ asOf: "2026-10-20", run: { paths: 5000, preview: true } });
    expect(file).toEqual(fresh);
  });

  test("carries a correct hash and is deterministic", async () => {
    expect(snapshot.snapshot_hash).toBe(await snapshotHash(snapshot));
    expect((await buildSimSnapshot({ asOf: AS_OF })).snapshot_hash).toBe(snapshot.snapshot_hash);
    expect((await buildSimSnapshot({ asOf: AS_OF, run: { seed: 99 } })).snapshot_hash).not.toBe(snapshot.snapshot_hash);
  });

  test("is labelled SIM, uses the decision defaults and the default close-out profile", () => {
    expect(snapshot.source.label).toBe("SIM");
    expect(snapshot.as_of).toBe(AS_OF);
    expect(snapshot.run).toMatchObject({ mode: "desk", paths: 50000, preview: false, horizon_days: 21, step: "daily" });
    expect(snapshot.model).toMatchObject({ rho_d: 0.25, rho_w: 0.3, student_t_enabled: true, student_t_nu: 5, default_recovery: 0.4 });
    expect(snapshot.pricing).toMatchObject({ cost_of_capital: 0.1, flag_threshold: 0.5 });
    expect(snapshot.pricing.risk_weights).toEqual({ aaa_to_aa_minus: 0.2, a_plus_to_a_minus: 0.5, bbb_plus_to_bb_minus: 1, below_bb_minus: 1.5, unrated: 1 });
    expect(snapshot.closeout_profile.name).toBe("default");
  });

  test("uses the existing loans unchanged and fictional counterparties only", () => {
    const loans = getLoanBook();
    expect(snapshot.loans.map((l) => l.id).sort()).toEqual(loans.map((l) => l.id).sort());
    for (const l of snapshot.loans) {
      const src = loans.find((x) => x.id === l.id)!;
      expect([l.quantity, l.rate_bps, l.collateral_type, l.borrower_id, l.recallable]).toEqual([src.qty, src.rateBps, src.collateralType, src.borrowerId, src.recallable]);
      expect(l.provenance).toBe("sim");
    }
    const fictional = new Set(COUNTERPARTIES.map((c) => c.name));
    for (const p of [...snapshot.borrowers, ...snapshot.owners]) expect(fictional.has(p.name), p.name).toBe(true);
  });

  test("takes borrower ratings from the counterparty list, with no spread override", () => {
    for (const b of snapshot.borrowers) {
      const cp = COUNTERPARTIES.find((c) => c.id === b.id)!;
      expect([b.rating, b.spread_bps, b.recovery, b.credit_provenance]).toEqual([cp.rating, null, null, "sim"]);
    }
  });

  test("rescales the reinvestment pool to the book's cash collateral and splits it by owner share of that collateral", () => {
    const cash = snapshot.collateral.filter((c) => c.kind === "CASH").reduce((a, c) => a + c.cash_amount!, 0);
    expect(snapshot.pool.positions.reduce((a, p) => a + p.allocation, 0)).toBeCloseTo(cash, 4);
    expect(snapshot.pool.rescaled).toBe(true);
    const source = getReinvestmentPositions();
    expect(snapshot.pool.source_total).toBeCloseTo(source.reduce((a, p) => a + p.allocation, 0), 4);
    expect(snapshot.pool.note).toMatch(/rescaled/i);
    expect(snapshot.pool.owner_shares.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 12);
    const ext = getIndemnificationBookExtension();
    const byOwner = new Map<string, number>();
    for (const loan of getLoanBook().filter((l) => l.collateralType === "CASH")) {
      const t = ext.loanTerms.find((x) => x.loanId === loan.id)!;
      byOwner.set(t.ownerId, (byOwner.get(t.ownerId) ?? 0) + (loan.notional * t.marginPct) / 100);
    }
    for (const s of snapshot.pool.owner_shares) expect(s.share).toBeCloseTo(byOwner.get(s.owner_id)! / cash, 12);
  });

  test("includes only the securities the book uses, with positive liquidity inputs", () => {
    const used = new Set([...snapshot.loans.map((l) => l.security_id), ...snapshot.collateral.filter((c) => c.security_id).map((c) => c.security_id)]);
    expect(new Set(snapshot.securities.map((s) => s.id))).toEqual(used);
    for (const s of snapshot.securities) {
      expect(s.price, s.id).toBe(price(s.id));
      expect(s.adv_units, s.id).toBeGreaterThan(0);
      expect(s.daily_vol, s.id).toBeGreaterThan(0);
    }
  });

  test("embeds the default rating PD table, or the one supplied", async () => {
    const defaultTable = JSON.parse(readFileSync(new URL("../../contracts/indemnification/rating-pd-table.default.json", import.meta.url), "utf-8"));
    expect(snapshot.rating_pd_table).toEqual(defaultTable);
    const custom = await buildSimSnapshot({ asOf: AS_OF, ratingPdTable: { ...defaultTable, label: "USER_INPUT", pd_1y: { ...defaultTable.pd_1y, BBB: 0.003 } } });
    expect(custom.rating_pd_table.pd_1y.BBB).toBe(0.003);
    expect(custom.snapshot_hash).not.toBe(snapshot.snapshot_hash);
  });

  test("a user-entered credit spread overrides the rating table for that borrower alone", async () => {
    const id = snapshot.borrowers[0].id;
    const custom = await buildSimSnapshot({ asOf: AS_OF, borrowerCredit: { [id]: { spread_bps: 240, recovery: 0.35 } } });
    const entered = custom.borrowers.find((b) => b.id === id)!;
    expect([entered.spread_bps, entered.recovery, entered.credit_provenance]).toEqual([240, 0.35, "user_input"]);
    for (const b of custom.borrowers.filter((x) => x.id !== id)) expect([b.spread_bps, b.recovery, b.credit_provenance]).toEqual([null, null, "sim"]);
    expect(custom.snapshot_hash).not.toBe(snapshot.snapshot_hash);
    expect(snapshotIssues(custom)).toEqual([]);
    const noRecovery = await buildSimSnapshot({ asOf: AS_OF, borrowerCredit: { [id]: { spread_bps: 100 } } });
    expect(noRecovery.borrowers.find((b) => b.id === id)!.recovery).toBeNull();
    await expect(buildSimSnapshot({ asOf: AS_OF, borrowerCredit: { nobody: { spread_bps: 100 } } })).rejects.toThrow(/unknown borrower nobody/);
  });

  test("honours run, model, pricing and profile options", async () => {
    const custom = await buildSimSnapshot({
      asOf: AS_OF,
      run: { mode: "annual", horizon_days: 252, step: "weekly", paths: 5000, preview: true },
      model: { rho_w: 0.2 },
      pricing: { cost_of_capital: 0.12 },
    });
    expect(custom.run).toMatchObject({ mode: "annual", horizon_days: 252, step: "weekly", paths: 5000, preview: true });
    expect(custom.model.rho_w).toBe(0.2);
    expect(custom.model.rho_d).toBe(0.25);
    expect(custom.pricing.cost_of_capital).toBe(0.12);
    expect(custom.pricing.flag_threshold).toBe(0.5);
    expect(snapshotIssues(custom)).toEqual([]);
  });
});
