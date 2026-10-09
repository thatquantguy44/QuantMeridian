import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LlmProfilesConfig } from "@/lib/agent/contracts/llm-profiles.generated";
import { validateProfilesConfig } from "./profileConfig";
import { resolveProfile, type ResolvedCall } from "./profiles";

// Shared with the worker (agent_worker/llm/profiles.py, T-014): each file holds a profile registry, an
// environment, and the expected resolved call or error code. {xN} expands to N 'x' characters.
const dir = path.resolve(__dirname, "../../../../contracts/agent/fixtures/llm-profiles");
const expand = (value: string) => value.replace(/\{x(\d+)\}/g, (_, n) => "x".repeat(Number(n)));
const fixtures = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));

describe("llm profile conformance fixtures (AC-020, AC-021)", () => {
  it("has fixtures", () => expect(fixtures.length).toBeGreaterThanOrEqual(20));

  it.each(fixtures.map((f) => [f.name, f] as const))("%s", (_name, fx) => {
    const env = Object.fromEntries(Object.entries(fx.env as Record<string, string>).map(([k, v]) => [k, expand(v)]));
    const result = resolveProfile({ use: fx.input.use, dataClasses: fx.input.data_classes, requested: fx.input.requested, optional: fx.input.optional }, { env, config: fx.registry as LlmProfilesConfig });
    const want = fx.expected;
    if (!want.ok) {
      expect(result).toMatchObject({ ok: false, code: want.code });
      return;
    }
    expect(result.ok).toBe(true);
    const call = result as ResolvedCall;
    expect({ endpoint_url: call.endpoint_url, auth_header: call.auth_header, extra_header_names: call.extra_header_names, model: call.model }).toEqual({ endpoint_url: want.endpoint_url, auth_header: want.auth_header, extra_header_names: want.extra_header_names, model: want.model });
    if (want.profile_id) expect(call.profile_id).toBe(want.profile_id);
    if (want.max_retries !== undefined) expect(call.limits.max_retries).toBe(want.max_retries);
    if (want.timeout_ms !== undefined) expect(call.limits.timeout_ms).toBe(want.timeout_ms);
    if (want.degraded_from) expect(call.degraded_from).toEqual(want.degraded_from);
    else expect(call.degraded_from).toBeUndefined();
  });

  it("keeps every fixture's registry free of literal secrets and URLs", () => {
    for (const fx of fixtures) {
      // Only the registry is validated: fixtures that exercise failure paths may break cross-field rules on purpose.
      const result = validateProfilesConfig(fx.registry);
      const secrets = result.ok ? [] : result.problems.filter((p) => p.code === "SECRET_SHAPED_VALUE");
      expect(secrets, fx.name).toEqual([]);
    }
  });
});
