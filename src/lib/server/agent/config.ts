/**
 * Validation of settings/agent_workflows.json (spec009 REQ-001, REQ-005, REQ-029, AC-029).
 *
 * Pure: takes a parsed document, returns every problem found. Structure comes from the JSON
 * Schema; this adds module eligibility, per-module context allowlists, desk dataset and domain
 * checks, and secret-shaped value rejection. services/agent_worker/src/agent_worker/settings.py
 * mirrors these rules and runs the same fixtures.
 */
import type { ConfigProblem } from "@/lib/agent/configProblem";
import type { AgentWorkflowsConfig } from "@/lib/agent/contracts/agent-workflows.generated";
import { findSecretShapedValues } from "@/lib/agent/secretShape";
import { validateContract } from "@/lib/agent/validate";
import {
  CONTEXT_FIELD_ALLOWLIST,
  ELIGIBLE_AGENT_MODULES,
  KNOWN_DOMAINS,
  NEVER_ELIGIBLE_AGENT_MODULES,
} from "./modulePolicy";

export { ELIGIBLE_AGENT_MODULES } from "./modulePolicy";

export type WorkflowProblemCode =
  | "SCHEMA"
  | "SECRET_SHAPED_VALUE"
  | "MODULE_UNKNOWN"
  | "MODULE_NOT_ELIGIBLE"
  | "WORKFLOW_LLM_MISMATCH"
  | "WORKFLOW_USES_INVALID"
  | "LEASE_TOO_SHORT"
  | "DESK_DATASET_UNKNOWN"
  | "DESK_DATA_CLASS_MISSING"
  | "CONTEXT_FIELD_NOT_ALLOWED"
  | "DOMAIN_UNKNOWN"
  | "PROFILE_UNKNOWN"

export interface WorkflowConfigContext {
  /** Module codes that exist in the app (keys of settings/modules.config.json). */
  moduleCodes: ReadonlySet<string>;
  /** Registered desk dataset ids (the desk dataset registry). */
  deskDatasets: ReadonlySet<string>;
  /** Profile ids from llm_profiles.json; omit to skip the cross-file check. */
  profileIds?: ReadonlySet<string>;
}

export type WorkflowsValidation =
  | { ok: true; config: AgentWorkflowsConfig; problems: [] }
  | { ok: false; problems: ConfigProblem<WorkflowProblemCode>[] };

export function validateWorkflowsConfig(doc: unknown, ctx: WorkflowConfigContext): WorkflowsValidation {
  const problems: ConfigProblem<WorkflowProblemCode>[] = [];

  for (const hit of findSecretShapedValues(doc)) {
    problems.push({
      code: "SECRET_SHAPED_VALUE",
      path: hit.path,
      message: `looks like a ${hit.kind.replace(/_/g, " ")}; settings files hold no credentials or URLs`,
    });
  }

  const schema = validateContract("workflows", doc);
  if (!schema.ok) {
    for (const issue of schema.issues) problems.push({ code: "SCHEMA", path: issue.path, message: issue.message });
    return { ok: false, problems };
  }
  const config = doc as AgentWorkflowsConfig;

  if (config.limits.lease_seconds < config.limits.heartbeat_seconds * 2) {
    problems.push({ code: "LEASE_TOO_SHORT", path: "/limits/lease_seconds", message: "lease_seconds must be at least twice heartbeat_seconds" });
  }

  for (const [id, wf] of Object.entries(config.workflows)) {
    const at = `/workflows/${id}`;
    if (wf.uses.includes("copilot")) {
      problems.push({ code: "WORKFLOW_USES_INVALID", path: `${at}/uses`, message: "copilot is a profile use, not a workflow use" });
    }
    if (wf.llm === "none" && wf.uses.length > 0) {
      problems.push({ code: "WORKFLOW_LLM_MISMATCH", path: `${at}/uses`, message: 'llm "none" cannot list uses' });
    }
    if (wf.llm === "required" && wf.uses.length === 0) {
      problems.push({ code: "WORKFLOW_LLM_MISMATCH", path: `${at}/uses`, message: 'llm "required" needs at least one use' });
    }
  }

  for (const [code, mod] of Object.entries(config.modules)) {
    const at = `/modules/${code}`;

    if (NEVER_ELIGIBLE_AGENT_MODULES.has(code) || !ELIGIBLE_AGENT_MODULES.has(code)) {
      problems.push({
        code: "MODULE_NOT_ELIGIBLE",
        path: at,
        message: NEVER_ELIGIBLE_AGENT_MODULES.has(code)
          ? `${code} is never eligible for agent workflows`
          : `${code} is not in the reviewed eligible module set (contracts/agent/module-policy.json)`,
      });
    }
    if (!ctx.moduleCodes.has(code)) {
      problems.push({ code: "MODULE_UNKNOWN", path: at, message: `${code} is not a module in settings/modules.config.json` });
    }

    const allowed = new Set(CONTEXT_FIELD_ALLOWLIST[code] ?? []);
    for (const field of mod.context_fields) {
      if (!allowed.has(field)) {
        problems.push({ code: "CONTEXT_FIELD_NOT_ALLOWED", path: `${at}/context_fields`, message: `${code} may not snapshot "${field}" (add it to the reviewed per-module allowlist first)` });
      }
    }

    for (const domain of mod.domains) {
      if (!KNOWN_DOMAINS.has(domain)) {
        problems.push({ code: "DOMAIN_UNKNOWN", path: `${at}/domains`, message: `unknown domain pack "${domain}"` });
      }
    }

    const datasets = mod.desk_datasets ?? [];
    for (const ds of datasets) {
      if (!ctx.deskDatasets.has(ds)) {
        problems.push({ code: "DESK_DATASET_UNKNOWN", path: `${at}/desk_datasets`, message: `"${ds}" is not a registered desk dataset` });
      }
    }
    if (datasets.length > 0) {
      const canServeDesk = mod.workflows.some((w) => config.workflows[w]?.data_classes.includes("desk_simulated"));
      if (!canServeDesk) {
        problems.push({ code: "DESK_DATA_CLASS_MISSING", path: `${at}/workflows`, message: "a module with desk datasets needs a workflow that allows desk_simulated" });
      }
    }

    if (ctx.profileIds && mod.default_profile != null && !ctx.profileIds.has(mod.default_profile)) {
      problems.push({ code: "PROFILE_UNKNOWN", path: `${at}/default_profile`, message: `no profile named "${mod.default_profile}"` });
    }
  }

  return problems.length ? { ok: false, problems } : { ok: true, config, problems: [] };
}
