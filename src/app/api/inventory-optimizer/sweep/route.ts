import { proxyInventoryOptimizer } from "@/lib/server/inventoryOptimizerProxy";

export const runtime = "nodejs";

// Engine spec0020 one-parameter sweep (at most 25 verified solves; the service caps at 305 s).
export async function POST(request: Request) {
  return proxyInventoryOptimizer(request, "/v1/sweep", { timeoutMs: 310_000 });
}
