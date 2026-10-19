import { proxyInventoryOptimizer } from "@/lib/server/inventoryOptimizerProxy";

export const runtime = "nodejs";

// Engine spec0020 elastic infeasibility explanation (up to three solves).
export async function POST(request: Request) {
  return proxyInventoryOptimizer(request, "/v1/explain", { timeoutMs: 200_000 });
}
