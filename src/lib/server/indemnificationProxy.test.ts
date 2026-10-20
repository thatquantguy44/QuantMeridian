import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IndemnificationResult, RunResponse } from "@/lib/indemnificationApi";
import { MAX_REQUEST_BYTES, indemnificationProxy } from "./indemnificationProxy";

const RESULT: IndemnificationResult = JSON.parse(readFileSync(new URL("../../../contracts/indemnification/fixtures/result.example.json", import.meta.url), "utf-8"));
const RESPONSE: RunResponse = {
  api_schema_version: "1.0", correlation_id: "6f0d3a52-8d0b-4a7e-9d5e-7b1d6a7c1e00",
  run: { run_id: RESULT.run_id, received_at: "2026-10-20T12:00:00Z", snapshot_hash: RESULT.snapshot_hash, request_hash: "a".repeat(64), status: "complete", model_version: "indem-0.1.0", duration_ms: 5 },
  result: RESULT,
};
const RUN = { path: "/v1/runs", method: "POST" as const, body: { hello: "world" } };

const original = { ...process.env };
beforeEach(() => {
  process.env.INDEMNIFICATION_API_URL = "http://127.0.0.1:8018";
  process.env.INDEMNIFICATION_API_TOKEN = "super-secret-token";
  delete process.env.VERCEL_ENV;
  process.env.NODE_ENV = "test";
});
afterEach(() => { process.env = { ...original }; vi.unstubAllGlobals(); });
const answer = (body: unknown, status = 200) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe("INDEM same-origin proxy", () => {
  it("says so when the service URL or token is missing, without calling out", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    delete process.env.INDEMNIFICATION_API_TOKEN;
    expect((await (await indemnificationProxy(RUN)).json()).code).toBe("BINDING_UNCONFIGURED");
    process.env.INDEMNIFICATION_API_TOKEN = "x"; delete process.env.INDEMNIFICATION_API_URL;
    expect((await indemnificationProxy(RUN)).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("is local-only: production is refused before any call", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const env of [{ NODE_ENV: "production" }, { VERCEL_ENV: "production" }]) {
      Object.assign(process.env, env);
      const response = await indemnificationProxy(RUN);
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("PRODUCTION_DISABLED");
      process.env = { ...original, INDEMNIFICATION_API_URL: "http://127.0.0.1:8018", INDEMNIFICATION_API_TOKEN: "t", NODE_ENV: "test" };
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a service URL that is not http(s)", async () => {
    process.env.INDEMNIFICATION_API_URL = "file:///etc/passwd";
    expect((await (await indemnificationProxy(RUN)).json()).code).toBe("BINDING_INCOMPATIBLE");
  });

  it("refuses an oversized request before sending it", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const response = await indemnificationProxy({ ...RUN, body: { pad: "x".repeat(MAX_REQUEST_BYTES) } });
    expect(response.status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("forwards a run with the token, a correlation id and the idempotency key, and returns the validated response", async () => {
    const fetcher = answer(RESPONSE); vi.stubGlobal("fetch", fetcher);
    const response = await indemnificationProxy({ ...RUN, idempotencyKey: "key-1" });
    expect(response.status).toBe(200);
    expect((await response.json()).run.run_id).toBe(RESULT.run_id);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:8018/v1/runs");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer super-secret-token");
    expect(init.headers["idempotency-key"]).toBe("key-1");
    expect(init.headers["x-correlation-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(init.body)).toEqual({ hello: "world" });
  });

  it("passes a service-reported error through with its status", async () => {
    const error = { api_schema_version: "1.0", code: "SNAPSHOT_INVALID", category: "validation", message: "Snapshot is not consistent.", issues: ["rho_w^2 too big"] };
    vi.stubGlobal("fetch", answer(error, 422));
    const response = await indemnificationProxy(RUN);
    expect(response.status).toBe(422);
    expect((await response.json()).issues).toEqual(["rho_w^2 too big"]);
  });

  it("refuses a 200 that is not a complete run response, a 4xx that is not a service error, and bad JSON", async () => {
    const broken = JSON.parse(JSON.stringify(RESPONSE)); delete broken.result.program;
    vi.stubGlobal("fetch", answer(broken));
    expect((await (await indemnificationProxy(RUN)).json()).code).toBe("RESPONSE_INCOMPATIBLE");
    vi.stubGlobal("fetch", answer({ detail: "nope" }, 400));
    expect((await indemnificationProxy(RUN)).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })));
    expect((await (await indemnificationProxy(RUN)).json()).code).toBe("RESPONSE_INVALID");
  });

  it("distinguishes an unreachable service from a timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const down = await indemnificationProxy(RUN);
    expect([down.status, (await down.json()).code]).toEqual([503, "SERVICE_UNAVAILABLE"]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
    const slow = await indemnificationProxy(RUN);
    expect([slow.status, (await slow.json()).code]).toEqual([504, "SERVICE_TIMEOUT"]);
  });

  it("never puts the token in anything it returns", async () => {
    for (const fetcher of [answer(RESPONSE), vi.fn().mockRejectedValue(new Error("boom super-secret-token"))]) {
      vi.stubGlobal("fetch", fetcher);
      expect(await (await indemnificationProxy(RUN)).text()).not.toContain("super-secret-token");
    }
  });

  it("proxies health and capabilities as plain GETs", async () => {
    const fetcher = answer({ status: "ready", ready: true, model_version: "indem-0.1.0", auth_configured: true }); vi.stubGlobal("fetch", fetcher);
    const response = await indemnificationProxy({ path: "/health", method: "GET" });
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls[0][1].body).toBeUndefined();
  });
});
