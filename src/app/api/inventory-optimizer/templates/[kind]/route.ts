import { proxyInventoryOptimizer } from "@/lib/server/inventoryOptimizerProxy";

export const runtime = "nodejs";

const ALLOWED = new Set(["starter-xlsx", "advanced-xlsx", "request-json"]);

export async function GET(request: Request, { params }: { params: { kind: string } }) {
  if (!ALLOWED.has(params.kind)) {
    return new Response(JSON.stringify({ source: "ERR", ok: false, error: "Unknown IBAL template." }), {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  return proxyInventoryOptimizer(request, `/v1/templates/${params.kind}`);
}
