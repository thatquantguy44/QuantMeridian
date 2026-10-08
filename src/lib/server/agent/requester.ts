import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";

export function requesterId(request: Request): { id: string; isNew: boolean } {
  const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)agent_sid=([^;]+)/)?.[1];
  if (cookie) return { id: cookie, isNew: false };
  const boundary = request.headers.get("x-agent-requester")?.trim();
  if (boundary) return { id: createHash("sha256").update(boundary).digest("hex").slice(0, 32), isNew: false };
  return { id: randomUUID(), isNew: true };
}

export function requesterHeaders(id: string, isNew: boolean): HeadersInit {
  return isNew ? { "set-cookie": `agent_sid=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000` } : {};
}
