import { json } from "@/lib/server/http";
import { readVolatilityForecaster } from "@/lib/server/volatilityForecaster";

export const runtime = "nodejs";

export async function GET() {
  const result = await readVolatilityForecaster();
  return json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
