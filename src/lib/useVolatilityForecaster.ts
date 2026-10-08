import { useCallback, useEffect, useState } from "react";
import { clearFetchCache, fetchJson, peekFresh } from "@/lib/fetchCache";
import type { VolatilityForecasterResponse } from "@/lib/volatilityForecaster";

const URL = "/api/ml-tools/volatility-forecaster";

export function useVolatilityForecaster() {
  const cached = peekFresh<VolatilityForecasterResponse>(URL);
  const [data, setData] = useState<VolatilityForecasterResponse | null>(cached ?? null);
  const [loading, setLoading] = useState(!cached);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchJson<VolatilityForecasterResponse>(URL));
    } catch {
      setData({
        ok: false,
        source: "ERR",
        code: "VOLF_REQUEST_FAILED",
        message: "Volatility Forecaster data could not be loaded.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!cached) void load();
  }, [cached, load]);

  const refresh = useCallback(() => {
    clearFetchCache(URL);
    void load();
  }, [load]);

  return { data, loading, refresh };
}
