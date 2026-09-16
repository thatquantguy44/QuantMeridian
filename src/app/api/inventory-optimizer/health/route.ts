import { json } from "@/lib/server/http";
import { inventoryOptimizerStatus, proxyInventoryOptimizer } from "@/lib/server/inventoryOptimizerProxy";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const response = await proxyInventoryOptimizer(request, "/health");
  if (response.ok) return response;
  const body = await response.json().catch(() => ({}));
  return json({ ...body, config: inventoryOptimizerStatus() }, { status: response.status });
}
