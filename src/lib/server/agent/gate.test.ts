import { describe, expect, it } from "vitest";
import { checkGate, verifyWorkerToken } from "./gate";
import { resolveIdentity } from "./identity";
import { guardPanelRequest } from "./guard";

const prod = { NODE_ENV: "production", AGENT_WORKFLOWS_PRODUCTION_ENABLED: "true", AGENT_WORKFLOWS_TRUSTED_ACCESS_BOUNDARY: "ref", AGENT_TRUSTED_IDENTITY_HEADER: "x-user", AGENT_SESSION_SECRET: "s".repeat(32) };
const req = (headers: Record<string, string> = {}, url = "http://localhost/api/agent/jobs") => new Request(url, { headers });

describe("production gate (AC-025)", () => {
  it("is open outside production", () => expect(checkGate({}).open).toBe(true));
  it("is closed in production until enabled", () => {
    expect(checkGate({ NODE_ENV: "production" })).toMatchObject({ open: false, code: "AGENT_PRODUCTION_DISABLED" });
    expect(checkGate({ VERCEL_ENV: "production" })).toMatchObject({ open: false, code: "AGENT_PRODUCTION_DISABLED" });
  });
  it("needs the boundary, identity header, and session secret", () => {
    for (const drop of ["AGENT_WORKFLOWS_TRUSTED_ACCESS_BOUNDARY", "AGENT_TRUSTED_IDENTITY_HEADER", "AGENT_SESSION_SECRET"]) {
      expect(checkGate({ ...prod, [drop]: "" })).toMatchObject({ open: false, code: "AGENT_TRUSTED_BOUNDARY_MISSING" });
    }
    expect(checkGate(prod).open).toBe(true);
  });
  it("kill switch wins everywhere", () => {
    expect(checkGate({ AGENT_WORKFLOWS_DISABLED: "1" })).toMatchObject({ open: false, code: "AGENT_DISABLED" });
    expect(checkGate({ ...prod, AGENT_WORKFLOWS_DISABLED: "true" })).toMatchObject({ open: false, code: "AGENT_DISABLED" });
  });
});

describe("worker token", () => {
  const env = { AGENT_WORKER_TOKEN: "t".repeat(32) };
  it("accepts only the exact bearer token", () => {
    expect(verifyWorkerToken(req({ authorization: `Bearer ${"t".repeat(32)}` }), env)).toBe(true);
    expect(verifyWorkerToken(req({ authorization: `Bearer ${"t".repeat(31)}x` }), env)).toBe(false);
    expect(verifyWorkerToken(req({ authorization: "Basic abc" }), env)).toBe(false);
    expect(verifyWorkerToken(req(), env)).toBe(false);
  });
  it("is closed when no token is configured", () => expect(verifyWorkerToken(req({ authorization: "Bearer " }), {})).toBe(false));
});

describe("requester identity (AC-025 requester isolation)", () => {
  it("issues a 128-bit cookie and a stable HMAC requester id", () => {
    const first = resolveIdentity(req());
    expect(first.ok && first.setCookie).toMatch(/^agent_sid=[0-9a-f]{32}; .*HttpOnly.*SameSite=Lax/);
    const sid = (first.ok && first.setCookie!.match(/agent_sid=([0-9a-f]{32})/)![1])!;
    const again = resolveIdentity(req({ cookie: `agent_sid=${sid}` }));
    expect(again.ok && again.requesterId).toBe(first.ok && first.requesterId);
    expect(again.ok && again.setCookie).toBeNull();
    expect(first.ok && first.requesterId).not.toContain(sid);
  });
  it("gives different cookies different requester ids and rejects malformed cookies", () => {
    const a = resolveIdentity(req({ cookie: `agent_sid=${"a".repeat(32)}` }));
    const b = resolveIdentity(req({ cookie: `agent_sid=${"b".repeat(32)}` }));
    expect(a.ok && b.ok && a.requesterId !== b.requesterId).toBe(true);
    const forged = resolveIdentity(req({ cookie: "agent_sid=someone-elses-id" }));
    expect(forged.ok && forged.setCookie).toContain("agent_sid=");
  });
  it("derives ids from the secret, so a stored id cannot be replayed as a cookie", () => {
    const a = resolveIdentity(req({ cookie: `agent_sid=${"a".repeat(32)}` }), { AGENT_SESSION_SECRET: "one" });
    const b = resolveIdentity(req({ cookie: `agent_sid=${"a".repeat(32)}` }), { AGENT_SESSION_SECRET: "two" });
    expect(a.ok && b.ok && a.requesterId !== b.requesterId).toBe(true);
    const replay = resolveIdentity(req({ cookie: `agent_sid=${a.ok ? a.requesterId : ""}` }));
    expect(replay.ok && replay.requesterId).not.toBe(a.ok && a.requesterId);
  });
  it("sets Secure over https", () => {
    const r = resolveIdentity(req({}, "https://example.com/api/agent/jobs"));
    expect(r.ok && r.setCookie).toContain("; Secure");
  });
  it("in production uses only the boundary header and ignores cookies", () => {
    expect(resolveIdentity(req({ cookie: `agent_sid=${"a".repeat(32)}` }), prod)).toMatchObject({ ok: false, code: "AGENT_IDENTITY_MISSING" });
    const u1 = resolveIdentity(req({ "x-user": "alice" }), prod);
    const u2 = resolveIdentity(req({ "x-user": "bob" }), prod);
    expect(u1.ok && u2.ok && u1.requesterId !== u2.requesterId && u1.setCookie === null).toBe(true);
    expect(u1.ok && u1.requesterId).not.toContain("alice");
  });
  it("ignores the boundary header outside production", () => {
    const r = resolveIdentity(req({ "x-agent-requester": "alice", "x-user": "alice" }), { AGENT_TRUSTED_IDENTITY_HEADER: "x-user" });
    expect(r.ok && r.setCookie).toContain("agent_sid=");
  });
  it("refuses production without a secret", () => {
    expect(resolveIdentity(req({ "x-user": "a" }), { ...prod, AGENT_SESSION_SECRET: "" })).toMatchObject({ ok: false, code: "AGENT_TRUSTED_BOUNDARY_MISSING" });
  });
});

describe("guardPanelRequest", () => {
  it("returns a 503 with the gate code when closed", async () => {
    const g = guardPanelRequest(req(), { NODE_ENV: "production" });
    expect(g.ok).toBe(false);
    if (!g.ok) { expect(g.response.status).toBe(503); expect(await g.response.json()).toMatchObject({ error_code: "AGENT_PRODUCTION_DISABLED" }); }
  });
});
