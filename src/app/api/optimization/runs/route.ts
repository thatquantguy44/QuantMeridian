import { json } from "@/lib/server/http";
import { listRuns, RUN_LOG_CAPACITY } from "@/lib/server/runLog";

export const runtime = "nodejs";

/**
 * GET /api/optimization/runs
 *
 * The OPT session run log: model runs this terminal server forwarded since it started, newest
 * first. Metadata only, in memory, not persisted and not an audit record (Spec015 owns that).
 */
export function GET() {
  const { started_at, entries } = listRuns();
  return json(
    { scope: "terminal_server_memory", persisted: false, audit_record: false, capacity: RUN_LOG_CAPACITY, started_at, runs: entries },
    { headers: { "cache-control": "no-store" } },
  );
}
