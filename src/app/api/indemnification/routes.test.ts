import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IndemnificationResult, RunResponse } from "@/lib/indemnificationApi";
import { GET as book } from "./book/route";
import { GET as health } from "./health/route";
import { POST as runs } from "./runs/route";
import { GET as runById } from "./runs/[run_id]/route";

const RESULT: IndemnificationResult = JSON.parse(readFileSync(new URL("../../../../contracts/indemnification/fixtures/result.example.json", import.meta.url), "utf-8"));
const RESPONSE: RunResponse = {
  api_schema_version: "1.0", correlation_id: "6f0d3a52-8d0b-4a7e-9d5e-7b1d6a7c1e00",
  run: { run_id: RESULT.run_id, received_at: "2026-10-20T12:00:00Z", snapshot_hash: RESULT.snapshot_hash, request_hash: "a".repeat(64), status: "complete", model_version: "indem-0.1.0", duration_ms: 5 },
  result: RESULT,
};
const original = { ...process.env };
beforeEach(() => {
  process.env.INDEMNIFICATION_API_URL = "http://127.0.0.1:8018";
  process.env.INDEMNIFICATION_API_TOKEN = "secret";
  delete process.env.VERCEL_ENV; process.env.NODE_ENV = "test";
});
afterEach(() => { process.env = { ...original }; vi.unstubAllGlobals(); });
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://terminal/api/indemnification/runs", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("/api/indemnification/book", () => {
  it("describes the simulated book and the defaults without needing the service", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const summary = await (await book()).json();
    expect(summary.source.label).toBe("SIM");
    expect(summary.borrowers).toHaveLength(16);
    expect(summary.owners.length).toBeGreaterThan(0);
    expect(summary.defaults.run).toMatchObject({ mode: "desk", paths: 50000, horizon_days: 21 });
    expect(summary.defaults.profile.name).toBe("default");
    expect(summary.defaults.options).toEqual({ sensitivity_paths: 5000, stresses: true, stress_profile_overrides: null });
    expect(summary.cash_collateral).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("/api/indemnification/runs", () => {
  it("builds the snapshot on the server and sends it to the service", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(RESPONSE), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const response = await runs(post({ run: { seed: 3, paths: 2000 }, options: { sensitivity_paths: null } }, { "idempotency-key": "k1" }));
    expect(response.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:8018/v1/runs");
    const sent = JSON.parse(init.body);
    expect(sent.snapshot.run).toMatchObject({ seed: 3, paths: 2000 });
    expect(sent.snapshot.loans.length).toBe(108);                         // the server supplied the book
    expect(sent.options.sensitivity_paths).toBeNull();
    expect(init.headers["idempotency-key"]).toBe("k1");
  });

  it("rejects bad choices with the reasons and never calls the service", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const bad = await runs(post({ model: { rho_w: 0.9 } }));
    expect(bad.status).toBe(422);
    const body = await bad.json();
    expect(body.code).toBe("REQUEST_INVALID");
    expect(body.issues.join(" ")).toContain("rho_w");
    expect((await runs(post("{not json"))).status).toBe(422);
    expect((await runs(post({ loans: [] }))).status).toBe(422);              // client-supplied book data is not accepted
    expect((await runs(post({ pad: "x".repeat(1024 * 1024) }))).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports an unconfigured service clearly", async () => {
    delete process.env.INDEMNIFICATION_API_TOKEN;
    const response = await runs(post({}));
    expect((await response.json()).code).toBe("BINDING_UNCONFIGURED");
  });
});

describe("/api/indemnification/runs/[run_id] and /health", () => {
  it("fetches a run by id and refuses a malformed id", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(RESPONSE), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    expect((await runById(new Request("http://t/x"), { params: { run_id: RESULT.run_id } })).status).toBe(200);
    expect(String(fetcher.mock.calls[0][0])).toBe(`http://127.0.0.1:8018/v1/runs/${RESULT.run_id}`);
    expect((await runById(new Request("http://t/x"), { params: { run_id: "../etc" } })).status).toBe(422);
  });

  it("proxies health", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "ready", ready: true }), { status: 200 })));
    expect((await (await health()).json()).ready).toBe(true);
  });
});
