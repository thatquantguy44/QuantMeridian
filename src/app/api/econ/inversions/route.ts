import { json } from "@/lib/server/http";
import {
  computeInversionStats,
  monthlySpreadTimeline,
  recessionRangesFromUsrec,
  type Inversion,
} from "@/data/econCurve";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";

interface GoldEpisodeRow {
  spread_id: string;
  start_date: string;
  end_date: string | null;
  trough_bps: number | null;
  duration_days: number | null;
  recession_overlap: boolean | null;
  recession_lead_days: number | null;
}

interface GoldSpreadRow {
  spread_id: string;
  date: string;
  spread_bps: number;
  zscore: number | null;
  is_inverted: boolean | null;
  recession_flag: boolean | null;
}

/**
 * GET /api/econ/inversions?spread=10Y2Y
 *
 * Resolution order:
 *   1. Gold DB — gold.spread_inversion_episode + curve_spread_daily
 *   2. Explicit empty/error state
 */
export async function GET(req: Request) {
  const spreadId = new URL(req.url).searchParams.get("spread") ?? "10Y2Y";
  const unavailable = (note?: string) => ({
    source: "ERR" as const,
    spread: spreadId,
    inversions: [],
    stats: computeInversionStats([]),
    timeline: [],
    ...(note ? { note } : {}),
  });

  if (goldEnabled()) {
    try {
      const store = goldStore();
      const [episodeRows, spreadRows] = await Promise.all([
        store.latest<GoldEpisodeRow>("spread_inversion_episode", { spread_id: spreadId }),
        store.history<GoldSpreadRow>("curve_spread_daily", { spread_id: spreadId }),
      ]);

      if (spreadRows.length) {
        const series = spreadRows.map((r) => ({ date: r.date, bps: r.spread_bps }));
        // Reconstruct recession ranges from flagged dates
        const recessions = recessionRangesFromUsrec(
          spreadRows.map((r) => ({ date: r.date, value: r.recession_flag ? 1 : 0 }))
        );

        const inversions = episodeRows.map((ep) => ({
          start: ep.start_date,
          end: ep.end_date ?? "ongoing",
          trough_bps: ep.trough_bps ?? 0,
          duration_days: ep.duration_days ?? 0,
          recession_overlap: ep.recession_overlap ?? false,
          recession_lead_days: ep.recession_lead_days ?? null,
        }));
        // computeInversionStats reads the Inversion shape; convert days to months
        // the same way the series-based detector in econCurve.ts does.
        const stats = computeInversionStats(inversions.map((i): Inversion => ({
          id: i.start.slice(0, 7),
          invertedDate: i.start,
          unInvertedDate: i.end,
          durationMonths: Math.max(1, Math.round(i.duration_days / 30.44)),
          maxDepthBps: Math.round(i.trough_bps),
          recessionFollowed: i.recession_overlap,
          recessionStart: null,
          leadTimeMonths:
            i.recession_overlap && i.recession_lead_days != null ? Math.round(i.recession_lead_days / 30.44) : null,
          note: "",
        })));
        const timeline = monthlySpreadTimeline(series, recessions);

        return json({
          source: "DB",
          spread: spreadId,
          asOf: series[series.length - 1]?.date ?? null,
          inversions,
          stats,
          timeline,
        });
      }
    } catch (err) {
      console.warn("[inversions] Gold DB read failed:", (err as Error).message);
      return json(unavailable((err as Error).message));
    }
  }

  return json(unavailable(goldEnabled() ? "No Gold DB inversion rows found." : "MACRO_DB_URL not configured."));
}
