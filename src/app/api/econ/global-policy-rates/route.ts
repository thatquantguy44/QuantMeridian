import { json } from "@/lib/server/http";
import { goldParam, goldStore, goldTable } from "@/lib/server/goldStore";

export const runtime = "nodejs";

interface GoldPolicyRateRow {
  country: string;
  iso3: string;
  region: string;
  series_id: string;
  observation_date: string;
  policy_rate_pct: number | null;
  change_bps: number | null;
  last_move_bps: number | null;
  stance: string | null;
  real_rate_pct: number | null;
}

export async function GET(request: Request) {
  const store = goldStore();
  if (!store) {
    return json({ rows: [], source: "ERR" });
  }

  // store.latest() returns the whole fact table (no per-key filtering — see
  // GoldStore docstring), which for this table is 25+ years of monthly
  // history across 38 countries. Select only the latest observation per
  // iso3 so the page gets one current row per country, not an arbitrary
  // historical one.
  const table = goldTable("global_policy_rates");
  const params = new URL(request.url).searchParams;
  const country = params.get("country");
  if (country) {
    const history = await store.raw<GoldPolicyRateRow>(
      `SELECT observation_date, policy_rate_pct FROM ${table} WHERE country = ${goldParam(1)} AND policy_rate_pct IS NOT NULL ORDER BY observation_date`,
      [country],
    );
    return json({ observations: history.map((r) => ({ date: r.observation_date, value: r.policy_rate_pct })), source: "DB" }, { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=600" } });
  }
  const rows = await store.raw<GoldPolicyRateRow>(
    `SELECT * FROM (
       SELECT p.*, ROW_NUMBER() OVER (PARTITION BY iso3 ORDER BY observation_date DESC) AS rn
       FROM ${table} p
     ) latest
     WHERE rn = 1`
  );
  const meetings = await store.raw<{ release_date: string }>(
    `SELECT release_date FROM ${goldTable("release_calendar")} WHERE LOWER(release_name) LIKE '%fomc%' AND release_date >= CURRENT_DATE ORDER BY release_date ASC LIMIT 1`
  ).catch(() => []);
  const nextFomc = meetings[0]?.release_date ?? null;
  return json({
    rows: rows.map((r) => ({
      iso3: r.iso3,
      country: r.country,
      region: r.region,
      policy_rate_pct: r.policy_rate_pct,
      change_bps: r.change_bps,
      last_move_bps: r.last_move_bps,
      stance: r.stance,
      real_rate_pct: r.real_rate_pct,
      observation_date: r.observation_date,
      next_meeting_date: r.iso3 === "USA" ? nextFomc : null,
      meeting_source: r.iso3 === "USA" && nextFomc ? "GOLD_CALENDAR" : null,
    })),
    source: "DB",
  }, { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=600" } });
}
