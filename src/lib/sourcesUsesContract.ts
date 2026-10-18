// Versioned wire contract for the Sources & Uses service (spec012 SU-002). Mirrors
// services/sources_uses_api/src/sources_uses_api/contracts.py; sourcesUsesContract.test.ts holds the
// two to the published schema and to shared canonical-hash vectors.
//
// The browser keeps its own v1 configuration schema (src/data/sourcesUses.ts). This module maps it
// onto the contract without converting or rounding amounts (question 2), and hashes only the
// model-relevant content: a configuration's name, ID and timestamps never change its hash.
import type { CompatibilityRule, ConfigurableSource, ConfigurableUse, SourcesUsesConfiguration } from "@/data/sourcesUses";

export const API_SCHEMA_VERSION = "1.0.0";
export const CONFIGURATION_SCHEMA_VERSION = "1.0.0";

/** Where a record came from (SU-009). `sim` marks records copied from the SU-SIM showcase. */
export type RecordProvenance = "user_input" | "sim";

interface RecordContract {
  id: string;
  label: string;
  category: string;
  amount: number;
  currency: string;
  legal_entity: string;
  asset_class: string;
  tenor_days: number | null;
  priority_tier: number;
  minimum: number | null;
  maximum: number | null;
  lot_size: number | null;
  tags: string[];
  provenance: RecordProvenance;
}

export interface SourceRecordContract extends RecordContract {
  cost_bps: number;
  haircut_pct: number;
  internality: ConfigurableSource["internality"];
}

export interface UseRecordContract extends RecordContract {
  bid_bps: number;
  policy: ConfigurableUse["policy"];
  shortfall_penalty_bps: number;
}

export interface CompatibilityRuleContract {
  source_id: string;
  use_id: string;
  status: CompatibilityRule["status"];
  note: string;
  provenance: RecordProvenance;
}

export interface ConfigurationContent {
  schema_version: typeof CONFIGURATION_SCHEMA_VERSION;
  sources: SourceRecordContract[];
  uses: UseRecordContract[];
  compatibility: CompatibilityRuleContract[];
}

export interface SolveRequest {
  api_schema_version: typeof API_SCHEMA_VERSION;
  /** Exactly one currency per run (question 4); the service rejects records in any other. */
  currency: string;
  configuration: ConfigurationContent;
  configuration_hash: string;
}

export function toConfigurationContent(configuration: SourcesUsesConfiguration): ConfigurationContent {
  const sim = new Set([...configuration.sources, ...configuration.uses].filter((r) => r.tags.includes("SIM")).map((r) => r.id));
  const provenance = (id: string): RecordProvenance => (sim.has(id) ? "sim" : "user_input");
  return {
    schema_version: CONFIGURATION_SCHEMA_VERSION,
    sources: configuration.sources.map((s) => ({
      ...common(s), provenance: provenance(s.id),
      cost_bps: s.costBps, haircut_pct: s.haircutPct, internality: s.internality,
    })),
    uses: configuration.uses.map((u) => ({
      ...common(u), provenance: provenance(u.id),
      bid_bps: u.bidBps, policy: u.policy, shortfall_penalty_bps: u.shortfallPenaltyBps,
    })),
    // A rule is as user-entered as its records; a rule copied with SIM records is SIM.
    compatibility: configuration.compatibility.map((r) => ({
      source_id: r.sourceId, use_id: r.useId, status: r.status, note: r.note,
      provenance: sim.has(r.sourceId) && sim.has(r.useId) ? "sim" : "user_input",
    })),
  };
}

/** SHA-256 of the canonical content; the order of records and rules does not matter. */
export async function configurationHash(content: ConfigurationContent): Promise<string> {
  const byId = <T extends { id: string }>(records: T[]) => [...records].sort((a, b) => compare(a.id, b.id));
  return sha256Hex(canonicalJson({
    ...content,
    sources: byId(content.sources),
    uses: byId(content.uses),
    compatibility: [...content.compatibility].sort((a, b) => compare(a.source_id, b.source_id) || compare(a.use_id, b.use_id)),
  }));
}

export async function toSolveRequest(configuration: SourcesUsesConfiguration, currency: string): Promise<SolveRequest> {
  const content = toConfigurationContent(configuration);
  return { api_schema_version: API_SCHEMA_VERSION, currency, configuration: content, configuration_hash: await configurationHash(content) };
}

/** JSON.stringify with sorted keys and no whitespace; the service's canonical.py matches it byte for byte. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite numbers have no canonical JSON form");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => compare(a, b));
    return `{${entries.map(([key, item]) => {
      if (item === undefined) throw new Error(`cannot canonicalize undefined at ${key}`);
      return `${JSON.stringify(key)}:${canonicalJson(item)}`;
    }).join(",")}}`;
  }
  throw new Error(`cannot canonicalize ${typeof value}`);
}

function common(r: ConfigurableSource | ConfigurableUse) {
  return {
    id: r.id, label: r.label, category: r.category, amount: r.amount, currency: r.currency,
    legal_entity: r.legalEntity, asset_class: r.assetClass, tenor_days: r.tenorDays,
    priority_tier: r.priorityTier, minimum: r.minimum, maximum: r.maximum, lot_size: r.lotSize, tags: r.tags,
  };
}

// Code-unit order; the contract limits IDs and keys to ASCII, where it equals Python's order.
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
