export const SOURCES_USES_SCHEMA_VERSION = 1;

export type CompatibilityStatus = "unspecified" | "allowed" | "denied";
export type UsePolicy = "hard" | "soft";

export interface ConfigurableSource {
  id: string;
  label: string;
  category: string;
  amount: number;
  costBps: number;
  currency: string;
  legalEntity: string;
  assetClass: string;
  tenorDays: number | null;
  priorityTier: number;
  minimum: number | null;
  maximum: number | null;
  lotSize: number | null;
  haircutPct: number;
  internality: "internal" | "external" | "unclassified";
  tags: string[];
}

export interface ConfigurableUse {
  id: string;
  label: string;
  category: string;
  amount: number;
  bidBps: number;
  currency: string;
  legalEntity: string;
  assetClass: string;
  tenorDays: number | null;
  priorityTier: number;
  minimum: number | null;
  maximum: number | null;
  lotSize: number | null;
  policy: UsePolicy;
  shortfallPenaltyBps: number;
  tags: string[];
}

export interface CompatibilityRule {
  sourceId: string;
  useId: string;
  status: CompatibilityStatus;
  note: string;
}

export interface SourcesUsesConfiguration {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  sources: ConfigurableSource[];
  uses: ConfigurableUse[];
  compatibility: CompatibilityRule[];
}

export interface ConfigurationIssue {
  path: string;
  message: string;
}

export const CONFIGURATION_STORAGE_KEY = "quantmeridian.sxu.configurations.v1";

export function createEmptyConfiguration(name = "Untitled configuration"): SourcesUsesConfiguration {
  return {
    schemaVersion: SOURCES_USES_SCHEMA_VERSION,
    id: newId("cfg"),
    name,
    description: "",
    updatedAt: new Date().toISOString(),
    sources: [],
    uses: [],
    compatibility: [],
  };
}

export function createSource(): ConfigurableSource {
  return {
    id: newId("src"), label: "", category: "", amount: 0, costBps: 0,
    currency: "USD", legalEntity: "", assetClass: "", tenorDays: null,
    priorityTier: 1, minimum: null, maximum: null, lotSize: null,
    haircutPct: 0, internality: "unclassified", tags: [],
  };
}

export function createUse(): ConfigurableUse {
  return {
    id: newId("use"), label: "", category: "", amount: 0, bidBps: 0,
    currency: "USD", legalEntity: "", assetClass: "", tenorDays: null,
    priorityTier: 1, minimum: null, maximum: null, lotSize: null,
    policy: "hard", shortfallPenaltyBps: 0, tags: [],
  };
}

export function newId(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

export function ruleFor(
  configuration: SourcesUsesConfiguration,
  sourceId: string,
  useId: string,
): CompatibilityRule {
  return configuration.compatibility.find((rule) => rule.sourceId === sourceId && rule.useId === useId)
    ?? { sourceId, useId, status: "unspecified", note: "" };
}

export function setCompatibilityRule(
  configuration: SourcesUsesConfiguration,
  sourceId: string,
  useId: string,
  status: CompatibilityStatus,
): SourcesUsesConfiguration {
  const current = ruleFor(configuration, sourceId, useId);
  const compatibility = configuration.compatibility.filter((rule) => !(rule.sourceId === sourceId && rule.useId === useId));
  if (status !== "unspecified" || current.note.trim()) compatibility.push({ ...current, status });
  return touch({ ...configuration, compatibility });
}

export function touch(configuration: SourcesUsesConfiguration): SourcesUsesConfiguration {
  return { ...configuration, updatedAt: new Date().toISOString() };
}

export function validateConfiguration(value: unknown): ConfigurationIssue[] {
  const issues: ConfigurationIssue[] = [];
  if (!isRecord(value)) return [{ path: "configuration", message: "Expected a configuration object." }];
  if (value.schemaVersion !== SOURCES_USES_SCHEMA_VERSION) {
    issues.push({ path: "schemaVersion", message: `Expected schema version ${SOURCES_USES_SCHEMA_VERSION}.` });
  }
  if (typeof value.id !== "string" || !value.id.trim()) issues.push({ path: "id", message: "Configuration ID is required." });
  if (typeof value.name !== "string" || !value.name.trim()) issues.push({ path: "name", message: "Configuration name is required." });
  if (!Array.isArray(value.sources)) issues.push({ path: "sources", message: "Sources must be an array." });
  if (!Array.isArray(value.uses)) issues.push({ path: "uses", message: "Uses must be an array." });
  if (!Array.isArray(value.compatibility)) issues.push({ path: "compatibility", message: "Compatibility rules must be an array." });
  if (issues.length) return issues;

  const sources = value.sources as unknown[];
  const uses = value.uses as unknown[];
  const sourceIds = new Set<string>();
  const useIds = new Set<string>();
  sources.forEach((source, index) => {
    const path = `sources[${index}]`;
    if (!isRecord(source)) { issues.push({ path, message: "Expected a source object." }); return; }
    checkIdentity(source, path, sourceIds, issues);
    checkRequiredText(source, "label", path, issues);
    checkRequiredText(source, "category", path, issues);
    checkNumber(source, "amount", path, issues, { min: 0 });
    checkNumber(source, "costBps", path, issues, { min: 0 });
    checkNumber(source, "haircutPct", path, issues, { min: 0, max: 100 });
    checkNumber(source, "priorityTier", path, issues, { min: 1 });
    checkOptionalNumber(source, "tenorDays", path, issues, { min: 0 });
    checkOptionalNumber(source, "minimum", path, issues, { min: 0 });
    checkOptionalNumber(source, "maximum", path, issues, { min: 0 });
    checkOptionalNumber(source, "lotSize", path, issues, { min: 0 });
    checkRequiredText(source, "currency", path, issues);
    checkStringArray(source, "tags", path, issues);
    if (!(["internal", "external", "unclassified"] as unknown[]).includes(source.internality)) {
      issues.push({ path: `${path}.internality`, message: "Choose internal, external, or unclassified." });
    }
    checkBounds(source, path, issues);
  });
  uses.forEach((use, index) => {
    const path = `uses[${index}]`;
    if (!isRecord(use)) { issues.push({ path, message: "Expected a use object." }); return; }
    checkIdentity(use, path, useIds, issues);
    checkRequiredText(use, "label", path, issues);
    checkRequiredText(use, "category", path, issues);
    checkNumber(use, "amount", path, issues, { min: 0 });
    checkNumber(use, "bidBps", path, issues, { min: 0 });
    checkNumber(use, "shortfallPenaltyBps", path, issues, { min: 0 });
    checkNumber(use, "priorityTier", path, issues, { min: 1 });
    checkOptionalNumber(use, "tenorDays", path, issues, { min: 0 });
    checkOptionalNumber(use, "minimum", path, issues, { min: 0 });
    checkOptionalNumber(use, "maximum", path, issues, { min: 0 });
    checkOptionalNumber(use, "lotSize", path, issues, { min: 0 });
    checkRequiredText(use, "currency", path, issues);
    checkStringArray(use, "tags", path, issues);
    if (use.policy !== "hard" && use.policy !== "soft") issues.push({ path: `${path}.policy`, message: "Choose hard or soft." });
    checkBounds(use, path, issues);
  });
  (value.compatibility as unknown[]).forEach((rule, index) => {
    const path = `compatibility[${index}]`;
    if (!isRecord(rule)) { issues.push({ path, message: "Expected a compatibility rule object." }); return; }
    if (typeof rule.sourceId !== "string" || !sourceIds.has(rule.sourceId)) issues.push({ path: `${path}.sourceId`, message: "Rule references an unknown source." });
    if (typeof rule.useId !== "string" || !useIds.has(rule.useId)) issues.push({ path: `${path}.useId`, message: "Rule references an unknown use." });
    if (!(["unspecified", "allowed", "denied"] as unknown[]).includes(rule.status)) issues.push({ path: `${path}.status`, message: "Choose unspecified, allowed, or denied." });
    if (typeof rule.note !== "string") issues.push({ path: `${path}.note`, message: "Rule note must be text." });
  });
  return issues;
}

export function parseConfigurationJson(text: string): SourcesUsesConfiguration {
  const value: unknown = JSON.parse(text);
  const candidate = isRecord(value) && Array.isArray(value.configurations)
    ? value.configurations[0]
    : value;
  const issues = validateConfiguration(candidate);
  if (issues.length) throw new Error(issues.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
  return candidate as unknown as SourcesUsesConfiguration;
}

export function configurationToCsv(configuration: SourcesUsesConfiguration): string {
  const headers = ["recordType", "id", "label", "category", "amount", "currency", "costBps", "bidBps", "legalEntity", "assetClass", "tenorDays", "priorityTier", "minimum", "maximum", "lotSize", "haircutPct", "internality", "policy", "shortfallPenaltyBps", "tags", "sourceId", "useId", "status", "note"];
  const rows: unknown[][] = [
    ["meta", configuration.id, configuration.name, configuration.description, configuration.schemaVersion, configuration.updatedAt],
    ...configuration.sources.map((source) => ["source", source.id, source.label, source.category, source.amount, source.currency, source.costBps, "", source.legalEntity, source.assetClass, source.tenorDays ?? "", source.priorityTier, source.minimum ?? "", source.maximum ?? "", source.lotSize ?? "", source.haircutPct, source.internality, "", "", JSON.stringify(source.tags)]),
    ...configuration.uses.map((use) => ["use", use.id, use.label, use.category, use.amount, use.currency, "", use.bidBps, use.legalEntity, use.assetClass, use.tenorDays ?? "", use.priorityTier, use.minimum ?? "", use.maximum ?? "", use.lotSize ?? "", "", "", use.policy, use.shortfallPenaltyBps, JSON.stringify(use.tags)]),
    ...configuration.compatibility.map((rule) => ["compatibility", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", rule.sourceId, rule.useId, rule.status, rule.note]),
  ];
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function parseConfigurationCsv(text: string): SourcesUsesConfiguration {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("CSV has no configuration records.");
  const headers = rows[0];
  const idx = (key: string) => headers.indexOf(key);
  const cell = (row: string[], key: string) => row[idx(key)] ?? "";
  let meta: string[] | undefined;
  const sources: ConfigurableSource[] = [];
  const uses: ConfigurableUse[] = [];
  const compatibility: CompatibilityRule[] = [];
  for (const row of rows.slice(1)) {
    const type = cell(row, "recordType");
    if (!type) continue;
    if (type === "meta") { meta = row; continue; }
    if (type === "source") {
      sources.push({
        id: cell(row, "id"), label: cell(row, "label"), category: cell(row, "category"), amount: numericCell(cell(row, "amount")),
        currency: cell(row, "currency"), costBps: numericCell(cell(row, "costBps")), legalEntity: cell(row, "legalEntity"), assetClass: cell(row, "assetClass"),
        tenorDays: optionalNumericCell(cell(row, "tenorDays")), priorityTier: numericCell(cell(row, "priorityTier"), 1), minimum: optionalNumericCell(cell(row, "minimum")),
        maximum: optionalNumericCell(cell(row, "maximum")), lotSize: optionalNumericCell(cell(row, "lotSize")), haircutPct: numericCell(cell(row, "haircutPct")),
        internality: cell(row, "internality") as ConfigurableSource["internality"], tags: parseTags(cell(row, "tags")),
      });
    } else if (type === "use") {
      uses.push({
        id: cell(row, "id"), label: cell(row, "label"), category: cell(row, "category"), amount: numericCell(cell(row, "amount")),
        currency: cell(row, "currency"), bidBps: numericCell(cell(row, "bidBps")), legalEntity: cell(row, "legalEntity"), assetClass: cell(row, "assetClass"),
        tenorDays: optionalNumericCell(cell(row, "tenorDays")), priorityTier: numericCell(cell(row, "priorityTier"), 1), minimum: optionalNumericCell(cell(row, "minimum")),
        maximum: optionalNumericCell(cell(row, "maximum")), lotSize: optionalNumericCell(cell(row, "lotSize")), policy: cell(row, "policy") as UsePolicy,
        shortfallPenaltyBps: numericCell(cell(row, "shortfallPenaltyBps")), tags: parseTags(cell(row, "tags")),
      });
    } else if (type === "compatibility") {
      compatibility.push({ sourceId: cell(row, "sourceId"), useId: cell(row, "useId"), status: cell(row, "status") as CompatibilityStatus, note: cell(row, "note") });
    } else throw new Error(`Unsupported CSV record type: ${type}`);
  }
  const configuration: SourcesUsesConfiguration = {
    schemaVersion: SOURCES_USES_SCHEMA_VERSION,
    id: meta?.[1] || newId("cfg"),
    name: meta?.[2] || "Imported configuration",
    description: meta?.[3] || "",
    updatedAt: meta?.[5] || new Date().toISOString(),
    sources, uses, compatibility,
  };
  const issues = validateConfiguration(configuration);
  if (issues.length) throw new Error(issues.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
  return configuration;
}

function checkIdentity(value: Record<string, unknown>, path: string, seen: Set<string>, issues: ConfigurationIssue[]) {
  if (typeof value.id !== "string" || !value.id.trim()) { issues.push({ path: `${path}.id`, message: "ID is required." }); return; }
  if (seen.has(value.id)) issues.push({ path: `${path}.id`, message: "IDs must be unique within their record type." });
  seen.add(value.id);
}
function checkRequiredText(value: Record<string, unknown>, key: string, path: string, issues: ConfigurationIssue[]) {
  if (typeof value[key] !== "string" || !(value[key] as string).trim()) issues.push({ path: `${path}.${key}`, message: "This field is required." });
}
function checkNumber(value: Record<string, unknown>, key: string, path: string, issues: ConfigurationIssue[], bounds: { min?: number; max?: number }) {
  const n = value[key];
  if (typeof n !== "number" || !Number.isFinite(n) || (bounds.min !== undefined && n < bounds.min) || (bounds.max !== undefined && n > bounds.max)) {
    issues.push({ path: `${path}.${key}`, message: `Enter a finite number${bounds.min !== undefined ? ` ≥ ${bounds.min}` : ""}${bounds.max !== undefined ? ` and ≤ ${bounds.max}` : ""}.` });
  }
}
function checkOptionalNumber(value: Record<string, unknown>, key: string, path: string, issues: ConfigurationIssue[], bounds: { min?: number }) {
  const n = value[key];
  if (n !== null && n !== undefined && (typeof n !== "number" || !Number.isFinite(n) || (bounds.min !== undefined && n < bounds.min))) {
    issues.push({ path: `${path}.${key}`, message: "Enter a valid non-negative number or leave blank." });
  }
}
function checkStringArray(value: Record<string, unknown>, key: string, path: string, issues: ConfigurationIssue[]) {
  if (!Array.isArray(value[key]) || !(value[key] as unknown[]).every((item) => typeof item === "string")) issues.push({ path: `${path}.${key}`, message: "Tags must be a list of text values." });
}
function checkBounds(value: Record<string, unknown>, path: string, issues: ConfigurationIssue[]) {
  if (typeof value.minimum === "number" && typeof value.maximum === "number" && value.minimum > value.maximum) {
    issues.push({ path, message: "Minimum amount cannot exceed maximum amount." });
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows;
}
function numericCell(value: string, fallback = 0): number {
  if (!value.trim()) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid number: ${value}`);
  return n;
}
function optionalNumericCell(value: string): number | null {
  return value.trim() ? numericCell(value) : null;
}
function parseTags(value: string): string[] {
  if (!value.trim()) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((tag) => typeof tag === "string")) throw new Error("Tags must be a JSON array of strings.");
  return parsed;
}
