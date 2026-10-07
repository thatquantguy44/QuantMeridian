/**
 * Validation of settings/llm_profiles.json (spec009 REQ-019, NFR-005, AC-019).
 *
 * Pure: takes a parsed document, returns every problem found. Structure comes from the JSON
 * Schema (contracts/agent/llm-profiles.schema.json); this adds the cross-field rules a schema
 * cannot express and rejects anything that looks like a literal credential or URL.
 */
import type { ConfigProblem } from "@/lib/agent/configProblem";
import type { LlmProfilesConfig } from "@/lib/agent/contracts/llm-profiles.generated";
import { findSecretShapedValues } from "@/lib/agent/secretShape";
import { validateContract } from "@/lib/agent/validate";
import { FORBIDDEN_HEADER_ENVS } from "../agent/modulePolicy";

export type ProfileProblemCode =
  | "SCHEMA"
  | "SECRET_SHAPED_VALUE"
  | "DEFAULT_PROFILE_UNKNOWN"
  | "DEFAULT_PROFILE_DISABLED"
  | "FALLBACK_UNKNOWN"
  | "FALLBACK_CYCLE"
  | "USES_NOT_SUPPORTED"
  | "FORBIDDEN_HEADER";

export type ProfilesValidation =
  | { ok: true; config: LlmProfilesConfig; problems: [] }
  | { ok: false; problems: ConfigProblem<ProfileProblemCode>[] };

/** Uses a profile without a model cannot serve. */
const MODEL_FREE_USES = new Set(["interpreter", "narrator"]);

export function validateProfilesConfig(doc: unknown): ProfilesValidation {
  const problems: ConfigProblem<ProfileProblemCode>[] = [];

  for (const hit of findSecretShapedValues(doc)) {
    problems.push({
      code: "SECRET_SHAPED_VALUE",
      path: hit.path,
      message: `looks like a ${hit.kind.replace(/_/g, " ")}; reference secrets and endpoints through *_env fields only`,
    });
  }

  const schema = validateContract("profiles", doc);
  if (!schema.ok) {
    for (const issue of schema.issues) problems.push({ code: "SCHEMA", path: issue.path, message: issue.message });
    return { ok: false, problems };
  }

  const config = doc as LlmProfilesConfig;
  const profiles = config.profiles;

  const fallback = profiles[config.default_profile];
  if (!fallback) {
    problems.push({ code: "DEFAULT_PROFILE_UNKNOWN", path: "/default_profile", message: `no profile named "${config.default_profile}"` });
  } else if (!fallback.enabled) {
    problems.push({ code: "DEFAULT_PROFILE_DISABLED", path: "/default_profile", message: `default profile "${config.default_profile}" is disabled` });
  }

  for (const [id, profile] of Object.entries(profiles)) {
    const at = `/profiles/${id}`;

    if (profile.api_style === "none") {
      const bad = profile.uses.filter((u) => !MODEL_FREE_USES.has(u));
      if (bad.length) {
        problems.push({ code: "USES_NOT_SUPPORTED", path: `${at}/uses`, message: `a profile with no LLM cannot serve: ${bad.join(", ")}` });
      }
    }

    for (const header of Object.keys(profile.header_envs ?? {})) {
      if (FORBIDDEN_HEADER_ENVS.has(header.toLowerCase())) {
        problems.push({ code: "FORBIDDEN_HEADER", path: `${at}/header_envs/${header}`, message: "credentials and framing headers are set through auth, not header_envs" });
      }
    }

    // Follow the fallback chain; it must end and every link must exist.
    const seen = new Set<string>([id]);
    let next = profile.fallback_profile ?? null;
    while (next) {
      if (!profiles[next]) {
        problems.push({ code: "FALLBACK_UNKNOWN", path: `${at}/fallback_profile`, message: `no profile named "${next}"` });
        break;
      }
      if (seen.has(next)) {
        problems.push({ code: "FALLBACK_CYCLE", path: `${at}/fallback_profile`, message: `fallback chain loops through "${next}"` });
        break;
      }
      seen.add(next);
      next = profiles[next].fallback_profile ?? null;
    }
  }

  return problems.length ? { ok: false, problems } : { ok: true, config, problems: [] };
}

