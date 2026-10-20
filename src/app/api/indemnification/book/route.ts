import { bookSummary } from "@/lib/indemnificationCompose";
import { json } from "@/lib/server/http";
export const runtime = "nodejs";
/** The simulated book and the documented defaults; needs no service. */
export async function GET() {
  return json(await bookSummary(), { headers: { "cache-control": "no-store" } });
}
