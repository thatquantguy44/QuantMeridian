import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collateralProxy } from "./collateralOptimizerProxy";

const original = { ...process.env };
beforeEach(() => {
  process.env.COLLATERAL_OPTIMIZER_API_URL = "http://127.0.0.1:8017";
  process.env.COLLATERAL_OPTIMIZER_API_TOKEN = "secret";
  delete process.env.VERCEL_ENV;
  process.env.NODE_ENV = "test";
});
afterEach(() => {
  process.env = { ...original };
  vi.unstubAllGlobals();
});
const request = (body: unknown) => new Request("http://terminal/api/collateral-optimizer/runs",
  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("collateral same-origin proxy gates", () => {
  it("blocks production book before dispatch", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await collateralProxy(request({ source_mode: "PRODUCTION_BOOK" }), "/v1/runs", "POST");
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("PRODUCTION_BOOK_DISABLED");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("distinguishes unconfigured, unreachable, and mismatched artifacts", async () => {
    delete process.env.COLLATERAL_OPTIMIZER_API_TOKEN;
    const unconfigured = await collateralProxy(new Request("http://terminal/health"), "/health", "GET");
    expect((await unconfigured.json()).code).toBe("BINDING_UNCONFIGURED");
    process.env.COLLATERAL_OPTIMIZER_API_TOKEN = "secret";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Error("down")));
    const down = await collateralProxy(new Request("http://terminal/health"), "/health", "GET");
    expect((await down.json()).code).toBe("SERVICE_UNAVAILABLE");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ready: true, source_commit: "wrong", wheel_sha256: "wrong" }), { status: 200 })));
    const drift = await collateralProxy(new Request("http://terminal/health"), "/health", "GET");
    expect((await drift.json()).code).toBe("BINDING_INCOMPATIBLE");
  });
  it("rejects invalid service result JSON and any production terminal request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const malformed = await collateralProxy(request({ source_mode: "SIM", scenario_id: "baseline" }), "/v1/runs", "POST");
    expect((await malformed.json()).code).toBe("RESPONSE_INCOMPATIBLE");
    process.env.NODE_ENV = "production";
    const forbidden = await collateralProxy(request({ source_mode: "SIM", scenario_id: "baseline" }), "/v1/runs", "POST");
    expect((await forbidden.json()).code).toBe("PRODUCTION_DISABLED");
  });
});
