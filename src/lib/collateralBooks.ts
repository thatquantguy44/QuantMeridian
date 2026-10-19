/**
 * Deterministic, synthetic collateral books in the model's native 1.0 snapshot format (spec016 COLL-013).
 *
 * These are INPUTS only. Every economic figure, verification and saving comes from the pinned service,
 * which re-validates the snapshot strictly. They are submitted as USER_UPLOAD and labelled generated,
 * never SIM. Names are fictional and agreement terms are illustrative with no legal authority.
 *
 * What makes them more realistic than the upstream demo book:
 *  - single-issuer sovereign pools against a per-call issuer cap, so the cap actually binds;
 *  - call deadlines from 60 minutes (intraday CCP) to next day, so slow asset classes drop out of urgent calls;
 *  - a cross-currency agreement with a cheaper foreign-currency lot, so FX is used;
 *  - denied issuers that hold otherwise attractive lots, so the exclusion changes the answer;
 *  - named fictional counterparties and issuers.
 */

export interface NativeFx { currency: string; usd_per_unit: number; observed_at: string }
export interface NativeAsset {
  asset_id: string; asset_class: string; issuer: string; legal_entity: string; custodian: string; currency: string;
  allocatable_value: number; annual_carry_bps: number; liquidity_credit: number; settlement_minutes: number;
  minimum_lot_value: number; fixed_activation_fee_usd: number; variable_move_bps: number; observed_at: string;
}
export interface NativeCall {
  call_id: string; agreement_id: string; margin_type: "IM" | "VM" | "CCP" | "REPO"; counterparty: string;
  legal_entity: string; currency: string; required_value: number; deadline_minutes: number; observed_at: string;
}
export interface NativeAgreement {
  agreement_id: string; legal_entity: string; effective_from: string; effective_until: string | null;
  allowed_custodians: string[]; cross_currency_allowed: boolean; maximum_issuer_fraction: number;
  classes: { asset_class: string; haircut: number }[]; denied_issuers: string[];
}
export interface NativePledge { asset_id: string; call_id: string; market_value: number }
export interface NativeSnapshot {
  schema_version: "1.0"; book_id: string; source: string; as_of: string; horizon_days: number;
  max_input_age_minutes: number; minimum_liquidity_reserve_usd: number;
  fx: NativeFx[]; assets: NativeAsset[]; calls: NativeCall[]; agreements: NativeAgreement[];
  current_pledges: NativePledge[]; scenario_id: string | null; parent_hash: string | null;
}

export type BookProfileId = "dealer" | "asset_manager";
export interface BookProfile { id: BookProfileId; label: string; blurb: string }

export const BOOK_PROFILES: BookProfile[] = [
  { id: "dealer", label: "Dealer book", blurb: "Three entities and eight calls from intraday CCP to next-day bilateral, with a binding issuer cap, a denied issuer and a cross-currency CSA." },
  { id: "asset_manager", label: "Asset manager book", blurb: "Two entities and five calls over equity, investment-grade and gold inventory, with issuer caps that bind and less cash." },
];

const AS_OF = "2026-10-15T10:00:00Z";
const OBSERVED = "2026-10-15T09:55:00Z";
const EFFECTIVE_FROM = "2026-09-15T10:00:00Z";
const MM = 1e6;
const TRIPARTY = "TRIPARTY-CUST";

type Entity = "US" | "EU" | "UK";
const ENTITIES: Record<Entity, { currency: string; custodian: string }> = {
  US: { currency: "USD", custodian: "CUST-US" },
  EU: { currency: "EUR", custodian: "CUST-EU" },
  UK: { currency: "GBP", custodian: "CUST-UK" },
};
const FX: NativeFx[] = [
  { currency: "USD", usd_per_unit: 1, observed_at: OBSERVED },
  { currency: "EUR", usd_per_unit: 1.09, observed_at: OBSERVED },
  { currency: "GBP", usd_per_unit: 1.31, observed_at: OBSERVED },
];

const HAIRCUT: Record<string, number> = { CASH: 0, SOVEREIGN: 0.02, AGENCY: 0.05, IG: 0.08, EQUITY: 0.18, GOLD: 0.15 };
const CARRY: Record<string, number> = { CASH: 39, SOVEREIGN: 25, AGENCY: 42, IG: 55, EQUITY: 90, GOLD: 72 };
const CREDIT: Record<string, number> = { CASH: 1, SOVEREIGN: 0.9, AGENCY: 0.65, IG: 0.15, EQUITY: 0, GOLD: 0 };
const SETTLE: Record<string, number> = { CASH: 10, SOVEREIGN: 30, AGENCY: 60, IG: 75, EQUITY: 120, GOLD: 150 };
const KIND_CLASSES = {
  CSA: ["CASH", "SOVEREIGN", "AGENCY", "IG", "EQUITY", "GOLD"],
  CCP: ["CASH", "SOVEREIGN", "AGENCY", "IG"],
  REPO: ["CASH", "SOVEREIGN", "IG"],
} as const;

interface AgreementSpec { id: string; entity: Entity; kind: keyof typeof KIND_CLASSES; cap: number; cross?: boolean; denied?: string[] }
interface CallSpec { id: string; agreement: string; type: NativeCall["margin_type"]; counterparty: string; mm: number; deadline: number }
interface LotSpec { cls: string; issuer: string; mm: number }
interface ProfileSpec {
  bookId: string; reserveMm: number; agreements: AgreementSpec[]; calls: CallSpec[];
  lots: (entity: Entity) => LotSpec[]; foreignLots: Partial<Record<Entity, { currency: string; mm: number[]; issuer: string; carry: number }>>;
}

const lot = (cls: string, issuer: string, mm: number): LotSpec => ({ cls, issuer, mm });

const IG_ISSUERS: Record<Entity, string[]> = {
  US: ["CORP-IG-01", "CORP-IG-01", "CORP-IG-04", "CORP-IG-02"],
  EU: ["CORP-IG-01", "CORP-IG-05", "CORP-IG-05", "CORP-IG-02"],
  UK: ["CORP-IG-03", "CORP-IG-03", "CORP-IG-06", "CORP-IG-02"],
};

const PROFILES: Record<BookProfileId, ProfileSpec> = {
  dealer: {
    bookId: "GEN-DEALER-20261015",
    reserveMm: 550,
    agreements: [
      { id: "CSA-US", entity: "US", kind: "CSA", cap: 0.6, denied: ["CORP-IG-04"] },
      { id: "CCP-US", entity: "US", kind: "CCP", cap: 0.7 },
      { id: "REPO-US", entity: "US", kind: "REPO", cap: 0.7 },
      { id: "CSA-EU", entity: "EU", kind: "CSA", cap: 0.6, cross: true },
      { id: "CCP-EU", entity: "EU", kind: "CCP", cap: 0.7 },
      { id: "CSA-UK", entity: "UK", kind: "CSA", cap: 0.6, denied: ["CORP-IG-03"] },
      { id: "REPO-UK", entity: "UK", kind: "REPO", cap: 0.7 },
    ],
    calls: [
      { id: "US-CCP-1", agreement: "CCP-US", type: "CCP", counterparty: "Granite Clearing", mm: 72, deadline: 60 },
      { id: "US-CSA-1", agreement: "CSA-US", type: "IM", counterparty: "Aster Capital", mm: 68, deadline: 1440 },
      { id: "US-CSA-2", agreement: "CSA-US", type: "VM", counterparty: "Corvus Prime", mm: 55, deadline: 240 },
      { id: "US-REPO-1", agreement: "REPO-US", type: "REPO", counterparty: "Halcyon Repo", mm: 46, deadline: 120 },
      { id: "EU-CCP-1", agreement: "CCP-EU", type: "CCP", counterparty: "Beacon Clearing", mm: 39, deadline: 60 },
      { id: "EU-CSA-1", agreement: "CSA-EU", type: "IM", counterparty: "Delta Ridge Bank", mm: 42, deadline: 1440 },
      { id: "UK-CSA-1", agreement: "CSA-UK", type: "VM", counterparty: "Ember Trust", mm: 51, deadline: 240 },
      { id: "UK-REPO-1", agreement: "REPO-UK", type: "REPO", counterparty: "Fennel Securities", mm: 36, deadline: 120 },
    ],
    lots: (e) => [
      lot("CASH", `CASH-${e}`, 40), lot("CASH", `CASH-${e}`, 45),
      lot("SOVEREIGN", `SOV-${e}`, 60), lot("SOVEREIGN", `SOV-${e}`, 55), lot("SOVEREIGN", `SOV-${e}`, 50), lot("SOVEREIGN", `SOV-${e}`, 45),
      lot("AGENCY", "AGY-ALPHA", 48), lot("AGENCY", "AGY-ALPHA", 42), lot("AGENCY", "AGY-BETA", 52),
      ...[70, 60, 55, 50].map((mm, i) => lot("IG", IG_ISSUERS[e][i], mm)),
      lot("EQUITY", `EQ-${e}-A`, 55), lot("EQUITY", `EQ-${e}-B`, 45),
      lot("GOLD", `GOLD-${e}`, 40),
    ],
    // Cheaper dollar sovereigns held by the EU entity: usable only because CSA-EU allows cross-currency.
    foreignLots: { EU: { currency: "USD", mm: [80, 70], issuer: "SOV-US", carry: 21 } },
  },
  asset_manager: {
    bookId: "GEN-ASSETMGR-20261015",
    reserveMm: 400,
    agreements: [
      { id: "CSA-US", entity: "US", kind: "CSA", cap: 0.6, denied: ["CORP-IG-04"] },
      { id: "REPO-US", entity: "US", kind: "REPO", cap: 0.65 },
      { id: "CSA-EU", entity: "EU", kind: "CSA", cap: 0.6, cross: true },
      { id: "CCP-EU", entity: "EU", kind: "CCP", cap: 0.65 },
    ],
    calls: [
      { id: "US-CSA-1", agreement: "CSA-US", type: "IM", counterparty: "Aster Capital", mm: 61, deadline: 1440 },
      { id: "US-CSA-2", agreement: "CSA-US", type: "VM", counterparty: "Corvus Prime", mm: 38, deadline: 240 },
      { id: "US-REPO-1", agreement: "REPO-US", type: "REPO", counterparty: "Halcyon Repo", mm: 30, deadline: 120 },
      { id: "EU-CSA-1", agreement: "CSA-EU", type: "VM", counterparty: "Delta Ridge Bank", mm: 27, deadline: 240 },
      { id: "EU-CCP-1", agreement: "CCP-EU", type: "CCP", counterparty: "Beacon Clearing", mm: 22, deadline: 60 },
    ],
    lots: (e) => [
      lot("CASH", `CASH-${e}`, 30),
      lot("SOVEREIGN", `SOV-${e}`, 50), lot("SOVEREIGN", `SOV-${e}`, 45), lot("SOVEREIGN", `SOV-${e}`, 40),
      lot("AGENCY", "AGY-ALPHA", 40), lot("AGENCY", "AGY-BETA", 35),
      ...[70, 60, 55, 50].map((mm, i) => lot("IG", IG_ISSUERS[e][i], mm)),
      lot("EQUITY", `EQ-${e}-A`, 60), lot("EQUITY", `EQ-${e}-B`, 50), lot("EQUITY", `EQ-${e}-C`, 45),
      lot("GOLD", `GOLD-${e}`, 35),
    ],
    foreignLots: { EU: { currency: "USD", mm: [75, 65], issuer: "SOV-US", carry: 21 } },
  },
};

const money = (value: number) => Math.round(value * 100) / 100;

export function buildGeneratedBook(profileId: BookProfileId): NativeSnapshot {
  const spec = PROFILES[profileId];
  const agreements: NativeAgreement[] = spec.agreements.map((a) => ({
    agreement_id: a.id,
    legal_entity: a.entity,
    effective_from: EFFECTIVE_FROM,
    effective_until: null,
    allowed_custodians: [ENTITIES[a.entity].custodian, TRIPARTY],
    cross_currency_allowed: Boolean(a.cross),
    maximum_issuer_fraction: a.cap,
    classes: KIND_CLASSES[a.kind].map((asset_class) => ({ asset_class, haircut: HAIRCUT[asset_class] })),
    denied_issuers: a.denied ?? [],
  }));
  const agreementById = new Map(agreements.map((a) => [a.agreement_id, a]));

  const calls: NativeCall[] = spec.calls.map((c) => {
    const agreement = agreementById.get(c.agreement)!;
    return {
      call_id: c.id, agreement_id: c.agreement, margin_type: c.type, counterparty: c.counterparty,
      legal_entity: agreement.legal_entity, currency: ENTITIES[agreement.legal_entity as Entity].currency,
      required_value: c.mm * MM, deadline_minutes: c.deadline, observed_at: OBSERVED,
    };
  });

  const assets: NativeAsset[] = [];
  const pledges: NativePledge[] = [];

  // The incumbent: two expensive legacy holdings per call that together cover it at 105% after haircuts.
  for (const call of calls) {
    const agreement = agreementById.get(call.agreement_id)!;
    for (const [leg, cls, fraction, carry, credit] of [["A", "IG", 0.55, 128, 0.15], ["B", "SOVEREIGN", 0.5, 82, 0.9]] as const) {
      const asset_id = `GEN-HELD-${call.call_id}-${leg}`;
      assets.push({
        asset_id, asset_class: cls, issuer: `LEGACY-${call.call_id}-${leg}`, legal_entity: call.legal_entity,
        custodian: ENTITIES[call.legal_entity as Entity].custodian, currency: call.currency, allocatable_value: 95 * MM,
        annual_carry_bps: carry, liquidity_credit: credit, settlement_minutes: 90, minimum_lot_value: 0,
        fixed_activation_fee_usd: 0, variable_move_bps: 0.4, observed_at: OBSERVED,
      });
      const haircut = agreement.classes.find((r) => r.asset_class === cls)!.haircut;
      pledges.push({ asset_id, call_id: call.call_id, market_value: money((call.required_value * fraction) / (1 - haircut)) });
    }
  }

  // Free inventory per entity that has at least one call.
  const entities = [...new Set(spec.agreements.map((a) => a.entity))];
  for (const entity of entities) {
    const { currency, custodian } = ENTITIES[entity];
    spec.lots(entity).forEach((l, index) => {
      assets.push({
        asset_id: `GEN-${entity}-${l.cls.slice(0, 3)}-${String(index + 1).padStart(2, "0")}`,
        asset_class: l.cls, issuer: l.issuer, legal_entity: entity,
        custodian: index % 4 === 3 ? TRIPARTY : custodian, currency, allocatable_value: l.mm * MM,
        annual_carry_bps: CARRY[l.cls] + (index % 5), liquidity_credit: CREDIT[l.cls], settlement_minutes: SETTLE[l.cls],
        minimum_lot_value: index % 7 === 0 ? 5 * MM : 0, fixed_activation_fee_usd: index % 5 === 0 ? 750 : 0,
        variable_move_bps: 0.6, observed_at: OBSERVED,
      });
    });
    const foreign = spec.foreignLots[entity];
    if (foreign) {
      foreign.mm.forEach((mm, index) => assets.push({
        asset_id: `GEN-${entity}-X${foreign.currency}-${index + 1}`,
        asset_class: "SOVEREIGN", issuer: foreign.issuer, legal_entity: entity, custodian,
        currency: foreign.currency, allocatable_value: mm * MM, annual_carry_bps: foreign.carry + index,
        liquidity_credit: CREDIT.SOVEREIGN, settlement_minutes: SETTLE.SOVEREIGN, minimum_lot_value: 0,
        fixed_activation_fee_usd: 0, variable_move_bps: 0.6, observed_at: OBSERVED,
      }));
    }
  }

  return {
    schema_version: "1.0",
    book_id: spec.bookId,
    source: `GENERATED-DEMO:${profileId}`,
    as_of: AS_OF,
    horizon_days: 30,
    max_input_age_minutes: 60,
    minimum_liquidity_reserve_usd: spec.reserveMm * MM,
    fx: FX.map((q) => ({ ...q })),
    assets,
    calls,
    agreements,
    current_pledges: pledges,
    scenario_id: null,
    parent_hash: null,
  };
}
