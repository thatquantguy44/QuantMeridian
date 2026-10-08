import { createHash, timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

export type GateResult =
  | { open: true }
  | { open: false; status: 503; code: "AGENT_DISABLED" | "AGENT_PRODUCTION_DISABLED" | "AGENT_TRUSTED_BOUNDARY_MISSING"; message: string };

const truthy = (value: string | undefined) => ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());

export function isProductionRuntime(env: Env = process.env): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

/** Deploy-level kill switch and production gate; the run-time pause lives in `agent_control`. */
export function checkGate(env: Env = process.env): GateResult {
  if (truthy(env.AGENT_WORKFLOWS_DISABLED)) return { open: false, status: 503, code: "AGENT_DISABLED", message: "Agent workflows are disabled for this deployment." };
  if (!isProductionRuntime(env)) return { open: true };
  if ((env.AGENT_WORKFLOWS_PRODUCTION_ENABLED ?? "").trim() !== "true") return { open: false, status: 503, code: "AGENT_PRODUCTION_DISABLED", message: "Agent workflows are disabled in production." };
  if (!env.AGENT_WORKFLOWS_TRUSTED_ACCESS_BOUNDARY?.trim() || !env.AGENT_TRUSTED_IDENTITY_HEADER?.trim() || !env.AGENT_SESSION_SECRET?.trim()) {
    return { open: false, status: 503, code: "AGENT_TRUSTED_BOUNDARY_MISSING", message: "Agent workflows require a trusted access boundary, identity header, and session secret in production." };
  }
  return { open: true };
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time check of `Authorization: Bearer $AGENT_WORKER_TOKEN`. False when no token is configured. */
export function verifyWorkerToken(request: Request, env: Env = process.env): boolean {
  const expected = env.AGENT_WORKER_TOKEN?.trim();
  if (!expected) return false;
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return timingSafeEqual(digest(match[1].trim()), digest(expected));
}
