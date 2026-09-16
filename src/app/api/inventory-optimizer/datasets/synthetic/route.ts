import { proxyInventoryOptimizer } from "@/lib/server/inventoryOptimizerProxy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return proxyInventoryOptimizer(request, "/v1/datasets/synthetic");
}
