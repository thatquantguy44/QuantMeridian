import { useEffect, useState } from "react";
import { fetchJson, peekFresh } from "@/lib/fetchCache";
import type { VixForwardResponse } from "@/app/api/market-volatility/vix-forward/route";
import type { VixForwardBasis } from "@/lib/vixImpliedForward";

export type VixForwardUiSource = "LOADING" | "DB" | "ERR";

/** Raw Gold VIX and S&P 500 history for the chosen basis; the page aligns and computes statistics itself. */
export function useVixForward(basis: VixForwardBasis): { data: VixForwardResponse | null; source: VixForwardUiSource; error: string | null } {
  const url = `/api/market-volatility/vix-forward?basis=${basis}`;
  const [data, setData] = useState<VixForwardResponse | null>(() => peekFresh<VixForwardResponse>(url) ?? null);
  const [source, setSource] = useState<VixForwardUiSource>("LOADING");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const apply = (body: VixForwardResponse) => {
      setData(body);
      setSource(body.source === "DB" ? "DB" : "ERR");
      setError(body.error ?? null);
    };
    const cached = peekFresh<VixForwardResponse>(url);
    if (cached) apply(cached);
    else { setData(null); setSource("LOADING"); setError(null); }
    fetchJson<VixForwardResponse>(url)
      .then((body) => { if (alive) apply(body); })
      .catch((err) => {
        if (!alive) return;
        setData(null);
        setSource("ERR");
        setError(err instanceof Error ? err.message : "VIX forward history unavailable.");
      });
    return () => { alive = false; };
  }, [url]);

  return { data, source, error };
}
