import { json } from "@/lib/server/http";
import { indemnificationProxy } from "@/lib/server/indemnificationProxy";
export const runtime = "nodejs";

export function GET(_request: Request, { params }: { params: { run_id: string } }) {
  if (!/^[0-9a-f]{32}$/.test(params.run_id))
    return json({ api_schema_version: "1.0", code: "REQUEST_INVALID", category: "validation", message: "run_id must be 32 hex characters." }, { status: 422 });
  return indemnificationProxy({ path: `/v1/runs/${params.run_id}`, method: "GET" });
}
