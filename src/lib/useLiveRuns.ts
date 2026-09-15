
import { useEffect, useState } from "react";
import { fetchJson, peekFresh } from "@/lib/fetchCache";
import type { ProviderRun, SeriesRunResult, LineageRun } from "@/data/dataOps";

interface RunsResponse {
  live: boolean;
  runs: ProviderRun[];
  series: SeriesRunResult[];
  lineage: LineageRun[];
}

/**
 * DATAOPS runs/series/lineage from the terminal's NEWS/SOCIAL/NLP diagnostics.
 * Market pipeline manifest (MARKET_PIPELINE_URL) has been decommissioned.
 * Returns null until a live (non-empty) response arrives, so the page keeps
 * its fixture baseline and overlays real feed diagnostics when available.
 */
export function useLiveRuns(): RunsResponse | null {
  const url = "/api/dataops/runs";
  const cached = peekFresh<RunsResponse>(url);
  const [data, setData] = useState<RunsResponse | null>(cached?.live ? cached : null);

  useEffect(() => {
    let alive = true;
    fetchJson<RunsResponse>(url)
      .then((j) => {
        if (alive && j?.live && j.runs?.length) setData(j);
      })
      .catch(() => {
        /* keep fixtures */
      });
    return () => {
      alive = false;
    };
  }, []);

  return data;
}
