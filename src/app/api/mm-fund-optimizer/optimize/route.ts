import { json } from "@/lib/server/http";
import { optimizeFundAllocation, type PocOptimizerInput } from "@/lib/mmfo/pocModel";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let input: PocOptimizerInput;
  try {
    input = await request.json() as PocOptimizerInput;
  } catch {
    return json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  try {
    const result = optimizeFundAllocation(input);
    return json({ ok: true, result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Fund allocation could not be solved." },
      { status: 422, headers: { "cache-control": "no-store" } },
    );
  }
}
