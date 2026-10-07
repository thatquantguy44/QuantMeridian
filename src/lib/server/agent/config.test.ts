import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ELIGIBLE_AGENT_MODULES, validateWorkflowsConfig, type WorkflowConfigContext } from "./config";
import { DESK_DATASET_IDS } from "./deskDatasets";
import {
  CONTEXT_FIELD_ALLOWLIST,
  ELIGIBLE_DESK_MODULES,
  ELIGIBLE_GOLD_MODULES,
  KNOWN_DOMAINS,
  NEVER_ELIGIBLE_AGENT_MODULES,
} from "./modulePolicy";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const moduleCodes = new Set(Object.keys(read("settings/modules.config.json").modules));
const profileIds = new Set(Object.keys(read("settings/llm_profiles.json").profiles));
const ctx: WorkflowConfigContext = { moduleCodes, deskDatasets: DESK_DATASET_IDS, profileIds };

const shipped = () => read("settings/agent_workflows.json");
const codes = (doc: unknown, c: WorkflowConfigContext = ctx) => {
  const res = validateWorkflowsConfig(doc, c);
  return res.ok ? [] : res.problems.map((p) => p.code);
};

describe("shipped settings/agent_workflows.json", () => {
  it("validates", () => {
    const res = validateWorkflowsConfig(shipped(), ctx);
    expect(res.problems).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("enables MGC, FUND and SLAB; CURV and INFL stay off", () => {
    const { modules, workflows } = shipped();
    expect(Object.entries(modules).filter(([, m]) => (m as { enabled: boolean }).enabled).map(([c]) => c).sort()).toEqual(["FUND", "MGC", "SLAB"]);
    expect(modules.CURV.enabled).toBe(false);
    expect(modules.INFL.enabled).toBe(false);
    expect(Object.entries(workflows).filter(([, w]) => (w as { enabled: boolean }).enabled).map(([id]) => id).sort()).toEqual(["analysis.answer", "chart.build", "secfin.carry"]);
  });

  it("starts SLAB with no context fields", () => {
    expect(shipped().modules.SLAB.context_fields).toEqual([]);
  });
});

describe("module eligibility (AC-029)", () => {
  it.each(["IBAL", "OPT", "DESK", "TASSIST", "AI"])("rejects %s", (code) => {
    const doc = shipped();
    doc.modules[code] = { ...clone(doc.modules.MGC), enabled: true };
    expect(codes(doc)).toContain("MODULE_NOT_ELIGIBLE");
  });

  it("rejects an existing module outside the reviewed set, and an unknown module", () => {
    const outside = shipped();
    outside.modules.HOME = { ...clone(outside.modules.MGC), context_fields: [] };
    expect(codes(outside)).toContain("MODULE_NOT_ELIGIBLE");
    const unknown = shipped();
    unknown.modules.ZZZ = clone(unknown.modules.CURV);
    expect(codes(unknown)).toEqual(expect.arrayContaining(["MODULE_NOT_ELIGIBLE", "MODULE_UNKNOWN"]));
  });

  it("keeps the never-eligible modules out of the eligible set", () => {
    for (const code of NEVER_ELIGIBLE_AGENT_MODULES) expect(ELIGIBLE_AGENT_MODULES.has(code)).toBe(false);
  });

  it("only lists modules that exist and were audited (MODULE_DATA_AUDIT.md)", () => {
    const audit = fs.readFileSync(path.join(ROOT, "docs/gold-db/MODULE_DATA_AUDIT.md"), "utf8");
    for (const code of ELIGIBLE_AGENT_MODULES) {
      expect(moduleCodes.has(code), `${code} in modules.config.json`).toBe(true);
      expect(audit, `${code} audited`).toMatch(new RegExp(`^#### ${code} — `, "m"));
    }
    // IBAL postdates the audit; the never-eligible modules only need to be real modules.
    for (const code of NEVER_ELIGIBLE_AGENT_MODULES) expect(moduleCodes.has(code), `${code} in modules.config.json`).toBe(true);
  });

  it("splits the set into Gold-backed and desk modules without overlap", () => {
    expect(ELIGIBLE_GOLD_MODULES.filter((c) => ELIGIBLE_DESK_MODULES.includes(c))).toEqual([]);
    expect(ELIGIBLE_AGENT_MODULES.size).toBe(ELIGIBLE_GOLD_MODULES.length + ELIGIBLE_DESK_MODULES.length);
  });

  it("only allowlists context fields for eligible modules", () => {
    for (const code of Object.keys(CONTEXT_FIELD_ALLOWLIST)) expect(ELIGIBLE_AGENT_MODULES.has(code)).toBe(true);
  });

  it("uses only known domain packs in the shipped configuration", () => {
    for (const mod of Object.values(shipped().modules as Record<string, { domains: string[] }>)) {
      for (const d of mod.domains) expect(KNOWN_DOMAINS.has(d), d).toBe(true);
    }
  });
});

describe("context allowlist (REQ-005)", () => {
  it("rejects a field the module has not been reviewed for", () => {
    const doc = shipped();
    doc.modules.SLAB.context_fields = ["series"];
    expect(codes(doc)).toContain("CONTEXT_FIELD_NOT_ALLOWED");
    const fund = shipped();
    fund.modules.FUND.context_fields = ["series", "range", "transform"];
    expect(codes(fund)).toContain("CONTEXT_FIELD_NOT_ALLOWED");
  });

  it("rejects free-form context field names (schema)", () => {
    const doc = shipped();
    doc.modules.MGC.context_fields = ["series", "rows"];
    expect(codes(doc)).toContain("SCHEMA");
  });
});

describe("desk datasets and domains", () => {
  it("rejects an unregistered dataset", () => {
    const doc = shipped();
    doc.modules.SLAB.desk_datasets = ["sl_inventory", "pb_clients"];
    expect(codes(doc)).toContain("DESK_DATASET_UNKNOWN");
  });

  it("requires a workflow that allows desk_simulated when a module has desk datasets", () => {
    const doc = shipped();
    doc.modules.SLAB.workflows = ["chart.build"];
    expect(codes(doc)).toContain("DESK_DATA_CLASS_MISSING");
  });

  it("rejects an unknown domain pack", () => {
    const doc = shipped();
    doc.modules.MGC.domains = ["economics_macro", "made_up_pack"];
    expect(codes(doc)).toContain("DOMAIN_UNKNOWN");
  });

  it("rejects a module default profile that does not exist, only when profiles are supplied", () => {
    const doc = shipped();
    doc.modules.MGC.default_profile = "nope";
    expect(codes(doc)).toContain("PROFILE_UNKNOWN");
    expect(codes(doc, { moduleCodes, deskDatasets: DESK_DATASET_IDS })).toEqual([]);
    doc.modules.MGC.default_profile = "deterministic";
    expect(codes(doc)).toEqual([]);
  });
});

describe("workflow rules", () => {
  it("keeps llm and uses consistent, and copilot out of workflows", () => {
    const none = shipped();
    none.workflows["story.build"].uses = ["narrator"];
    expect(codes(none)).toContain("WORKFLOW_LLM_MISMATCH");
    const required = shipped();
    required.workflows["brief.draft"].uses = [];
    expect(codes(required)).toContain("WORKFLOW_LLM_MISMATCH");
    const copilot = shipped();
    copilot.workflows["chart.build"].uses = ["copilot"];
    expect(codes(copilot)).toContain("WORKFLOW_USES_INVALID");
  });

  it("requires the lease to outlast two heartbeats", () => {
    const doc = shipped();
    doc.limits.lease_seconds = 20;
    expect(codes(doc)).toContain("LEASE_TOO_SHORT");
  });

  it("refuses limits above the hard caps", () => {
    const doc = shipped();
    doc.limits.max_message_chars = 5000;
    expect(codes(doc)).toContain("SCHEMA");
  });
});

describe("secrets (AC-019)", () => {
  it("rejects a credential or URL anywhere in the document, even in unknown fields", () => {
    const doc = shipped();
    doc.workflows["chart.build"].note = `sk-${"x".repeat(32)}`;
    expect(codes(doc)).toEqual(expect.arrayContaining(["SECRET_SHAPED_VALUE", "SCHEMA"]));
    const url = shipped();
    url.modules.MGC.domains = ["https://example.com"];
    expect(codes(url)).toContain("SECRET_SHAPED_VALUE");
  });
});

describe("incompatible documents", () => {
  it("reports an unknown major as a schema problem, not a crash", () => {
    const doc = shipped();
    doc.schema_version = "agent-workflows/2";
    expect(codes(doc)).toEqual(["SCHEMA"]);
    expect(codes(null)).toEqual(["SCHEMA"]);
  });
});
