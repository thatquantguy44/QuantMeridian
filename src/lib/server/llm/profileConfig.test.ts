import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateProfilesConfig } from "./profileConfig";

const ROOT = path.resolve(__dirname, "../../../..");
const shipped = () => JSON.parse(fs.readFileSync(path.join(ROOT, "settings/llm_profiles.json"), "utf8"));
const codes = (doc: unknown) => {
  const res = validateProfilesConfig(doc);
  return res.ok ? [] : res.problems.map((p) => p.code);
};

describe("shipped settings/llm_profiles.json", () => {
  it("validates", () => {
    const res = validateProfilesConfig(shipped());
    expect(res.problems).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("enables only anthropic-direct and deterministic", () => {
    const profiles = shipped().profiles as Record<string, { enabled: boolean }>;
    expect(Object.entries(profiles).filter(([, p]) => p.enabled).map(([id]) => id).sort()).toEqual(["anthropic-direct", "deterministic"]);
    expect(Object.keys(profiles).sort()).toEqual(["anthropic-direct", "deterministic", "gateway-anthropic", "gateway-openai", "local-openai", "openai-direct"]);
  });

  it("seeds anthropic-direct with the Copilot's current model and token limit", () => {
    // The Copilot route reads these from the profile now; src/app/api/copilot/route.test.ts pins the request it sends.
    const profile = shipped().profiles["anthropic-direct"];
    expect(profile.model).toBe("claude-opus-4-8");
    expect(profile.limits.max_output_tokens).toBe(1500);
    expect(profile.auth.credential_env).toBe("ANTHROPIC_API_KEY");
  });

  it("lets every gateway or local endpoint come only from environment variable names", () => {
    for (const [id, p] of Object.entries(shipped().profiles as Record<string, Record<string, unknown>>)) {
      for (const key of ["base_url", "api_key", "token", "url", "endpoint"]) expect(p[key], `${id}.${key}`).toBeUndefined();
    }
  });
});

describe("rules", () => {
  it("rejects a default profile that is missing or disabled", () => {
    const missing = shipped();
    missing.default_profile = "nope";
    expect(codes(missing)).toContain("DEFAULT_PROFILE_UNKNOWN");
    const disabled = shipped();
    disabled.default_profile = "openai-direct";
    expect(codes(disabled)).toContain("DEFAULT_PROFILE_DISABLED");
  });

  it("rejects fallbacks that do not exist or loop", () => {
    const unknown = shipped();
    unknown.profiles["gateway-openai"].fallback_profile = "nope";
    expect(codes(unknown)).toContain("FALLBACK_UNKNOWN");
    const loop = shipped();
    loop.profiles["gateway-openai"].fallback_profile = "openai-direct";
    loop.profiles["openai-direct"].fallback_profile = "gateway-openai";
    expect(codes(loop)).toContain("FALLBACK_CYCLE");
    const self = shipped();
    self.profiles["gateway-openai"].fallback_profile = "gateway-openai";
    expect(codes(self)).toContain("FALLBACK_CYCLE");
    const ok = shipped();
    ok.profiles["gateway-openai"].fallback_profile = "deterministic";
    expect(codes(ok)).toEqual([]);
  });

  it("keeps copilot and drafter off a profile without a model", () => {
    const doc = shipped();
    doc.profiles.deterministic.uses = ["interpreter", "drafter"];
    expect(codes(doc)).toContain("USES_NOT_SUPPORTED");
  });

  it("refuses credentials in header_envs", () => {
    const doc = shipped();
    doc.profiles["gateway-openai"].header_envs = { Authorization: "MY_TOKEN_ENV" };
    expect(codes(doc)).toContain("FORBIDDEN_HEADER");
    doc.profiles["gateway-openai"].header_envs = { "X-Tenant": "GATEWAY_TENANT" };
    expect(codes(doc)).toEqual([]);
  });

  it("rejects literal secrets and URLs wherever they appear (AC-019)", () => {
    const urlModel = shipped();
    urlModel.profiles["gateway-openai"].model = "https://gateway.example/v1";
    expect(codes(urlModel)).toEqual(expect.arrayContaining(["SECRET_SHAPED_VALUE"]));
    const label = shipped();
    label.profiles["openai-direct"].label = `sk-${"x".repeat(32)}`;
    expect(codes(label)).toContain("SECRET_SHAPED_VALUE");
    const envField = shipped();
    envField.profiles["gateway-openai"].base_url_env = "https://gateway.example/v1";
    expect(codes(envField)).toContain("SECRET_SHAPED_VALUE");
  });

  it("rejects incompatible versions", () => {
    const doc = shipped();
    doc.schema_version = "llm-profiles/9";
    expect(codes(doc)).toEqual(["SCHEMA"]);
  });
});
