export interface VolatilityForecastRow {
  forecastKey: string;
  sampleId: string;
  asOfDate: string;
  horizonEnd: string;
  modelKey: string;
  mode: string;
  outcomeStatus: string;
  forecastVolatility: number;
  alertThreshold: number;
  predictedHigh: boolean;
  actualVolatility: number | null;
  scored: boolean;
  createdAtUtc: string | null;
}

export interface VolatilityForecasterSnapshot {
  ok: true;
  source: "QR_HAVEN";
  observedAt: string;
  warnings: string[];
  service: {
    candidateId: string;
    protocol: string;
    deploymentStatus: string;
    researchStatus: string;
    modelSha256: string;
  };
  model: {
    featureOrder: string[];
    modelWeight: number;
    alertThreshold: number;
    trainingRows: number;
  };
  operations: {
    mode: string;
    dataFresh: boolean | null;
    expectedLatestSession: string | null;
    sourceLastSession: string | null;
    latestRunState: string | null;
    failedRuns: number | null;
    origins: number | null;
    scoredOrigins: number | null;
    pendingOrigins: number | null;
    missingOrigins: number | null;
    latestError: string | null;
  };
  forecasts: VolatilityForecastRow[];
}

export interface VolatilityForecasterFailure {
  ok: false;
  source: "ERR";
  code: string;
  message: string;
}

export type VolatilityForecasterResponse = VolatilityForecasterSnapshot | VolatilityForecasterFailure;
