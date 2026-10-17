import { describe, expect, test } from "vitest";
import {
  configurationToCsv, createEmptyConfiguration, createSource, createUse, parseConfigurationCsv,
  parseConfigurationJson, ruleFor, setCompatibilityRule, validateConfiguration,
  type SourcesUsesConfiguration,
} from "./sourcesUses";

function completeConfiguration(): SourcesUsesConfiguration {
  const configuration = createEmptyConfiguration("Treasury, EMEA \"stress\"\ncase");
  const source = { ...createSource(), label: "Cash pool, secured", category: "Repo\ninternal", amount: 125_000_000, currency: "EUR", haircutPct: 2.5, tags: ["prime", "cash,overnight"] };
  const use = { ...createUse(), label: "CCP margin \"call\"", category: "Margin", amount: 100_000_000, currency: "EUR", policy: "soft" as const, tags: ["urgent"] };
  return { ...configuration, description: "Multi-line description, with commas", sources: [source], uses: [use] };
}

describe("Sources & Uses configuration contracts", () => {
  test("accepts an empty, versioned configuration without fabricated records", () => {
    const config = createEmptyConfiguration();
    expect(config.sources).toEqual([]);
    expect(config.uses).toEqual([]);
    expect(validateConfiguration(config)).toEqual([]);
  });

  test("round-trips JSON and preserves configurable source haircut and custom fields", () => {
    const config = completeConfiguration();
    const imported = parseConfigurationJson(JSON.stringify(config));
    expect(imported).toEqual(config);
    expect(imported.sources[0].haircutPct).toBe(2.5);
    expect(imported.sources[0].category).toBe("Repo\ninternal");
  });

  test("round-trips CSV including quoting, commas, and embedded newlines", () => {
    const config = completeConfiguration();
    const withRule = setCompatibilityRule(config, config.sources[0].id, config.uses[0].id, "allowed");
    const imported = parseConfigurationCsv(configurationToCsv(withRule));
    expect(imported.name).toBe(config.name);
    expect(imported.description).toBe(config.description);
    expect(imported.sources).toEqual(config.sources);
    expect(imported.uses).toEqual(config.uses);
    expect(imported.compatibility).toEqual(withRule.compatibility);
  });

  test("rejects unsupported contract versions instead of silently upgrading them", () => {
    const config = { ...completeConfiguration(), schemaVersion: 99 };
    expect(validateConfiguration(config).some((issue) => issue.path === "schemaVersion")).toBe(true);
    expect(() => parseConfigurationJson(JSON.stringify(config))).toThrow(/schemaVersion/);
  });

  test("rejects duplicate IDs, dangling compatibility references, and unknown policy values", () => {
    const config = completeConfiguration();
    const malformed = {
      ...config,
      sources: [config.sources[0], { ...config.sources[0] }],
      uses: [{ ...config.uses[0], policy: "automatic" }],
      compatibility: [{ sourceId: "missing-source", useId: config.uses[0].id, status: "allowed", note: "" }],
    };
    const paths = validateConfiguration(malformed).map((issue) => issue.path);
    expect(paths).toContain("sources[1].id");
    expect(paths).toContain("uses[0].policy");
    expect(paths).toContain("compatibility[0].sourceId");
  });

  test("enforces configured haircut boundaries without inferring values", () => {
    const config = completeConfiguration();
    expect(validateConfiguration({ ...config, sources: [{ ...config.sources[0], haircutPct: 0 }] })).toEqual([]);
    expect(validateConfiguration({ ...config, sources: [{ ...config.sources[0], haircutPct: 100 }] })).toEqual([]);
    expect(validateConfiguration({ ...config, sources: [{ ...config.sources[0], haircutPct: 100.01 }] }).some((issue) => issue.path === "sources[0].haircutPct")).toBe(true);
  });

  test("leaves pairs unspecified until explicitly allowed and cycles through denied states", () => {
    const config = completeConfiguration();
    const sourceId = config.sources[0].id;
    const useId = config.uses[0].id;
    expect(ruleFor(config, sourceId, useId).status).toBe("unspecified");
    const allowed = setCompatibilityRule(config, sourceId, useId, "allowed");
    expect(ruleFor(allowed, sourceId, useId).status).toBe("allowed");
    const denied = setCompatibilityRule(allowed, sourceId, useId, "denied");
    expect(ruleFor(denied, sourceId, useId).status).toBe("denied");
    const unspecified = setCompatibilityRule(denied, sourceId, useId, "unspecified");
    expect(ruleFor(unspecified, sourceId, useId).status).toBe("unspecified");
    expect(unspecified.compatibility).toEqual([]);
  });

  test("rejects malformed CSV rather than importing a partial configuration", () => {
    expect(() => parseConfigurationCsv('recordType,id,label\nmeta,cfg,"unterminated')).toThrow(/unclosed quoted field/);
    expect(() => parseConfigurationCsv("recordType,id,label\nsource,s1,No metadata")).toThrow(/sources\[0\]\.category/);
  });
});
