import { ComposeError, composeRunRequest, type UiRunInput } from "@/lib/indemnificationCompose";
import { json } from "@/lib/server/http";
import { indemnificationProxy } from "@/lib/server/indemnificationProxy";
export const runtime = "nodejs";

const MAX_BYTES = 1024 * 1024;

function invalid(status: number, code: string, message: string, issues?: string[]) {
  return json({ api_schema_version: "1.0", code, category: "validation", message, ...(issues ? { issues } : {}) },
    { status, headers: { "cache-control": "no-store" } });
}

/** The page sends choices only; the server builds the snapshot from the simulated book and calls the service. */
export async function POST(request: Request) {
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BYTES) return invalid(413, "REQUEST_TOO_LARGE", "Maximum request size is 1 MiB.");
  let input: UiRunInput;
  try { input = JSON.parse(new TextDecoder().decode(raw)); }
  catch { return invalid(422, "REQUEST_INVALID", "Request must be JSON."); }
  let body;
  try { body = await composeRunRequest(input); }
  catch (error) {
    if (error instanceof ComposeError) return invalid(422, "REQUEST_INVALID", "The request is not valid.", error.issues);
    throw error;
  }
  return indemnificationProxy({ path: "/v1/runs", method: "POST", body, idempotencyKey: request.headers.get("idempotency-key") });
}
