import { describe, expect, it } from "vitest";
import { BOOK_PROFILES, buildGeneratedBook, type NativeSnapshot } from "./collateralBooks";

const ids = ["dealer", "asset_manager"] as const;
const HAIRCUT = (book: NativeSnapshot, agreementId: string, assetClass: string) =>
  book.agreements.find((a) => a.agreement_id === agreementId)!.classes.find((c) => c.asset_class === assetClass)?.haircut;
const fx = (book: NativeSnapshot, ccy: string) => book.fx.find((q) => q.currency === ccy)!.usd_per_unit;

/** Mirror of the model's own eligibility rule (formulation.eligible_edges), so realism claims are checked on data. */
function eligibleAssets(book: NativeSnapshot, callId: string) {
  const call = book.calls.find((c) => c.call_id === callId)!;
  const agreement = book.agreements.find((a) => a.agreement_id === call.agreement_id)!;
  const rules = new Set(agreement.classes.map((c) => c.asset_class));
  return book.assets.filter((a) =>
    a.legal_entity === call.legal_entity &&
    agreement.allowed_custodians.includes(a.custodian) &&
    (a.currency === call.currency || agreement.cross_currency_allowed) &&
    !agreement.denied_issuers.includes(a.issuer) &&
    rules.has(a.asset_class) &&
    a.settlement_minutes <= call.deadline_minutes);
}

describe("generated demo books", () => {
  it("lists both profiles with a label and a one-line description", () => {
    expect(BOOK_PROFILES.map((p) => p.id)).toEqual([...ids]);
    for (const profile of BOOK_PROFILES) {
      expect(profile.label.length).toBeGreaterThan(0);
      expect(profile.blurb.length).toBeGreaterThan(20);
    }
  });

  for (const id of ids) {
    describe(id, () => {
      const book = buildGeneratedBook(id);

      it("is deterministic", () => {
        expect(JSON.stringify(buildGeneratedBook(id))).toBe(JSON.stringify(book));
      });

      it("is labelled generated, never SIM, with a distinct book id", () => {
        expect(book.source.startsWith("GENERATED-DEMO")).toBe(true);
        expect(book.source).not.toMatch(/^SIM/);
        expect(book.book_id).toContain("GEN-");
        const other = buildGeneratedBook(ids.find((x) => x !== id)!);
        expect(other.book_id).not.toBe(book.book_id);
      });

      it("satisfies the native schema's own consistency rules", () => {
        const unique = (values: string[]) => expect(new Set(values).size).toBe(values.length);
        unique(book.assets.map((a) => a.asset_id));
        unique(book.calls.map((c) => c.call_id));
        unique(book.agreements.map((a) => a.agreement_id));
        unique(book.fx.map((q) => q.currency));
        expect(fx(book, "USD")).toBe(1);
        const asOf = Date.parse(book.as_of);
        for (const row of [...book.assets, ...book.calls, ...book.fx]) {
          expect(book.fx.some((q) => q.currency === ("currency" in row ? row.currency : "")) || !("currency" in row)).toBe(true);
          const ageMinutes = (asOf - Date.parse(row.observed_at)) / 60000;
          expect(ageMinutes).toBeGreaterThanOrEqual(0);
          expect(ageMinutes).toBeLessThanOrEqual(book.max_input_age_minutes);
        }
        for (const call of book.calls) {
          const agreement = book.agreements.find((a) => a.agreement_id === call.agreement_id);
          expect(agreement, call.call_id).toBeDefined();
          expect(agreement!.legal_entity).toBe(call.legal_entity);
          expect(Date.parse(agreement!.effective_from)).toBeLessThanOrEqual(asOf);
        }
        for (const agreement of book.agreements) {
          unique(agreement.classes.map((c) => c.asset_class));
          for (const rule of agreement.classes) { expect(rule.haircut).toBeGreaterThanOrEqual(0); expect(rule.haircut).toBeLessThan(1); }
        }
      });

      it("pledges only known assets and calls, never beyond an asset's capacity", () => {
        const pledged = new Map<string, number>();
        for (const p of book.current_pledges) {
          expect(book.calls.some((c) => c.call_id === p.call_id)).toBe(true);
          expect(book.assets.some((a) => a.asset_id === p.asset_id)).toBe(true);
          pledged.set(p.asset_id, (pledged.get(p.asset_id) ?? 0) + p.market_value);
        }
        for (const [assetId, total] of pledged) expect(total).toBeLessThanOrEqual(book.assets.find((a) => a.asset_id === assetId)!.allocatable_value + 1e-7);
      });

      it("starts with a valid incumbent: every call is covered after haircuts", () => {
        for (const call of book.calls) {
          const agreement = book.agreements.find((a) => a.agreement_id === call.agreement_id)!;
          const covered = book.current_pledges.filter((p) => p.call_id === call.call_id).reduce((sum, p) => {
            const asset = book.assets.find((a) => a.asset_id === p.asset_id)!;
            const cut = agreement.classes.find((c) => c.asset_class === asset.asset_class)!.haircut;
            return sum + p.market_value * (1 - cut);
          }, 0);
          expect(covered, call.call_id).toBeGreaterThanOrEqual(call.required_value);
        }
      });

      it("keeps the incumbent inside every issuer cap, so savings can be measured against it", () => {
        for (const call of book.calls) {
          const agreement = book.agreements.find((a) => a.agreement_id === call.agreement_id)!;
          const byIssuer = new Map<string, number>();
          for (const p of book.current_pledges.filter((x) => x.call_id === call.call_id)) {
            const asset = book.assets.find((a) => a.asset_id === p.asset_id)!;
            const cut = agreement.classes.find((c) => c.asset_class === asset.asset_class)!.haircut;
            byIssuer.set(asset.issuer, (byIssuer.get(asset.issuer) ?? 0) + p.market_value * (1 - cut));
          }
          for (const [issuer, covered] of byIssuer) {
            expect(covered, `${call.call_id} ${issuer}`).toBeLessThanOrEqual(call.required_value * agreement.maximum_issuer_fraction + 1e-6);
          }
        }
      });

      it("has enough eligible, timely collateral to cover each call without the incumbent", () => {
        for (const call of book.calls) {
          const agreement = book.agreements.find((a) => a.agreement_id === call.agreement_id)!;
          const capacity = eligibleAssets(book, call.call_id).reduce((sum, a) => {
            const cut = agreement.classes.find((c) => c.asset_class === a.asset_class)!.haircut;
            return sum + a.allocatable_value * (1 - cut) * fx(book, a.currency);
          }, 0);
          expect(capacity, call.call_id).toBeGreaterThan(call.required_value * fx(book, call.currency) * 1.5);
        }
      });

      it("uses fictional, non-generic names", () => {
        expect(book.calls.every((c) => !/^SIM-CP-\d+$/.test(c.counterparty))).toBe(true);
        expect(new Set(book.calls.map((c) => c.counterparty)).size).toBe(book.calls.length);
        expect(book.assets.every((a) => !/^SIM-/.test(a.issuer))).toBe(true);
      });

      it("has calls with at least three different deadlines", () => {
        expect(new Set(book.calls.map((c) => c.deadline_minutes)).size).toBeGreaterThanOrEqual(3);
      });

      it("has a short deadline that excludes slower asset classes from growing", () => {
        const shortest = [...book.calls].sort((a, b) => a.deadline_minutes - b.deadline_minutes)[0];
        const all = book.assets.filter((a) => a.legal_entity === shortest.legal_entity);
        expect(eligibleAssets(book, shortest.call_id).length).toBeLessThan(all.length);
        expect(all.some((a) => a.settlement_minutes > shortest.deadline_minutes)).toBe(true);
      });

      it("has a cross-currency agreement with a foreign-currency asset the call can actually use", () => {
        const cross = book.agreements.filter((a) => a.cross_currency_allowed);
        expect(cross.length).toBeGreaterThan(0);
        const usable = book.calls.some((call) =>
          cross.some((a) => a.agreement_id === call.agreement_id) &&
          eligibleAssets(book, call.call_id).some((asset) => asset.currency !== call.currency));
        expect(usable).toBe(true);
      });

      it("has a denied issuer that would otherwise be usable, so the exclusion matters", () => {
        const denied = book.agreements.filter((a) => a.denied_issuers.length > 0);
        expect(denied.length).toBeGreaterThan(0);
        for (const agreement of denied) {
          const call = book.calls.find((c) => c.agreement_id === agreement.agreement_id)!;
          const heldByEntity = book.assets.filter((a) => a.legal_entity === call.legal_entity && agreement.denied_issuers.includes(a.issuer));
          expect(heldByEntity.length, agreement.agreement_id).toBeGreaterThan(0);
        }
      });

      it("can reach the issuer cap: one issuer alone could cover more than the cap allows", () => {
        const reachable = book.calls.some((call) => {
          const agreement = book.agreements.find((a) => a.agreement_id === call.agreement_id)!;
          const byIssuer = new Map<string, number>();
          for (const asset of eligibleAssets(book, call.call_id)) {
            const cut = agreement.classes.find((c) => c.asset_class === asset.asset_class)!.haircut;
            byIssuer.set(asset.issuer, (byIssuer.get(asset.issuer) ?? 0) + asset.allocatable_value * (1 - cut) * fx(book, asset.currency));
          }
          const limit = call.required_value * fx(book, call.currency) * agreement.maximum_issuer_fraction;
          return [...byIssuer.values()].some((capacity) => capacity > limit);
        });
        expect(reachable).toBe(true);
      });

      it("reports illustrative haircuts only through agreement classes", () => {
        const sov = HAIRCUT(book, book.agreements[0].agreement_id, "SOVEREIGN");
        expect(sov).toBeGreaterThan(0);
      });
    });
  }
});
