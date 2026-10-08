import { createHmac, randomBytes } from "node:crypto";
import { isProductionRuntime } from "./gate";

type Env = Record<string, string | undefined>;

// Used only outside production so local development works without configuration; the production
// gate requires a real AGENT_SESSION_SECRET.
const DEV_SECRET = "agent-dev-only-secret-not-for-production";
const SID = /^[0-9a-f]{32}$/;

export type Identity =
  | { ok: true; requesterId: string; setCookie: string | null }
  | { ok: false; status: 401 | 503; code: "AGENT_IDENTITY_MISSING" | "AGENT_TRUSTED_BOUNDARY_MISSING"; message: string };

const hmac = (secret: string, value: string) => createHmac("sha256", secret).update(value).digest("hex");

/**
 * Requester ID stored on jobs: HMAC-SHA256(AGENT_SESSION_SECRET, sid) from a signed-by-construction
 * session cookie locally, or from the boundary-supplied header in production. Raw cookie values and
 * header values are never stored.
 */
export function resolveIdentity(request: Request, env: Env = process.env): Identity {
  const production = isProductionRuntime(env);
  const secret = env.AGENT_SESSION_SECRET?.trim() || (production ? "" : DEV_SECRET);
  if (!secret) return { ok: false, status: 503, code: "AGENT_TRUSTED_BOUNDARY_MISSING", message: "AGENT_SESSION_SECRET is not configured." };
  if (production) {
    const header = env.AGENT_TRUSTED_IDENTITY_HEADER?.trim();
    const value = header ? request.headers.get(header)?.trim() : null;
    if (!value || value.length > 256) return { ok: false, status: 401, code: "AGENT_IDENTITY_MISSING", message: "The access boundary did not supply a requester identity." };
    return { ok: true, requesterId: hmac(secret, `boundary:${value}`), setCookie: null };
  }
  const existing = request.headers.get("cookie")?.match(/(?:^|;\s*)agent_sid=([^;]+)/)?.[1];
  const sid = existing && SID.test(existing) ? existing : randomBytes(16).toString("hex");
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return {
    ok: true,
    requesterId: hmac(secret, `sid:${sid}`),
    setCookie: sid === existing ? null : `agent_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
  };
}
