import { json } from "@/lib/server/http";
import { goldEnabled, goldStore, goldTable, goldParam } from "@/lib/server/goldStore";
import { fitVar1, simulate, applyFomcAnchor, type NsFactorRow } from "@/lib/server/mcsEngine";
import { buildFomcFromGold } from "@/lib/server/goldFomc";
import { getMacroInputs } from "@/data/macroInputs";

export const runtime = "nodejs";

const DEFAULT_FIT_YEARS = 10;
const DEFAULT_NUM_PATHS = 2000;
const CHECKPOINTS = [21, 63, 126, 252]; // ~1m, 3m, 6m, 12m trading days
const TENORS = [0.25, 2, 5, 10, 30]; // years — 3M added as the FOMC anchor tenor

/**
 * GET /api/simulations/mcs
 *
 * Monte Carlo forward curve simulation: fits a VAR(1) on Gold's
 * yield_curve_ns_factors history, simulates forward paths by residual
 * bootstrap, and returns percentile bands per tenor per horizon.
 *
 * Query params:
 *   fitYears   — trailing years of factor history to fit on (default 10)
 *   paths      — number of Monte Carlo paths (default 2000, max 10000)
 *   regime     — restrict the shock bootstrap to a named macro_regime_daily
 *                regime (e.g. "Growth-Scare"), "current" for whatever regime
 *                the most recent day is in, or omitted for unconditional
 *                (all regimes pooled — the default).
 *   fomcAnchor — "0" to disable re-centering the front end on the
 *                market-implied Fed path (gold.fomc_meeting_path). On by
 *                default; silently skipped (not an error) if Gold has no
 *                FOMC data or no live SOFR/EFFR spot to anchor "now."
 *
 * No fallback: Gold DB only. Returns an explicit error when unavailable.
 */
export async function GET(req: Request) {
  if (!goldEnabled()) {
    return json({ source: "DB", ok: false, error: "MACRO_DB_URL not configured", result: null });
  }

  const url = new URL(req.url);
  const fitYears = Math.max(3, Math.min(30, Number(url.searchParams.get("fitYears")) || DEFAULT_FIT_YEARS));
  const numPaths = Math.max(200, Math.min(10000, Number(url.searchParams.get("paths")) || DEFAULT_NUM_PATHS));
  const regimeParam = url.searchParams.get("regime");
  const wantFomcAnchor = url.searchParams.get("fomcAnchor") !== "0";

  try {
    const store = goldStore();
    const cutoff = new Date();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - fitYears);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const rows = await store.raw<NsFactorRow>(
      `SELECT f.observation_date, f.beta0, f.beta1, f.beta2, f.lambda, f.fit_valid, r.regime_name
       FROM ${goldTable("yield_curve_ns_factors")} f
       LEFT JOIN ${goldTable("macro_regime_daily")} r ON f.observation_date = r.observation_date
       WHERE f.observation_date >= ${goldParam(1)}
       ORDER BY f.observation_date ASC`,
      [cutoffDate]
    );

    if (rows.length < 30) {
      return json({
        source: "DB",
        ok: false,
        error: `insufficient NS factor history in the fit window (${rows.length} rows since ${cutoffDate})`,
        result: null,
      });
    }

    const fit = fitVar1(rows);
    const regimeFilter =
      regimeParam && regimeParam.toLowerCase() === "current" ? fit.currentRegime ?? undefined
      : regimeParam || undefined;

    let result = simulate(fit, {
      numPaths,
      horizonDays: Math.max(...CHECKPOINTS),
      checkpoints: CHECKPOINTS,
      tenors: TENORS,
      regimeFilter,
    });

    let fomcAnchorApplied = false;
    let fomcAnchorSkippedReason: string | null = null;

    if (wantFomcAnchor) {
      const macroInputs = await getMacroInputs();
      const spotEffectiveRate =
        macroInputs.source === "DB" ? macroInputs.benchmarks["SOFR"] ?? macroInputs.benchmarks["EFFR"] ?? undefined : undefined;

      if (spotEffectiveRate == null) {
        fomcAnchorSkippedReason = "no live SOFR/EFFR spot rate from Gold DB";
      } else {
        const goldFomc = await buildFomcFromGold(store, spotEffectiveRate);
        if (!goldFomc || !goldFomc.meetings.length) {
          fomcAnchorSkippedReason = "no FOMC meeting-path data in Gold DB";
        } else {
          result = applyFomcAnchor(result, {
            spotEffectiveRate,
            meetings: goldFomc.meetings.map((m) => ({ date: m.date, impliedRate: m.impliedRate })),
          });
          fomcAnchorApplied = true;
        }
      }
    }

    return json({
      source: "DB",
      ok: true,
      asOf: fit.fitEndDate,
      regimeFilter: regimeFilter ?? null,
      currentRegime: fit.currentRegime,
      regimeCounts: fit.regimeCounts,
      fomcAnchorApplied,
      fomcAnchorSkippedReason,
      result,
    });
  } catch (err) {
    return json({ source: "DB", ok: false, error: (err as Error).message, result: null });
  }
}
