import { json } from "@/lib/server/http";
import { optimizeFundAllocation, type PocOptimizerInput } from "@/lib/mmfo/pocModel";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: (PocOptimizerInput & { synthetic_mode?: boolean }) | null;
  try {
    body = await request.json() as PocOptimizerInput & { synthetic_mode?: boolean };
  } catch {
    return json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!body || body.synthetic_mode !== true) {
    return json({ ok: false, error: "Turn on Synthetic Demo mode to run the local POC." }, { status: 409, headers: { "cache-control": "no-store" } });
  }

  try {
    const result = optimizeFundAllocation(body);
    return json({ ok: true, result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Fund allocation could not be solved." },
      { status: 422, headers: { "cache-control": "no-store" } },
    );
  }
}
