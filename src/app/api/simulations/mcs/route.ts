import { json } from "@/lib/server/http";
import { goldEnabled, goldStore, goldTable, goldParam } from "@/lib/server/goldStore";
import { fitVar1, simulate, type NsFactorRow } from "@/lib/server/mcsEngine";

export const runtime = "nodejs";

const DEFAULT_FIT_YEARS = 10;
const DEFAULT_NUM_PATHS = 2000;
const CHECKPOINTS = [21, 63, 126, 252]; // ~1m, 3m, 6m, 12m trading days
const TENORS = [2, 5, 10, 30]; // years

/**
 * GET /api/simulations/mcs
 *
 * Monte Carlo forward curve simulation: fits a VAR(1) on Gold's
 * yield_curve_ns_factors history, simulates forward paths by residual
 * bootstrap, and returns percentile bands per tenor per horizon.
 *
 * Query params:
 *   fitYears  — trailing years of factor history to fit on (default 10)
 *   paths     — number of Monte Carlo paths (default 2000, max 10000)
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

  try {
    const store = goldStore();
    const cutoff = new Date();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - fitYears);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const rows = await store.raw<NsFactorRow>(
      `SELECT observation_date, beta0, beta1, beta2, lambda, fit_valid
       FROM ${goldTable("yield_curve_ns_factors")}
       WHERE observation_date >= ${goldParam(1)}
       ORDER BY observation_date ASC`,
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
    const result = simulate(fit, {
      numPaths,
      horizonDays: Math.max(...CHECKPOINTS),
      checkpoints: CHECKPOINTS,
      tenors: TENORS,
    });

    return json({
      source: "DB",
      ok: true,
      asOf: fit.fitEndDate,
      result,
    });
  } catch (err) {
    return json({ source: "DB", ok: false, error: (err as Error).message, result: null });
  }
}
