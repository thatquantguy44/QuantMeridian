import { json } from "@/lib/server/http";
import { checkGate, verifyWorkerToken } from "./gate";
import { resolveIdentity } from "./identity";

export type Guarded = { ok: true; requesterId: string; headers: Record<string, string> } | { ok: false; response: Response };

/** Gate, then requester identity. Every panel route starts here. */
export function guardPanelRequest(request: Request, env: Record<string, string | undefined> = process.env): Guarded {
  const gate = checkGate(env);
  if (!gate.open) return { ok: false, response: json({ error_code: gate.code, message: gate.message }, { status: gate.status, headers: { "cache-control": "no-store" } }) };
  const identity = resolveIdentity(request, env);
  if (!identity.ok) return { ok: false, response: json({ error_code: identity.code, message: identity.message }, { status: identity.status, headers: { "cache-control": "no-store" } }) };
  return { ok: true, requesterId: identity.requesterId, headers: identity.setCookie ? { "set-cookie": identity.setCookie } : {} };
}

/** Worker-only routes: gate, then the bearer token. */
export function guardWorkerRequest(request: Request, env: Record<string, string | undefined> = process.env): { ok: true } | { ok: false; response: Response } {
  const gate = checkGate(env);
  if (!gate.open) return { ok: false, response: json({ error_code: gate.code, message: gate.message }, { status: gate.status }) };
  if (!verifyWorkerToken(request, env)) return { ok: false, response: json({ error_code: "AGENT_WORKER_UNAUTHORIZED" }, { status: 401 }) };
  return { ok: true };
}
