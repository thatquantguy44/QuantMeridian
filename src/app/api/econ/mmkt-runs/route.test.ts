import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST } from "./route";
import { clearRunLog, listRuns } from "@/lib/server/runLog";

const candidate = (id: string, rate: string) => ({ candidate_id: id, rate_instrument_id: rate });

async function post(body: Record<string, unknown>): Promise<Response> {
  return (await POST(new Request("http://localhost/api/econ/mmkt-runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })))!;
}

describe("POST /api/econ/mmkt-runs (SIM path)", () => {
  let forwarded: { url: string; body: Record<string, unknown>; headers: Headers } | null;

  beforeEach(() => {
    forwarded = null;
    vi.stubEnv("MONEY_MARKET_API_TOKEN", "test-token");
    vi.stubEnv("MONEY_MARKET_API_URL", "http://127.0.0.1:8014");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      forwarded = { url, body: JSON.parse(String(init.body)), headers: new Headers(init.headers) };
      return new Response(JSON.stringify({ code: "SOLVE_COMPLETE" }), { status: 200, headers: { "content-type": "application/json" } });
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearRunLog();
  });

  test("records a forwarded run in the OPT session run log, but not one rejected before the service", async () => {
    await post({ rate_source: "sim", sim_set_id: "SIM-UNKNOWN", instrument_candidates: [candidate("A", "SOFR")] });
    expect(listRuns().entries).toHaveLength(0);
    const response = await post({ rate_source: "sim", sim_set_id: "SIM-MMKT-2026-10-BASE", instrument_candidates: [candidate("A", "SOFR")] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: "SOLVE_COMPLETE" });   // the body still reaches the client
    const [entry] = listRuns().entries;
    expect(entry).toMatchObject({ model: "MMKT", kind: "run", http_status: 200, status: "unknown", verified: null });
  });

  test("attaches the registered SIM snapshot and forwards to the service", async () => {
    const response = await post({ rate_source: "sim", sim_set_id: "SIM-MMKT-2026-10-BASE", instrument_candidates: [candidate("A", "SOFR")] });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-rate-source")).toBe("sim");
    expect(forwarded!.url).toBe("http://127.0.0.1:8014/v1/runs");
    expect(forwarded!.headers.get("authorization")).toBe("Bearer test-token");
    const snapshot = forwarded!.body.rate_snapshot as { source: string; sim_set_id: string; snapshot_hash: string };
    expect(snapshot.source).toBe("sim");
    expect(snapshot.sim_set_id).toBe("SIM-MMKT-2026-10-BASE");
    expect(response.headers.get("x-rate-snapshot-hash")).toBe(snapshot.snapshot_hash);
    expect(forwarded!.body).not.toHaveProperty("rate_source");
    expect(forwarded!.body).not.toHaveProperty("sim_set_id");
  });

  test("an unknown SIM set fails closed without calling the service", async () => {
    const response = await post({ rate_source: "sim", sim_set_id: "SIM-UNKNOWN", instrument_candidates: [candidate("A", "SOFR")] });
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("SIM_SET_UNAVAILABLE");
    expect(forwarded).toBeNull();
  });

  test("a candidate priced off a non-ok SIM row is rejected before the service", async () => {
    const response = await post({ rate_source: "sim", sim_set_id: "SIM-MMKT-2026-10-BASE", instrument_candidates: [candidate("A", "SOFR"), candidate("B", "DTB1YR")] });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("RATE_CANDIDATES_INELIGIBLE");
    expect(body.pricing_gate.issues).toEqual([{ instrument_id: "DTB1YR", code: "RATE_STATUS_NOT_OK", status: "stale" }]);
    expect(forwarded).toBeNull();
  });

  test("SIM requires a named set and clients cannot supply a snapshot", async () => {
    expect((await (await post({ rate_source: "sim", instrument_candidates: [candidate("A", "SOFR")] })).json()).code).toBe("SIM_SET_REQUIRED");
    expect((await (await post({ rate_source: "sim", sim_set_id: "SIM-MMKT-2026-10-BASE", rate_snapshot: {}, instrument_candidates: [] })).json()).code).toBe("CLIENT_RATE_SNAPSHOT_NOT_ALLOWED");
    expect((await (await post({ rate_source: "gold", sim_set_id: "SIM-MMKT-2026-10-BASE", instrument_candidates: [candidate("A", "SOFR")] })).json()).code).toBe("SIM_SET_NOT_ALLOWED");
  });
});
