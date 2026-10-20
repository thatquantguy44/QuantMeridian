import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import type { IndemnificationResult, RunResponse } from "./indemnificationApi";
import { FAILURE_TEXT, loadBook, loadHealth, runAnalysis } from "./indemnificationClient";

const RESULT: IndemnificationResult = JSON.parse(readFileSync(new URL("../../contracts/indemnification/fixtures/result.example.json", import.meta.url), "utf-8"));
const RESPONSE: RunResponse = {
  api_schema_version: "1.0", correlation_id: "6f0d3a52-8d0b-4a7e-9d5e-7b1d6a7c1e00",
  run: { run_id: RESULT.run_id, received_at: "2026-10-20T12:00:00Z", snapshot_hash: RESULT.snapshot_hash, request_hash: "a".repeat(64), status: "complete", model_version: "indem-0.1.0", duration_ms: 5 },
  result: RESULT,
};
const reply = (body: unknown, status = 200) => vi.fn().mockResolvedValue(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

describe("runAnalysis", () => {
  test("posts the choices and returns the validated response", async () => {
    const fetcher = reply(RESPONSE);
    const outcome = await runAnalysis({ run: { seed: 4 } }, { idempotencyKey: "k", fetcher });
    expect(outcome.ok && outcome.data.run.run_id).toBe(RESULT.run_id);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/indemnification/runs");
    expect(init.method).toBe("POST");
    expect(init.headers["idempotency-key"]).toBe("k");
    expect(JSON.parse(init.body)).toEqual({ run: { seed: 4 } });
  });

  const failing = (name: string, fetcher: ReturnType<typeof vi.fn>, kind: string, status?: number) =>
    test(`maps ${name} to ${kind}`, async () => {
      const outcome = await runAnalysis({}, { fetcher });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.kind).toBe(kind);
        if (status !== undefined) expect(outcome.status).toBe(status);
        expect(outcome.message.length).toBeGreaterThan(0);
      }
    });
  failing("an unconfigured service", reply({ api_schema_version: "1.0", code: "BINDING_UNCONFIGURED", category: "transport", message: "missing" }, 503), "unconfigured", 503);
  failing("production being disabled", reply({ api_schema_version: "1.0", code: "PRODUCTION_DISABLED", category: "transport", message: "off" }, 403), "disabled", 403);
  failing("an unreachable service", reply({ api_schema_version: "1.0", code: "SERVICE_UNAVAILABLE", category: "transport", message: "down" }, 503), "unreachable");
  failing("a timeout", reply({ api_schema_version: "1.0", code: "SERVICE_TIMEOUT", category: "transport", message: "slow" }, 504), "timeout", 504);
  failing("a busy service", reply({ api_schema_version: "1.0", code: "SERVICE_BUSY", category: "capacity", message: "wait" }, 429), "busy", 429);
  failing("an oversized run", reply({ api_schema_version: "1.0", code: "RUN_TOO_LARGE", category: "capacity", message: "big" }, 422), "too_large");
  failing("an incompatible response from the proxy", reply({ api_schema_version: "1.0", code: "RESPONSE_INCOMPATIBLE", category: "transport", message: "bad" }, 502), "incompatible");
  failing("a 200 that is not a run response", reply({ hello: "world" }), "incompatible");
  failing("a body that is not JSON", reply("<html>oops</html>", 500), "incompatible");
  failing("a network failure", vi.fn().mockRejectedValue(new TypeError("fetch failed")), "unreachable");

  test("carries the validation issues the server found", async () => {
    const fetcher = reply({ api_schema_version: "1.0", code: "REQUEST_INVALID", category: "validation", message: "The request is not valid.", issues: ["rho_w^2 (0.81) must not exceed rho_d (0.25)", 7] }, 422);
    const outcome = await runAnalysis({ model: { rho_w: 0.9 } }, { fetcher });
    expect(outcome).toMatchObject({ ok: false, kind: "invalid", status: 422, issues: ["rho_w^2 (0.81) must not exceed rho_d (0.25)"] });
  });

  test("a cancelled request is reported as cancelled, not as an outage", async () => {
    const outcome = await runAnalysis({}, { fetcher: vi.fn().mockRejectedValue(new DOMException("x", "AbortError")) });
    expect(outcome).toMatchObject({ ok: false, message: "Cancelled." });
  });

  test("every failure kind has a sentence for the page", () => {
    for (const text of Object.values(FAILURE_TEXT)) expect(text.length).toBeGreaterThan(10);
  });
});

describe("book and health", () => {
  test("load the summary and the service status", async () => {
    const book = await loadBook(reply({ borrowers: [], defaults: {} }));
    expect(book.ok).toBe(true);
    const health = await loadHealth(reply({ status: "ready", ready: true, model_version: "indem-0.1.0", auth_configured: true }));
    expect(health.ok && health.data.ready).toBe(true);
    expect((await loadBook(reply({ nope: 1 }))).ok).toBe(false);
    const down = await loadHealth(reply({ api_schema_version: "1.0", code: "BINDING_UNCONFIGURED", category: "transport", message: "missing" }, 503));
    expect(down).toMatchObject({ ok: false, kind: "unconfigured" });
  });
});
