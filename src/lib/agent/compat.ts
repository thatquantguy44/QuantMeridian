/**
 * Contract version compatibility (spec009 NFR-009, AC-032).
 *
 * Every agent contract carries `schema_version: "<name>/<major>"`. A reader accepts its own
 * major version and ignores unknown additive fields; anything else is refused and surfaced as an
 * incompatible state (jobs record `RESULT_SCHEMA_INCOMPATIBLE`).
 */

export const SCHEMA_VERSIONS = {
  workflows: "agent-workflows/1",
  profiles: "llm-profiles/1",
  job: "agent-job/1",
  result: "agent-result/1",
  verification: "agent-verification/1",
  registry: "metric-registry/1",
  pin: "quantsmith-pin/1",
  vectors: "formula-vectors/1",
} as const;

export type ContractKind = keyof typeof SCHEMA_VERSIONS;

export interface ParsedVersion {
  name: string;
  major: number;
}

/** Parse "<name>/<major>"; null when the string has any other shape. */
export function parseSchemaVersion(value: unknown): ParsedVersion | null {
  if (typeof value !== "string") return null;
  const match = /^([a-z][a-z0-9-]*)\/([0-9]+)$/.exec(value);
  return match ? { name: match[1], major: Number(match[2]) } : null;
}

export type Compatibility =
  | { ok: true }
  | { ok: false; reason: "missing" | "malformed" | "wrong_contract" | "unknown_major"; found: string | null };

/** Is `doc` a payload of contract `kind` at the major version this build understands? */
export function checkSchemaVersion(doc: unknown, kind: ContractKind): Compatibility {
  const expected = parseSchemaVersion(SCHEMA_VERSIONS[kind]);
  if (!expected) throw new Error(`invalid built-in version for ${kind}`);
  const raw = doc && typeof doc === "object" ? (doc as { schema_version?: unknown }).schema_version : undefined;
  if (raw === undefined) return { ok: false, reason: "missing", found: null };
  const found = parseSchemaVersion(raw);
  if (!found) return { ok: false, reason: "malformed", found: typeof raw === "string" ? raw : null };
  if (found.name !== expected.name) return { ok: false, reason: "wrong_contract", found: String(raw) };
  if (found.major !== expected.major) return { ok: false, reason: "unknown_major", found: String(raw) };
  return { ok: true };
}
