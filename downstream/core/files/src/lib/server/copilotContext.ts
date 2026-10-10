/**
 * Macro-data snapshot for the AI Copilot (QuantMeridian-Core).
 *
 * Replaces the upstream desk snapshot. Assembles a compact, factual JSON view of the latest
 * Treasury curve and macro indicator rows from the Gold macro database. This is the ground truth
 * handed to the model: it answers from these numbers rather than inventing them.
 */
import { goldEnabled, goldStore } from "@/lib/server/goldStore";

interface CurvePoint { as_of_date?: string; tenor?: string; tenor_label?: string; yield_pct?: number }
interface CurveMetric { as_of_date?: string; slope_10y2y?: number | null; curve_move?: string | null }
interface Indicator { series_id?: string; latest_value?: number; prior_value?: number | null; as_of_date?: string | null }

const round = (n: unknown, dp = 2) => (typeof n === "number" && Number.isFinite(n) ? Number(n.toFixed(dp)) : null);

export async function buildCopilotContext(): Promise<Record<string, unknown>> {
  if (!goldEnabled()) return { note: "The Gold macro database is not configured, so no macro data is available." };
  const store = goldStore();
  const [curve, metrics, indicators] = await Promise.all([
    store.latest<CurvePoint>("treasury_curve"),
    store.latest<CurveMetric>("treasury_curve_metrics"),
    store.latest<Indicator>("macro_indicator_dashboard"),
  ]);
  const metric = metrics[0];
  return {
    source: "macro_medallion (Gold)",
    treasury_curve: {
      as_of: curve[0]?.as_of_date ?? null,
      yields_pct: curve.map((p) => ({ tenor: p.tenor_label ?? p.tenor ?? "?", yield_pct: round(p.yield_pct, 3) })),
      slope_10y2y_pct: round(metric?.slope_10y2y, 3),
      curve_move: metric?.curve_move ?? null,
    },
    indicators: indicators.slice(0, 40).map((i) => ({
      series: i.series_id ?? "?",
      latest: round(i.latest_value, 3),
      prior: round(i.prior_value, 3),
      as_of: i.as_of_date ?? null,
    })),
  };
}
