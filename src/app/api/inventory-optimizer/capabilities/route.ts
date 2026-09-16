import { proxyInventoryOptimizer } from "@/lib/server/inventoryOptimizerProxy";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return proxyInventoryOptimizer(request, "/v1/capabilities");
}
