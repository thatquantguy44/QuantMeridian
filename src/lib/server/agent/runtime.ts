/**
 * Shared helpers for the /api/agent routes (spec009 T-010): shipped configuration, correlation
 * IDs, error responses, and the workflow-offer rule (config ∩ live worker capabilities).
 */
import workflowsJson from "../../../../settings/agent_workflows.json";
import type { AgentWorkflowsConfig, Module, Workflow } from "@/lib/agent/contracts/agent-workflows.generated";
import { json } from "@/lib/server/http";
import { profileStates } from "@/lib/server/llm/profiles";

export const agentConfig = workflowsJson as unknown as AgentWorkflowsConfig;

export type ApiHeaders = Record<string, string>;

export function correlationId(request: Request): string {
  const supplied = request.headers.get("x-correlation-id")?.trim();
  return supplied && /^[A-Za-z0-9._:-]{1,64}$/.test(supplied) ? supplied : crypto.randomUUID();
}

export function apiJson(data: unknown, init: { status?: number; headers?: ApiHeaders; correlation: string }): Response {
  return json(data, { status: init.status ?? 200, headers: { "cache-control": "no-store", ...init.headers, "x-correlation-id": init.correlation } });
}

export function apiError(code: string, status: number, correlation: string, headers: ApiHeaders = {}, extra: Record<string, unknown> = {}): Response {
  return apiJson({ error_code: code, ...extra }, { status, headers, correlation });
}

/** Capabilities a workflow (and optional kind) needs from a worker before it is offered. */
export function requiredCapabilities(workflow: Workflow, kind?: string | null): string[] {
  const kindCaps = kind ? (workflow.kinds as Record<string, { requires_capabilities: string[] }> | undefined)?.[kind]?.requires_capabilities ?? [] : [];
  return [...new Set([...workflow.requires_capabilities, ...kindCaps])];
}

export function missingCapabilities(workflow: Workflow, live: Set<string>, kind?: string | null): string[] {
  return requiredCapabilities(workflow, kind).filter((name) => !live.has(name));
}

export function moduleConfig(code: string): Module | undefined {
  return agentConfig.modules[code as keyof typeof agentConfig.modules];
}

export function profileOptions(mod: Module, workflow?: Workflow) {
  const use = workflow?.uses[0] ?? "interpreter";
  const states = profileStates(use, workflow?.data_classes ?? ["public_market_data", "module_context"]);
  return states.map((s) => ({ id: s.id, label: s.label, available: s.state === "ready", reason: s.state === "ready" ? null : s.state, selectable: mod.profile_override }));
}
