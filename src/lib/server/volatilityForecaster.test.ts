import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readVolatilityForecaster } from "./volatilityForecaster";

const ORIGINAL_ENV = { ...process.env };

const health = {
  status: "ok",
  candidate_id: "hist_gradient_boosting_regression_w075",
  protocol: "volatility-continuous-ytd-v1",
  deployment_status: "shadow_only",
  research_status: "target_not_met",
  model_sha256: "model-hash",
};

const model = {
  candidate_id: "hist_gradient_boosting_regression_w075",
  feature_order: ["trailing_vol_5", "trailing_vol_20"],
  model_weight: 0.75,
  alert_threshold: 0.1979,
  training_rows: 3013,
  deployment_status: "shadow_only",
  model_sha256: "model-hash",
};

const status = {
  mode: "live",
  summary: {
    mode: "live",
    data_fresh: true,
    expected_latest_session: "2026-10-07",
    source_last_session: "2026-10-07",
    latest_run_state: "complete",
    failed_runs: 0,
    origins: 1,
    scored_origins: 0,
    pending_origins: 1,
    missing_origins: 0,
    latest_error: null,
  },
};

const csv = `ForecastKey,SampleId,DateKey,ModelKey,AsOfDate,HorizonEnd,Mode,OutcomeStatus,ModelHash,SourceHash,OutcomeSourceHash,CreatedAtUtc,ObservedAtUtc,AvailableAt,ForecastVolatility,AlertThreshold,PredictedHigh,ActualVolatility,ActualHigh,QLIKE,LogAbsoluteError,AbsoluteError,SquaredError,TruePositive,FalsePositive,FalseNegative,TrueNegative,AlertCost,Scored
volatility-shadow-v1/SPY/2026-10-07/candidate,volatility-shadow-v1/SPY/2026-10-07,20261007,candidate,2026-10-07,2026-10-14,live,pending,hash,source,,2026-10-07T23:44:29Z,2026-10-07T23:44:29Z,2026-10-07T20:00:00Z,0.08556,0.1979,0,,,,,,,,,,,,0
volatility-shadow-v1/SPY/2026-10-07/persistence,volatility-shadow-v1/SPY/2026-10-07,20261007,persistence,2026-10-07,2026-10-14,live,pending,hash,source,,2026-10-07T23:44:29Z,2026-10-07T23:44:29Z,2026-10-07T20:00:00Z,0.08354,0.1979,0,,,,,,,,,,,,0`;

function response(body: unknown, contentType = "application/json") {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200,
    headers: { "content-type": contentType },
  });
}

describe("QR Haven volatility forecaster adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "test", QR_HAVEN_VOLATILITY_API_URL: "http://qr-haven.internal:8000" };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  test("normalizes model, operations, and forecast data", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/health") return response(health);
      if (path === "/model") return response(model);
      if (path === "/status") return response(status);
      if (path === "/exports/FactForecast.csv") return response(csv, "text/csv");
      return new Response("not found", { status: 404 });
    });

    const result = await readVolatilityForecaster();

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    if (!result.body.ok) throw new Error("expected successful response");
    expect(result.body.service).toMatchObject({
      candidateId: "hist_gradient_boosting_regression_w075",
      deploymentStatus: "shadow_only",
      researchStatus: "target_not_met",
    });
    expect(result.body.model).toMatchObject({ modelWeight: 0.75, trainingRows: 3013 });
    expect(result.body.operations).toMatchObject({ dataFresh: true, pendingOrigins: 1 });
    expect(result.body.forecasts).toHaveLength(2);
    expect(result.body.forecasts[0]).toMatchObject({ modelKey: "candidate", forecastVolatility: 0.08556, scored: false });
  });

  test("keeps the service usable while optional reporting outputs are degraded", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/health") return response(health);
      if (path === "/model") return response(model);
      return new Response("unavailable", { status: 503 });
    });

    const result = await readVolatilityForecaster();

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    if (!result.body.ok) throw new Error("expected degraded success");
    expect(result.body.forecasts).toEqual([]);
    expect(result.body.warnings).toEqual([
      "Shadow operations report is unavailable.",
      "Forecast export is unavailable.",
    ]);
  });

  test("returns a stable error without leaking the configured URL", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connect ECONNREFUSED qr-haven.internal"));

    const result = await readVolatilityForecaster();

    expect(result).toEqual({
      status: 503,
      body: {
        ok: false,
        source: "ERR",
        code: "QR_HAVEN_UNAVAILABLE",
        message: "QR Haven volatility model service is unavailable.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("qr-haven.internal");
  });

  test("fails closed in production without both operator gates", async () => {
    process.env.NODE_ENV = "production";
    process.env.VOLF_PRODUCTION_ENABLED = "true";
    delete process.env.VOLF_TRUSTED_ACCESS_BOUNDARY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await readVolatilityForecaster();

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, code: "VOLF_TRUSTED_BOUNDARY_MISSING" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
