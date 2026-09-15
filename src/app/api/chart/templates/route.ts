import { json } from "@/lib/server/http";


/**
 * Optional DB-backed persistence for chart templates.
 *
 *   GET    /api/chart/templates?studio=MGC   → { source, templates }
 *   POST   /api/chart/templates  { template } → { ok, source }
 *   DELETE /api/chart/templates?id=...        → { ok, source }
 *
 * When MACRO_DB_URL points at a Postgres instance, templates are shared across
 * browsers/devices via a `chart_templates` table (auto-created). Without a DB
 * the route is a no-op (`source: "NONE"`) and the client falls back to
 * localStorage — the same render-local-then-upgrade pattern as the rest of the
 * terminal. Always 200 with a `source` field.
 */

function dbUrl(): string | undefined {
  const url = process.env.MACRO_DB_URL;
  return url && /^postgres(ql)?:\/\//.test(url) ? url : undefined;
}

/** Require pg at runtime without the bundler resolving it. */
function optionalRequire(name: string): any {
  try {
    // eslint-disable-next-line no-eval
    return (eval("require") as NodeRequire)(name);
  } catch {
    return null;
  }
}

async function withClient<T>(url: string, fn: (c: any) => Promise<T>): Promise<T | null> {
  const pg = optionalRequire("pg");
  if (!pg) return null;
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.query(
      `CREATE TABLE IF NOT EXISTS chart_templates (
         id TEXT PRIMARY KEY,
         studio TEXT NOT NULL,
         payload_json TEXT NOT NULL,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );
    return await fn(client);
  } catch {
    return null;
  } finally {
    await client.end().catch(() => {});
  }
}

export async function GET(req: Request) {
  const url = dbUrl();
  const studio = new URL(req.url).searchParams.get("studio") ?? "";
  if (!url) return json({ source: "NONE", templates: [] });

  const rows = await withClient(url, async (c) => {
    const r = studio
      ? await c.query("SELECT payload_json FROM chart_templates WHERE studio = $1 OR studio = 'both' ORDER BY updated_at DESC", [studio])
      : await c.query("SELECT payload_json FROM chart_templates ORDER BY updated_at DESC");
    return r.rows.map((row: any) => JSON.parse(row.payload_json));
  });

  if (rows == null) return json({ source: "NONE", templates: [] });
  return json({ source: "DB", templates: rows });
}

export async function POST(req: Request) {
  const url = dbUrl();
  let template: any;
  try {
    template = (await req.json())?.template;
  } catch {
    return json({ ok: false, error: "invalid body" }, { status: 400 });
  }
  if (!template?.id || !template?.studio) return json({ ok: false, error: "id and studio required" }, { status: 400 });
  if (!url) return json({ ok: false, source: "NONE" });

  const ok = await withClient(url, async (c) => {
    await c.query(
      `INSERT INTO chart_templates (id, studio, payload_json, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET studio = EXCLUDED.studio, payload_json = EXCLUDED.payload_json, updated_at = now()`,
      [template.id, template.studio, JSON.stringify(template)]
    );
    return true;
  });

  return json({ ok: ok === true, source: ok === true ? "DB" : "NONE" });
}

export async function DELETE(req: Request) {
  const url = dbUrl();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return json({ ok: false, error: "id required" }, { status: 400 });
  if (!url) return json({ ok: false, source: "NONE" });

  const ok = await withClient(url, async (c) => {
    await c.query("DELETE FROM chart_templates WHERE id = $1", [id]);
    return true;
  });

  return json({ ok: ok === true, source: ok === true ? "DB" : "NONE" });
}
