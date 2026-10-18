import { collateralProxy } from "@/lib/server/collateralOptimizerProxy";
export const runtime = "nodejs";
export function GET(request: Request) { return collateralProxy(request, "/health", "GET"); }
