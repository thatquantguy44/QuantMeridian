import { json } from "@/lib/server/http";
import { resolveChartSeries } from "@/lib/server/chartSeries";

/**
 * GET /api/chart/series?source=econ&id=DGS10
 * GET /api/chart/series?source=market&id=SPY
 *
 * Unified series resolver for the charting studios; the logic lives in
 * src/lib/server/chartSeries.ts so the agent verifier resolves series the same way.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const source = sp.get("source") ?? "econ";
  const id = sp.get("id") ?? "";
  const reqUnits = sp.get("units") ?? undefined;
  if (!id) return json({ error: "id required" }, { status: 400 });
  return json(await resolveChartSeries(source, id, reqUnits));
}
