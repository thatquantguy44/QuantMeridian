import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET } from "./route";

const KEYS = [
  "MACRO_DB_URL",
  "MACRO_DB_BACKEND",
  "FRED_API_KEY",
  "MARKET_DB_URL",
  "MARKET_DATA_DIR",
  "MARKET_PIPELINE_URL",
  "ALPHAVANTAGE_API_KEY",
  "MARKETAUX_API_KEY",
  "FINNHUB_API_KEY",
  "NEWSAPI_API_KEY",
  "NEWS_NLP_URL",
  "REDDIT_USER_AGENT",
  "STOCKTWITS_ACCESS_TOKEN",
  "STOCKTWITS_ENABLED",
  "INVENTORY_OPTIMIZER_API_URL",
  "INVENTORY_OPTIMIZER_API_TOKEN",
  "IBAL_API_URL",
  "IBAL_API_TOKEN",
  "IBAL_PRODUCTION_ENABLED",
  "IBAL_TRUSTED_ACCESS_BOUNDARY",
] as const;

function clearKeys() {
  for (const key of KEYS) delete process.env[key];
}

/**
 * A real loopback server standing in for the IBAL service. The proxy talks through node:http (not
 * global fetch), so stubbing fetch would never be seen; this exercises the actual transport.
 */
const servers: http.Server[] = [];
async function fakeIbal(status: number, payload: unknown): Promise<{ url: string; requests: string[] }> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

async function callHealth() {
  const res = await GET(new Request("http://localhost/api/dataops/health"));
  return res.json();
}

describe("/api/dataops/health intelligence feeds", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearKeys();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    clearKeys();
    await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
  });

  test("reports an umbrella intelligence row plus separate news, social, and NLP rows", async () => {
    const body = await callHealth();

    expect(body.providers.INTELLIGENCE_FEEDS).toMatchObject({
      status: "ERROR",
      live: false,
      configured: false,
      explicitStatus: "No real intelligence feeds available",
    });
    expect(body.providers.NEWS).toMatchObject({ status: "ERROR", live: false });
    expect(body.providers.SOCIAL).toMatchObject({ status: "ERROR", live: false });
    expect(body.providers.NEWS_NLP).toMatchObject({ status: "SIM", live: false });
    expect(body.providers.IBAL).toMatchObject({
      status: "ERROR",
      live: false,
      configured: false,
      explicitStatus: "IBAL_TOKEN_MISSING",
    });
  });

  test("surfaces structured NEWS_NLP health when the service is configured", async () => {
    process.env.NEWS_NLP_URL = "http://nlp.local";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "http://nlp.local/health") {
        return new Response(JSON.stringify({
          status: "ok",
          model: "FinBERT-test",
          sentiment: { ok: true, model: "FinBERT-test", backend: "transformers" },
          clustering: { ok: true, model: "all-MiniLM-test", backend: "sentence-transformers" },
          ner: { ok: true, model: "en_core_web_sm", backend: "spacy" },
          lexiconFallback: { enabled: false, model: "finance-lexicon", version: "1" },
          device: "cpu",
          runtime: "python 3.12.0",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected URL ${url}`);
    }));

    const body = await callHealth();

    expect(body.providers.NEWS_NLP.status).toBe("LIVE");
    expect(body.providers.NEWS_NLP.detail).toContain("sentiment=FinBERT-test");
    expect(body.providers.NEWS_NLP.detail).toContain("cluster=all-MiniLM-test");
    expect(body.providers.NEWS_NLP.detail).toContain("NER=en_core_web_sm");
    expect(body.providers.NEWS_NLP.diagnostics).toMatchObject({
      configured: true,
      ok: true,
      sentiment: { model: "FinBERT-test" },
      clustering: { model: "all-MiniLM-test" },
      ner: { model: "en_core_web_sm" },
      device: "cpu",
    });
  });

  test("surfaces IBAL optimizer readiness without exposing secrets", async () => {
    const ibal = await fakeIbal(200, {
      status: "ready",
      ready: true,
      api_schema_version: "1.0.0",
      engine_package_version: "0.1.0",
      backend: { name: "highs", version: "1.15.1", ready: true },
      error_category: null,
    });
    process.env.INVENTORY_OPTIMIZER_API_URL = ibal.url;
    process.env.INVENTORY_OPTIMIZER_API_TOKEN = "secret-token";

    const body = await callHealth();

    expect(body.providers.IBAL).toMatchObject({
      status: "LIVE",
      live: true,
      configured: true,
      readSuccessfully: true,
      explicitStatus: "IBAL service reachable and engine ready",
    });
    expect(body.providers.IBAL.detail).toContain("engine=0.1.0");
    expect(body.providers.IBAL.detail).toContain("backend=highs 1.15.1");
    expect(JSON.stringify(body.providers.IBAL)).not.toContain("secret-token");
    expect(JSON.stringify(body.providers.IBAL)).not.toContain(ibal.url);
    expect(JSON.stringify(body.providers.IBAL)).not.toContain(new URL(ibal.url).host);
    expect(ibal.requests).toEqual(["GET /health"]);
  });

  test("reports an unreachable IBAL service as an error, not as stale", async () => {
    const ibal = await fakeIbal(200, {});
    const { port } = new URL(ibal.url);
    await new Promise((resolve) => servers.pop()!.close(resolve)); // nothing listens on this port now
    process.env.INVENTORY_OPTIMIZER_API_URL = `http://127.0.0.1:${port}`;
    process.env.INVENTORY_OPTIMIZER_API_TOKEN = "secret-token";

    const body = await callHealth();

    expect(body.providers.IBAL).toMatchObject({
      status: "ERROR",
      live: false,
      configured: true,
      explicitStatus: "IBAL_HEALTH_UNREACHABLE",
    });
    expect(body.providers.IBAL.diagnostics).toMatchObject({ reachable: false, ready: false });
  });

  test("reports reachable but unready IBAL service as stale", async () => {
    const ibal = await fakeIbal(503, {
      status: "unavailable",
      ready: false,
      api_schema_version: "1.0.0",
      engine_package_version: null,
      backend: { name: "highs", version: null, ready: false },
      error_category: "ENGINE_IMPORT_FAILED",
    });
    process.env.INVENTORY_OPTIMIZER_API_URL = ibal.url;
    process.env.INVENTORY_OPTIMIZER_API_TOKEN = "secret-token";

    const body = await callHealth();

    expect(body.providers.IBAL).toMatchObject({
      status: "STALE",
      live: false,
      configured: true,
      readSuccessfully: false,
      explicitStatus: "IBAL_ENGINE_NOT_READY",
    });
    expect(body.providers.IBAL.diagnostics).toMatchObject({
      reachable: true,
      ready: false,
      health: { error_category: "ENGINE_IMPORT_FAILED" },
    });
  });
});
