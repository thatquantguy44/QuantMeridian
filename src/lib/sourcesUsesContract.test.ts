// Sources & Uses wire contract (spec012 SU-002). The service's Pydantic models publish
// contracts/sources_uses/solve-request.schema.json (services/sources_uses_api/tests/test_contracts.py
// keeps it current). The field maps below are typed `Fields<T>`, so `tsc` fails if one omits or
// invents a key of the TypeScript type; this test fails if those keys differ from the schema.
// contracts/sources_uses/fixtures/canonical-vectors.json is checked by both languages.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  canonicalJson, configurationHash, toConfigurationContent, toSolveRequest,
  type CompatibilityRuleContract, type ConfigurationContent, type SolveRequest,
  type SourceRecordContract, type UseRecordContract,
} from "./sourcesUsesContract";
import {
  configurationToCsv, createEmptyConfiguration, createSource, createUse, parseConfigurationCsv,
  parseConfigurationJson, setCompatibilityRule, type SourcesUsesConfiguration,
} from "@/data/sourcesUses";

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../contracts/sources_uses/${path}`, import.meta.url), "utf-8"));
const SCHEMA = read("solve-request.schema.json");
const VECTORS = read("fixtures/canonical-vectors.json");

type Fields<T> = { [K in keyof Required<T>]: true };
const SOURCE: Fields<SourceRecordContract> = {
  id: true, label: true, category: true, amount: true, cost_bps: true, currency: true, legal_entity: true,
  asset_class: true, tenor_days: true, priority_tier: true, minimum: true, maximum: true, lot_size: true,
  haircut_pct: true, internality: true, tags: true, provenance: true,
};
const USE: Fields<UseRecordContract> = {
  id: true, label: true, category: true, amount: true, bid_bps: true, currency: true, legal_entity: true,
  asset_class: true, tenor_days: true, priority_tier: true, minimum: true, maximum: true, lot_size: true,
  policy: true, shortfall_penalty_bps: true, tags: true, provenance: true,
};
const RULE: Fields<CompatibilityRuleContract> = { source_id: true, use_id: true, status: true, note: true, provenance: true };
const CONTENT: Fields<ConfigurationContent> = { schema_version: true, sources: true, uses: true, compatibility: true };
const REQUEST: Fields<SolveRequest> = { api_schema_version: true, currency: true, configuration: true, configuration_hash: true };

const keys = (fields: object) => Object.keys(fields).sort();
const schemaKeys = (definition: { properties: object }) => Object.keys(definition.properties).sort();

function configuration(): SourcesUsesConfiguration {
  const base = createEmptyConfiguration("Treasury, \"stress\"\ncase");
  const s1 = { ...createSource(), id: "S1", label: "Cash pool", category: "Cash", amount: 1400, costBps: 8, legalEntity: "QMS", internality: "internal" as const };
  const s2 = { ...createSource(), id: "S2", label: "Repo · UST", category: "Secured", amount: 1700.25, costBps: 26, haircutPct: 2, tenorDays: 1, tags: ["SIM"], internality: "external" as const };
  const u1 = { ...createUse(), id: "U1", label: "CCP margin", category: "Margin", amount: 900, policy: "hard" as const };
  const u2 = { ...createUse(), id: "U2", label: "Client shorts", category: "Prime", amount: 0.000001, policy: "soft" as const, shortfallPenaltyBps: 40, priorityTier: 2 };
  let config: SourcesUsesConfiguration = { ...base, sources: [s1, s2], uses: [u1, u2] };
  config = setCompatibilityRule(config, "S1", "U1", "allowed");
  config = setCompatibilityRule(config, "S2", "U2", "denied");
  return config;
}

describe("contract parity with the service schema", () => {
  test("TypeScript record types have exactly the schema's fields", () => {
    expect(keys(SOURCE)).toEqual(schemaKeys(SCHEMA.$defs.SourceRecord));
    expect(keys(USE)).toEqual(schemaKeys(SCHEMA.$defs.UseRecord));
    expect(keys(RULE)).toEqual(schemaKeys(SCHEMA.$defs.CompatibilityRule));
    expect(keys(CONTENT)).toEqual(schemaKeys(SCHEMA.$defs.ConfigurationContent));
    expect(keys(REQUEST)).toEqual(schemaKeys(SCHEMA));
  });

  test("the mapped wire records carry every contract field", () => {
    const content = toConfigurationContent(configuration());
    expect(keys(content.sources[0])).toEqual(keys(SOURCE));
    expect(keys(content.uses[0])).toEqual(keys(USE));
    expect(keys(content.compatibility[0])).toEqual(keys(RULE));
  });
});

describe("canonical JSON", () => {
  test.each(VECTORS.numbers as { value: number; canonical: string }[])("serializes $canonical like the service", ({ value, canonical }) => {
    expect(canonicalJson(value)).toBe(canonical);
  });

  test("sorts object keys and rejects non-finite numbers", () => {
    expect(canonicalJson({ b: 1, a: [true, null, "x"] })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalJson({ a: undefined })).toThrow(/undefined/);
  });

  test.each(VECTORS.configurations as { name: string; content: ConfigurationContent; configuration_hash: string }[])(
    "configuration vector $name hashes as the service does",
    async ({ content, configuration_hash }) => {
      expect(await configurationHash(content)).toBe(configuration_hash);
    },
  );
});

describe("configuration content and hash", () => {
  test("maps the browser schema without inventing values, marking SIM-tagged records", () => {
    const content = toConfigurationContent(configuration());
    const s2 = content.sources.find((s) => s.id === "S2")!;
    expect(s2).toMatchObject({ amount: 1700.25, cost_bps: 26, haircut_pct: 2, internality: "external", provenance: "sim" });
    expect(content.sources.find((s) => s.id === "S1")!.provenance).toBe("user_input");
    expect(content.compatibility.map((r) => [r.source_id, r.use_id, r.status])).toEqual([["S1", "U1", "allowed"], ["S2", "U2", "denied"]]);
  });

  test("AC-001: JSON and CSV export/reimport keep the canonical hash", async () => {
    const config = configuration();
    const hash = await configurationHash(toConfigurationContent(config));
    expect(await configurationHash(toConfigurationContent(parseConfigurationJson(JSON.stringify(config))))).toBe(hash);
    expect(await configurationHash(toConfigurationContent(parseConfigurationCsv(configurationToCsv(config))))).toBe(hash);
  });

  test("ignores record order, names and timestamps", async () => {
    const config = configuration();
    const reordered = { ...config, name: "Renamed", updatedAt: "2030-01-01T00:00:00.000Z", sources: [...config.sources].reverse(), uses: [...config.uses].reverse(), compatibility: [...config.compatibility].reverse() };
    expect(await configurationHash(toConfigurationContent(reordered))).toBe(await configurationHash(toConfigurationContent(config)));
  });

  test("AC-009: changing a source haircut changes the hash", async () => {
    const config = configuration();
    const changed = { ...config, sources: config.sources.map((s) => (s.id === "S1" ? { ...s, haircutPct: 0.5 } : s)) };
    expect(await configurationHash(toConfigurationContent(changed))).not.toBe(await configurationHash(toConfigurationContent(config)));
  });

  test("builds a single-currency solve request carrying the configuration hash", async () => {
    const config = configuration();
    const request = await toSolveRequest(config, "USD");
    expect(request).toMatchObject({ api_schema_version: "1.0.0", currency: "USD", configuration_hash: await configurationHash(toConfigurationContent(config)) });
  });
});
