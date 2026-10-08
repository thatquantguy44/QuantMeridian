import {
  DQ_SEVERITIES,
  decodeWarehouseCursor,
  encodeWarehouseCursor,
  parseBoolean,
  parseBoundedText,
  parseEnum,
  parseLimit,
  WarehouseCursorError,
  warehouseAudit,
  warehouseCaughtError,
  warehouseRouteContext,
  warehouseSuccess,
} from "@/lib/server/warehouse";

function severityRank(severity: string | null): number {
  if (severity === "error") return 0;
  if (severity === "warning") return 1;
  return 2;
}

export async function GET(request: Request): Promise<Response> {
  const context = warehouseRouteContext();
  if (!context.ok) return context.response;

  try {
    const params = new URL(request.url).searchParams;
    const runId = parseBoundedText(params.get("runId"), "runId", { maxLength: 200 });
    const seriesId = parseBoundedText(params.get("seriesId"), "seriesId", { maxLength: 200 });
    const severity = parseEnum(params.get("severity"), "severity", DQ_SEVERITIES);
    const passed = parseBoolean(params.get("passed"), "passed");
    const checkName = parseBoundedText(params.get("checkName"), "checkName", { maxLength: 100 });
    const limit = parseLimit(params.get("limit"), { defaultValue: 100, maximum: 200 });
    const cursorContext = {
      endpoint: "dq",
      backend: context.status.backend,
      filters: { runId, seriesId, severity, passed, checkName },
      sort: "severity,passed,checkName,seriesId",
      direction: "asc" as const,
    };
    const cursor = params.get("cursor");
    const decoded = cursor ? decodeWarehouseCursor(cursor, cursorContext) : null;
    if (
      decoded &&
      (decoded.last.length !== 4 ||
        typeof decoded.last[0] !== "number" ||
        typeof decoded.last[1] !== "number" ||
        typeof decoded.last[2] !== "string" ||
        typeof decoded.last[3] !== "string")
    ) {
      throw new WarehouseCursorError();
    }
    const after = decoded
      ? {
          severityRank: Number(decoded.last[0]),
          passedRank: Number(decoded.last[1]),
          checkName: String(decoded.last[2]),
          seriesId: String(decoded.last[3]),
        }
      : undefined;

    const fetched = await warehouseAudit().listDqResults({
      runId,
      seriesId,
      severity,
      passed,
      checkName,
      after,
      limit: limit + 1,
    });
    const hasMore = fetched.length > limit;
    const results = fetched.slice(0, limit);
    const last = hasMore ? results.at(-1) : undefined;
    const nextCursor = last
      ? encodeWarehouseCursor(cursorContext, [
          severityRank(last.severity),
          last.passed == null ? 2 : last.passed ? 1 : 0,
          last.checkName,
          last.seriesId,
        ])
      : null;

    return warehouseSuccess(
      context.status.backend,
      { results, selectedRunId: results[0]?.runId ?? runId ?? null },
      { page: { limit, returned: results.length, nextCursor } }
    );
  } catch (error) {
    return warehouseCaughtError(error, "dq");
  }
}
