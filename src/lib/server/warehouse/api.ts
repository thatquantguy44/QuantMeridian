import { json } from "../http";
import { warehouseBackendStatus, type WarehouseBackendStatus } from "./backend";
import type { WarehouseFailure, WarehouseFailureCode, WarehouseSuccess } from "./contracts";
import { WarehouseCursorError } from "./cursor";
import { WarehouseValidationError } from "./validation";

const FAILURE_MESSAGES: Record<WarehouseFailureCode, string> = {
  INVALID_REQUEST: "The warehouse request is invalid.",
  BACKEND_UNSUPPORTED: "The configured warehouse backend is not supported.",
  PRODUCTION_GATE_CLOSED: "Warehouse Explorer production access is disabled.",
  DATABASE_UNAVAILABLE: "The warehouse database is unavailable.",
  QUERY_TIMEOUT: "The warehouse query timed out.",
  SERIES_NOT_FOUND: "The selected warehouse series was not found.",
  REVISION_SOURCE_UNSUPPORTED: "Revision data is unavailable for this source.",
  CURSOR_INVALID: "The pagination cursor is invalid for this request.",
};

function failureStatus(code: WarehouseFailureCode): number {
  if (code === "INVALID_REQUEST" || code === "CURSOR_INVALID") return 400;
  if (code === "SERIES_NOT_FOUND") return 404;
  if (code === "REVISION_SOURCE_UNSUPPORTED") return 409;
  if (code === "QUERY_TIMEOUT") return 504;
  return 503;
}

export function warehouseFailure(
  code: WarehouseFailureCode,
  options: { message?: string; retryable?: boolean } = {}
): Response {
  const body: WarehouseFailure = {
    ok: false,
    source: code === "BACKEND_UNSUPPORTED" || code === "PRODUCTION_GATE_CLOSED" ? "UNAVAILABLE" : "ERR",
    code,
    message: options.message ?? FAILURE_MESSAGES[code],
    retryable: options.retryable ?? ["DATABASE_UNAVAILABLE", "QUERY_TIMEOUT"].includes(code),
  };
  return json(body, { status: failureStatus(code) });
}

export function warehouseRouteContext():
  | { ok: true; status: WarehouseBackendStatus & { backend: "sqlite" | "postgres" } }
  | { ok: false; response: Response } {
  const status = warehouseBackendStatus();
  if (!status.gateOpen) {
    return {
      ok: false,
      response: warehouseFailure(status.code ?? "DATABASE_UNAVAILABLE", {
        message: status.reason ?? undefined,
      }),
    };
  }
  if (status.backend === "databricks") {
    return { ok: false, response: warehouseFailure("BACKEND_UNSUPPORTED") };
  }
  return { ok: true, status: status as WarehouseBackendStatus & { backend: "sqlite" | "postgres" } };
}

export function warehouseSuccess<T>(
  backend: "sqlite" | "postgres",
  data: T,
  options: {
    page?: WarehouseSuccess<T>["page"];
    warnings?: WarehouseSuccess<T>["warnings"];
    freshness?: WarehouseSuccess<T>["freshness"];
  } = {}
): Response {
  const body: WarehouseSuccess<T> = {
    ok: true,
    source: "DB",
    backend,
    observedAt: new Date().toISOString(),
    data,
    warnings: options.warnings ?? [],
    ...(options.page ? { page: options.page } : {}),
    ...(options.freshness ? { freshness: options.freshness } : {}),
  };
  return json(body);
}

export function warehouseCaughtError(error: unknown, routeFamily: string): Response {
  if (error instanceof WarehouseValidationError) {
    return warehouseFailure("INVALID_REQUEST", { message: error.message, retryable: false });
  }
  if (error instanceof WarehouseCursorError) {
    return warehouseFailure("CURSOR_INVALID", { retryable: false });
  }

  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const timeout = code === "57014" || code === "SQLITE_INTERRUPT";
  console.warn(`[warehouse] route_family=${routeFamily} outcome=${timeout ? "timeout" : "database_unavailable"}`);
  return warehouseFailure(timeout ? "QUERY_TIMEOUT" : "DATABASE_UNAVAILABLE");
}

