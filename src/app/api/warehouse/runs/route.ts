import {
  ETL_LOAD_TYPES,
  ETL_RUN_STATUSES,
  ETL_SERIES_STATUSES,
  decodeWarehouseCursor,
  encodeWarehouseCursor,
  parseBoolean,
  parseBoundedText,
  parseEnum,
  parseLimit,
  WarehouseCursorError,
  WarehouseValidationError,
  warehouseAudit,
  warehouseCaughtError,
  warehouseRouteContext,
  warehouseSuccess,
} from "@/lib/server/warehouse";

export async function GET(request: Request): Promise<Response> {
  const context = warehouseRouteContext();
  if (!context.ok) return context.response;

  try {
    const params = new URL(request.url).searchParams;
    const runId = parseBoundedText(params.get("runId"), "runId", { maxLength: 200 });
    const status = parseEnum(params.get("status"), "status", ETL_RUN_STATUSES);
    const includeSeries = parseBoolean(params.get("includeSeries"), "includeSeries") ?? false;
    const seriesStatus = parseEnum(params.get("seriesStatus"), "seriesStatus", ETL_SERIES_STATUSES);
    const loadType = parseEnum(params.get("loadType"), "loadType", ETL_LOAD_TYPES);
    const dqPassed = parseBoolean(params.get("dqPassed"), "dqPassed");
    const seriesId = parseBoundedText(params.get("seriesId"), "seriesId", { maxLength: 200 });
    const limit = parseLimit(params.get("limit"), { defaultValue: 50, maximum: 200 });
    if (includeSeries && !runId) {
      throw new WarehouseValidationError("runId", "runId is required when includeSeries is true.");
    }

    const cursorContext = {
      endpoint: "runs",
      backend: context.status.backend,
      filters: { runId, status },
      sort: "startedAt,runId",
      direction: "desc" as const,
    };
    const cursor = params.get("cursor");
    const decoded = cursor ? decodeWarehouseCursor(cursor, cursorContext) : null;
    if (
      decoded &&
      (decoded.last.length !== 2 ||
        typeof decoded.last[0] !== "string" ||
        typeof decoded.last[1] !== "string")
    ) {
      throw new WarehouseCursorError();
    }
    const before = decoded
      ? { startedAt: String(decoded.last[0]), runId: String(decoded.last[1]) }
      : undefined;

    const audit = warehouseAudit();
    const fetched = await audit.listRuns({ runId, status, before, limit: limit + 1 });
    const hasMore = fetched.length > limit;
    const runs = fetched.slice(0, limit);
    const last = hasMore ? runs.at(-1) : undefined;
    const nextCursor = last
      ? encodeWarehouseCursor(cursorContext, [last.startedAt, last.runId])
      : null;
    const seriesRuns = includeSeries && runId
      ? await audit.listSeriesRuns({
          runId,
          status: seriesStatus,
          loadType,
          dqPassed,
          seriesId,
          limit,
        })
      : [];

    return warehouseSuccess(
      context.status.backend,
      { runs, seriesRuns },
      { page: { limit, returned: runs.length, nextCursor } }
    );
  } catch (error) {
    return warehouseCaughtError(error, "runs");
  }
}
