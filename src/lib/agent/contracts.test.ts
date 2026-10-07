import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkSchemaVersion, parseSchemaVersion, SCHEMA_VERSIONS, type ContractKind } from "./compat";
import { validateContract } from "./validate";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const SCHEMA_FILES: Record<ContractKind, string> = {
  workflows: "agent-workflows",
  profiles: "llm-profiles",
  job: "job",
  result: "result",
  verification: "verification",
  registry: "metric-registry",
  pin: "quantsmith-pin",
  vectors: "formula-vectors",
};

describe("schema files", () => {
  it.each(Object.entries(SCHEMA_FILES))("%s schema declares the version this build understands", (kind, file) => {
    const schema = read(`contracts/agent/${file}.schema.json`);
    const declared = schema.properties.schema_version.const;
    expect(declared).toBe(SCHEMA_VERSIONS[kind as ContractKind]);
    expect(schema.properties.schema_version.type).toBe("string");
    expect(schema.required).toContain("schema_version");
  });

  it("compile under strict Ajv (catches schema typos)", () => {
    // validateContract compiles lazily; an invalid schema throws here.
    for (const kind of Object.keys(SCHEMA_FILES) as ContractKind[]) {
      expect(() => validateContract(kind, { schema_version: SCHEMA_VERSIONS[kind] })).not.toThrow();
    }
  });
});

describe("compat", () => {
  it("parses name/major", () => {
    expect(parseSchemaVersion("agent-result/1")).toEqual({ name: "agent-result", major: 1 });
    expect(parseSchemaVersion("agent-result/1.2")).toBeNull();
    expect(parseSchemaVersion("agent-result")).toBeNull();
    expect(parseSchemaVersion(1)).toBeNull();
  });

  it("accepts its own major and refuses anything else", () => {
    expect(checkSchemaVersion({ schema_version: "agent-result/1" }, "result")).toEqual({ ok: true });
    expect(checkSchemaVersion({ schema_version: "agent-result/2" }, "result")).toMatchObject({ ok: false, reason: "unknown_major" });
    expect(checkSchemaVersion({ schema_version: "agent-job/1" }, "result")).toMatchObject({ ok: false, reason: "wrong_contract" });
    expect(checkSchemaVersion({ schema_version: "nonsense" }, "result")).toMatchObject({ ok: false, reason: "malformed" });
    expect(checkSchemaVersion({}, "result")).toMatchObject({ ok: false, reason: "missing" });
    expect(checkSchemaVersion(null, "result")).toMatchObject({ ok: false, reason: "missing" });
  });

  it("reports an unknown major as an incompatibility, not a structural error pile (AC-032)", () => {
    const res = validateContract("result", { schema_version: "agent-result/2", anything: true });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.compatibility).toMatchObject({ ok: false, reason: "unknown_major" });
      expect(res.issues).toHaveLength(1);
    }
  });
});

describe("pin", () => {
  it("the shipped pin validates", () => {
    expect(validateContract("pin", read("contracts/agent/quantsmith-pin.json"))).toEqual({ ok: true });
  });

  it("rejects a malformed digest and an absolute asset path", () => {
    const pin = read("contracts/agent/quantsmith-pin.json");
    const bad = clone(pin);
    bad.package.code_digest = "sha256:abc";
    expect(validateContract("pin", bad).ok).toBe(false);
    const abs = clone(pin);
    abs.assets.paths[0] = "/etc/passwd";
    expect(validateContract("pin", abs).ok).toBe(false);
  });
});

describe("job", () => {
  const base = {
    schema_version: "agent-job/1",
    module: "FUND",
    thread_id: "5d0c7a2e-1111-4222-8333-444455556666",
    workflow: "secfin.carry",
    kind: null,
    message: "",
    inputs: {
      side: "long", notional: 100000000, start: "2026-10-07", end: "2026-11-06", benchmark: "SOFR",
      spread_bps: 25, borrow_fee_bps: 0, rebate_bps: 0, margin_bps: 0, shocks_bps: [25],
    },
    context: { series: [{ source: "econ", id: "SOFR" }], range: "1Y" },
    profile: null,
    parent_job_id: null,
  };

  it("accepts the plan's create request", () => {
    expect(validateContract("job", base)).toEqual({ ok: true });
  });

  it("requires an end date or a tenor, not neither and not both", () => {
    const neither = clone(base);
    delete (neither.inputs as Record<string, unknown>).end;
    expect(validateContract("job", neither).ok).toBe(false);
    const tenor = clone(base);
    delete (tenor.inputs as Record<string, unknown>).end;
    (tenor.inputs as Record<string, unknown>).tenor = "1M";
    expect(validateContract("job", tenor)).toEqual({ ok: true });
    const both = clone(base);
    (both.inputs as Record<string, unknown>).tenor = "1M";
    expect(validateContract("job", both).ok).toBe(false);
  });

  it("bounds shocks, notional and message length", () => {
    const shock = clone(base);
    (shock.inputs as Record<string, unknown>).shocks_bps = [501];
    expect(validateContract("job", shock).ok).toBe(false);
    const notional = clone(base);
    (notional.inputs as Record<string, unknown>).notional = 0;
    expect(validateContract("job", notional).ok).toBe(false);
    const long = { ...clone(base), workflow: "chart.build", inputs: null, message: "x".repeat(2001) };
    expect(validateContract("job", long).ok).toBe(false);
  });

  it("rejects context fields outside the allowlist and values smuggled into series refs", () => {
    const extra = clone(base);
    (extra.context as Record<string, unknown>).values = [1, 2, 3];
    expect(validateContract("job", extra).ok).toBe(false);
    const badSource = clone(base);
    badSource.context.series = [{ source: "book", id: "X" }];
    expect(validateContract("job", badSource).ok).toBe(false);
  });

  it("requires inputs or a message for secfin.carry, and an explicit workflow", () => {
    const empty = { ...clone(base), inputs: null, message: "" };
    expect(validateContract("job", empty).ok).toBe(false);
    const described = { ...clone(base), inputs: null, message: "carry on 100m of GC for a month" };
    expect(validateContract("job", described)).toEqual({ ok: true });
    const noWorkflow = clone(base) as Record<string, unknown>;
    delete noWorkflow.workflow;
    expect(validateContract("job", noWorkflow).ok).toBe(false);
  });
});

describe("result", () => {
  const example = () => read("contracts/agent/fixtures/results/example-secfin-carry.json");

  it("accepts the plan's example payload", () => {
    expect(validateContract("result", example())).toEqual({ ok: true });
  });

  it("carries no verdict anywhere a worker could supply one", () => {
    const top = example();
    top.verdict = "VERIFIED";
    expect(validateContract("result", top).ok).toBe(false);
    const inClaim = example();
    inClaim.claims[2].verdict = "VERIFIED";
    expect(validateContract("result", inClaim).ok).toBe(false);
    const asStatus = example();
    asStatus.claims[2].status = "ok";
    expect(validateContract("result", asStatus).ok).toBe(false);
  });

  it("ignores unknown additive fields (readers tolerate minor additions)", () => {
    const doc = example();
    doc.future_field = { anything: 1 };
    doc.blocks[0].future_hint = "x";
    expect(validateContract("result", doc)).toEqual({ ok: true });
  });

  it("rejects an unknown claim kind, a Gold claim marked SIM, and an unknown block type", () => {
    const kind = example();
    kind.claims[2].kind = "guess";
    expect(validateContract("result", kind).ok).toBe(false);
    const prov = example();
    prov.claims[2].provenance = "SIM";
    expect(validateContract("result", prov).ok).toBe(false);
    const block = example();
    block.blocks[0] = { type: "script", code: "alert(1)" };
    expect(validateContract("result", block).ok).toBe(false);
  });

  it("requires the disclosure fields and well-formed digests", () => {
    const missing = example();
    delete missing.disclosure.registry_version;
    expect(validateContract("result", missing).ok).toBe(false);
    const digest = example();
    digest.disclosure.quantsmith.code_digest = "deadbeef";
    expect(validateContract("result", digest).ok).toBe(false);
  });
});

describe("verification", () => {
  const doc = () => ({
    schema_version: "agent-verification/1",
    job_id: "00000000-0000-4000-8000-000000000001",
    verified_at: "2026-10-07T12:00:00Z",
    registry_version: `sha256:${"0".repeat(64)}`,
    claims: [
      { id: "c1", verdict: "VERIFIED" },
      { id: "c3", verdict: "FLAGGED", reason: "revised_since_job", source_value: 4.32, source_as_of: "2026-10-05" },
      { id: "c9", verdict: "DROPPED", reason: "no_observation" },
    ],
    charts: [{ block_index: 0, verdict: "VERIFIED", series: [{ ref: { source: "econ", id: "SOFR" }, provenance: "DB", observations: 260 }] }],
    text: [{ block_index: 1, rule_passed: true, replaced_with_template: false }],
    summary: { verified: 1, flagged: 1, dropped: 1 },
  });

  it("accepts a complete verification", () => {
    expect(validateContract("verification", doc())).toEqual({ ok: true });
  });

  it("rejects unknown verdicts and stray fields", () => {
    const verdict = doc();
    verdict.claims[0].verdict = "MAYBE";
    expect(validateContract("verification", verdict).ok).toBe(false);
    const extra = { ...doc(), trusted: true };
    expect(validateContract("verification", extra).ok).toBe(false);
  });
});

describe("workflows and profiles", () => {
  it("rejects a profile with a literal credential or URL field", () => {
    const profiles = {
      schema_version: "llm-profiles/1",
      default_profile: "p",
      profiles: {
        p: {
          enabled: true, label: "P", api_style: "openai_chat_completions", model: "gpt-x",
          auth: { scheme: "bearer", credential_env: "KEY" },
          limits: { max_output_tokens: 1, timeout_ms: 1000, max_retries: 0, per_job_token_cap: 1, daily_token_budget: null },
          data_classes: ["public_market_data"], uses: ["interpreter"], api_key: "sk-live-abc", base_url: "https://x.example",
        },
      },
    };
    expect(validateContract("profiles", profiles).ok).toBe(false);
  });

  it("requires a model for an enabled API profile and forbids API fields on style none", () => {
    const limits = { max_output_tokens: 1, timeout_ms: 1000, max_retries: 0, per_job_token_cap: 1, daily_token_budget: null };
    const common = { label: "P", data_classes: ["public_market_data"], uses: ["interpreter"] };
    const api = (extra: object, enabled = true) => ({
      schema_version: "llm-profiles/1", default_profile: "p",
      profiles: { p: { ...common, enabled, api_style: "anthropic_messages", auth: { scheme: "provider_default", credential_env: "K" }, limits, ...extra } },
    });
    expect(validateContract("profiles", api({})).ok).toBe(false);
    expect(validateContract("profiles", api({ model: "m" }))).toEqual({ ok: true });
    expect(validateContract("profiles", api({}, false))).toEqual({ ok: true });
    const none = { schema_version: "llm-profiles/1", default_profile: "d", profiles: { d: { ...common, enabled: true, api_style: "none", model: "m" } } };
    expect(validateContract("profiles", none).ok).toBe(false);
  });

  it("requires an env var for bearer auth and a header name for header auth", () => {
    const limits = { max_output_tokens: 1, timeout_ms: 1000, max_retries: 0, per_job_token_cap: 1, daily_token_budget: null };
    const make = (auth: object) => ({
      schema_version: "llm-profiles/1", default_profile: "p",
      profiles: { p: { enabled: false, label: "P", api_style: "openai_chat_completions", auth, limits, data_classes: ["public_market_data"], uses: [] } },
    });
    expect(validateContract("profiles", make({ scheme: "bearer" })).ok).toBe(false);
    expect(validateContract("profiles", make({ scheme: "header", credential_env: "K" })).ok).toBe(false);
    expect(validateContract("profiles", make({ scheme: "header", credential_env: "K", header_name: "api-key" }))).toEqual({ ok: true });
    expect(validateContract("profiles", make({ scheme: "none" }))).toEqual({ ok: true });
  });
});
