import type {
  VolatilityForecasterFailure,
  VolatilityForecasterResponse,
  VolatilityForecasterSnapshot,
  VolatilityForecastRow,
} from "@/lib/volatilityForecaster";

const DEFAULT_URL = "http://127.0.0.1:8000";
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_FORECAST_ROWS = 250;

interface QrHealth {
  status?: unknown;
  candidate_id?: unknown;
  protocol?: unknown;
  deployment_status?: unknown;
  research_status?: unknown;
  model_sha256?: unknown;
}

interface QrModel {
  candidate_id?: unknown;
  feature_order?: unknown;
  model_weight?: unknown;
  alert_threshold?: unknown;
  training_rows?: unknown;
  deployment_status?: unknown;
  model_sha256?: unknown;
}

interface QrStatus {
  mode?: unknown;
  created_at_utc?: unknown;
  summary?: Record<string, unknown>;
}

class UpstreamError extends Error {}

function failure(code: string, message: string): VolatilityForecasterFailure {
  return { ok: false, source: "ERR", code, message };
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function productionGate(): VolatilityForecasterFailure | null {
  if (!isProduction()) return null;
  if (process.env.VOLF_PRODUCTION_ENABLED !== "true") {
    return failure("VOLF_PRODUCTION_DISABLED", "Volatility Forecaster access is disabled in production.");
  }
  if (!process.env.VOLF_TRUSTED_ACCESS_BOUNDARY) {
    return failure("VOLF_TRUSTED_BOUNDARY_MISSING", "Volatility Forecaster requires a trusted production access boundary.");
  }
  return null;
}

function baseUrl(): URL | null {
  try {
    const url = new URL(process.env.QR_HAVEN_VOLATILITY_API_URL || DEFAULT_URL);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.pathname = url.pathname.replace(/\/$/, "");
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function endpoint(base: URL, path: string): URL {
  const url = new URL(base.toString());
  url.pathname = `${base.pathname}${path}`.replace(/\/+/g, "/");
  return url;
}

function headers(): HeadersInit {
  const token = process.env.QR_HAVEN_VOLATILITY_API_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function fetchText(base: URL, path: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint(base, path), {
      headers: headers(),
      signal: controller.signal,
    });
    if (!response.ok) throw new UpstreamError(`upstream status ${response.status}`);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_RESPONSE_BYTES) throw new UpstreamError("upstream response too large");
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new UpstreamError("upstream response too large");
    return text;
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError("upstream request failed");
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(base: URL, path: string): Promise<T> {
  const text = await fetchText(base, path);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UpstreamError("upstream returned invalid JSON");
  }
}

function text(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function boolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function parseCsv(input: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((values) => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""])));
}

function normalizeForecast(row: Record<string, string>): VolatilityForecastRow | null {
  const forecastVolatility = nullableNumber(row.ForecastVolatility);
  const alertThreshold = nullableNumber(row.AlertThreshold);
  if (!row.ForecastKey || forecastVolatility === null || alertThreshold === null) return null;
  return {
    forecastKey: row.ForecastKey,
    sampleId: row.SampleId || row.ForecastKey,
    asOfDate: row.AsOfDate || "",
    horizonEnd: row.HorizonEnd || "",
    modelKey: row.ModelKey || "unknown",
    mode: row.Mode || "unknown",
    outcomeStatus: row.OutcomeStatus || "unknown",
    forecastVolatility,
    alertThreshold,
    predictedHigh: boolean(row.PredictedHigh),
    actualVolatility: nullableNumber(row.ActualVolatility),
    scored: boolean(row.Scored),
    createdAtUtc: nullableText(row.CreatedAtUtc),
  };
}

function operations(status: QrStatus | null): VolatilityForecasterSnapshot["operations"] {
  const summary = status?.summary ?? {};
  return {
    mode: text(summary.mode ?? status?.mode, "unavailable"),
    dataFresh: typeof summary.data_fresh === "boolean" ? summary.data_fresh : null,
    expectedLatestSession: nullableText(summary.expected_latest_session),
    sourceLastSession: nullableText(summary.source_last_session),
    latestRunState: nullableText(summary.latest_run_state),
    failedRuns: nullableNumber(summary.failed_runs),
    origins: nullableNumber(summary.origins),
    scoredOrigins: nullableNumber(summary.scored_origins),
    pendingOrigins: nullableNumber(summary.pending_origins),
    missingOrigins: nullableNumber(summary.missing_origins),
    latestError: nullableText(summary.latest_error),
  };
}

export function volatilityForecasterStatus() {
  const gate = productionGate();
  return {
    configured: baseUrl() !== null,
    productionEnabled: !isProduction() || !gate,
    trustedBoundary: !isProduction() || Boolean(process.env.VOLF_TRUSTED_ACCESS_BOUNDARY),
  };
}

export async function readVolatilityForecaster(): Promise<{ body: VolatilityForecasterResponse; status: number }> {
  const gate = productionGate();
  if (gate) return { body: gate, status: 503 };
  const base = baseUrl();
  if (!base) {
    return { body: failure("QR_HAVEN_CONFIG_INVALID", "QR Haven Volatility API configuration is invalid."), status: 503 };
  }

  const [healthResult, modelResult, statusResult, forecastsResult] = await Promise.allSettled([
    fetchJson<QrHealth>(base, "/health"),
    fetchJson<QrModel>(base, "/model"),
    fetchJson<QrStatus>(base, "/status"),
    fetchText(base, "/exports/FactForecast.csv"),
  ]);

  if (healthResult.status === "rejected" || modelResult.status === "rejected") {
    return {
      body: failure("QR_HAVEN_UNAVAILABLE", "QR Haven volatility model service is unavailable."),
      status: 503,
    };
  }

  const health = healthResult.value;
  const model = modelResult.value;
  const warnings: string[] = [];
  const status = statusResult.status === "fulfilled" ? statusResult.value : null;
  if (!status) warnings.push("Shadow operations report is unavailable.");

  let forecasts: VolatilityForecastRow[] = [];
  if (forecastsResult.status === "fulfilled") {
    forecasts = parseCsv(forecastsResult.value)
      .map(normalizeForecast)
      .filter((row): row is VolatilityForecastRow => row !== null)
      .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate) || a.modelKey.localeCompare(b.modelKey))
      .slice(0, MAX_FORECAST_ROWS);
  } else {
    warnings.push("Forecast export is unavailable.");
  }

  const featureOrder = Array.isArray(model.feature_order)
    ? model.feature_order.filter((value): value is string => typeof value === "string")
    : [];
  const body: VolatilityForecasterSnapshot = {
    ok: true,
    source: "QR_HAVEN",
    observedAt: new Date().toISOString(),
    warnings,
    service: {
      candidateId: text(model.candidate_id ?? health.candidate_id),
      protocol: text(health.protocol),
      deploymentStatus: text(health.deployment_status ?? model.deployment_status),
      researchStatus: text(health.research_status),
      modelSha256: text(model.model_sha256 ?? health.model_sha256),
    },
    model: {
      featureOrder,
      modelWeight: number(model.model_weight),
      alertThreshold: number(model.alert_threshold),
      trainingRows: number(model.training_rows),
    },
    operations: operations(status),
    forecasts,
  };
  return { body, status: 200 };
}
