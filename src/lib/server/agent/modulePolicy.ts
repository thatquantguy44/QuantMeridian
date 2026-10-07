/**
 * Reviewed module policy for agent workflows (spec009 REQ-005, REQ-029).
 *
 * Loaded from contracts/agent/module-policy.json, which the worker's validator reads too, so the
 * two runtimes cannot disagree. Widening eligibility needs a spec change; the audit this was
 * checked against is docs/gold-db/MODULE_DATA_AUDIT.md.
 */
import policy from "../../../../contracts/agent/module-policy.json";

export const ELIGIBLE_GOLD_MODULES: readonly string[] = policy.eligible_modules.gold;
export const ELIGIBLE_DESK_MODULES: readonly string[] = policy.eligible_modules.desk;
export const ELIGIBLE_AGENT_MODULES: ReadonlySet<string> = new Set([
  ...ELIGIBLE_GOLD_MODULES,
  ...ELIGIBLE_DESK_MODULES,
]);
export const NEVER_ELIGIBLE_AGENT_MODULES: ReadonlySet<string> = new Set(policy.never_eligible);
export const KNOWN_DOMAINS: ReadonlySet<string> = new Set(policy.known_domains);
export const FORBIDDEN_HEADER_ENVS: ReadonlySet<string> = new Set(policy.forbidden_header_envs);

/** Context fields a module may snapshot; a module missing here may send none. */
export const CONTEXT_FIELD_ALLOWLIST: Readonly<Record<string, readonly string[]>> = policy.context_field_allowlist;
