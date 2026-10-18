import { collateralProxy } from "@/lib/server/collateralOptimizerProxy";
export const runtime = "nodejs";
export function POST(request: Request) { return collateralProxy(request, "/v1/validate", "POST"); }
