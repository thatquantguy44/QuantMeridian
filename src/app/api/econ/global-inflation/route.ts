import { json } from "@/lib/server/http";
import { goldParam, goldStore, goldTable } from "@/lib/server/goldStore";

export const runtime = "nodejs";

interface GoldInflationRow {
  country: string;
  iso3: string;
  region: string;
  series_id: string;
  observation_date: string;
  cpi_yoy_pct: number | null;
  change_pp: number | null;
  trend: string | null;
  streak: number | null;
  target_pct: number | null;
  vs_target_pp: number | null;
}

export async function GET(request: Request) {
  const store = goldStore();
  if (!store) {
    return json({ rows: [], source: "ERR" });
  }

  // store.latest() returns the whole fact table (no per-key filtering — see
  // GoldStore docstring); this table carries annual World Bank CPI back to
  // the 1990s for 38 countries. Select only the latest observation per iso3.
  const table = goldTable("global_inflation");
  const country = new URL(request.url).searchParams.get("country");
  if (country) {
    const history = await store.raw<GoldInflationRow>(
      `SELECT observation_date, cpi_yoy_pct FROM ${table} WHERE country = ${goldParam(1)} AND cpi_yoy_pct IS NOT NULL ORDER BY observation_date`,
      [country],
    );
    return json({ observations: history.map((r) => ({ date: r.observation_date, value: r.cpi_yoy_pct })), source: "DB" }, { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=600" } });
  }
  const rows = await store.raw<GoldInflationRow>(
    `SELECT * FROM (
       SELECT p.*, ROW_NUMBER() OVER (PARTITION BY iso3 ORDER BY observation_date DESC) AS rn
       FROM ${table} p
     ) latest
     WHERE rn = 1`
  );
  return json({
    rows: rows.map((r) => ({
      iso3: r.iso3,
      country: r.country,
      region: r.region,
      cpi_yoy_pct: r.cpi_yoy_pct,
      change_pp: r.change_pp,
      trend: r.trend,
      streak: r.streak,
      target_pct: r.target_pct,
      vs_target_pp: r.vs_target_pp,
      observation_date: r.observation_date,
    })),
    source: "DB",
  }, { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=600" } });
}
