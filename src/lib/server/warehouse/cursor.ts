import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizedHash } from "./cache";
import type { WarehouseBackend } from "./backend";

const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 4_096;

type CursorValue = string | number | boolean | null;

export interface WarehouseCursorPayload {
  version: 1;
  endpoint: string;
  backend: Exclude<WarehouseBackend, "databricks">;
  filtersHash: string;
  sort: string;
  direction: "asc" | "desc";
  last: CursorValue[];
}

interface CursorContext {
  endpoint: string;
  backend: Exclude<WarehouseBackend, "databricks">;
  filters: unknown;
  sort: string;
  direction: "asc" | "desc";
}

type Env = Record<string, string | undefined>;

export class WarehouseCursorError extends Error {
  readonly code = "CURSOR_INVALID" as const;

  constructor(message = "Cursor is invalid for this request.") {
    super(message);
    this.name = "WarehouseCursorError";
  }
}

function productionRuntime(env: Env): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

function payloadFor(context: CursorContext, last: CursorValue[]): WarehouseCursorPayload {
  return {
    version: CURSOR_VERSION,
    endpoint: context.endpoint,
    backend: context.backend,
    filtersHash: normalizedHash(context.filters),
    sort: context.sort,
    direction: context.direction,
    last,
  };
}

function encodePayload(payload: WarehouseCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function signature(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function encodeWarehouseCursor(
  context: CursorContext,
  last: CursorValue[],
  env: Env = process.env
): string {
  const body = encodePayload(payloadFor(context, last));
  const secret = env.WAREHOUSE_CURSOR_SECRET?.trim();
  if (secret) return `s.${body}.${signature(body, secret)}`;
  if (productionRuntime(env)) {
    throw new WarehouseCursorError("Cursor signing is not configured.");
  }
  return `u.${body}`;
}

function parseToken(token: string, env: Env): WarehouseCursorPayload {
  if (!token || token.length > MAX_CURSOR_LENGTH) throw new WarehouseCursorError();
  const parts = token.split(".");
  const secret = env.WAREHOUSE_CURSOR_SECRET?.trim();

  let body: string;
  if (parts[0] === "s" && parts.length === 3) {
    if (!secret) throw new WarehouseCursorError();
    body = parts[1];
    const expected = Buffer.from(signature(body, secret));
    const received = Buffer.from(parts[2]);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new WarehouseCursorError();
    }
  } else if (parts[0] === "u" && parts.length === 2 && !productionRuntime(env)) {
    body = parts[1];
  } else {
    throw new WarehouseCursorError();
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as WarehouseCursorPayload;
    if (
      parsed.version !== CURSOR_VERSION ||
      typeof parsed.endpoint !== "string" ||
      (parsed.backend !== "sqlite" && parsed.backend !== "postgres") ||
      typeof parsed.filtersHash !== "string" ||
      typeof parsed.sort !== "string" ||
      (parsed.direction !== "asc" && parsed.direction !== "desc") ||
      !Array.isArray(parsed.last) ||
      parsed.last.length === 0 ||
      parsed.last.some(
        (value) => value !== null && !["string", "number", "boolean"].includes(typeof value)
      )
    ) {
      throw new WarehouseCursorError();
    }
    return parsed;
  } catch (error) {
    if (error instanceof WarehouseCursorError) throw error;
    throw new WarehouseCursorError();
  }
}

export function decodeWarehouseCursor(
  token: string,
  context: CursorContext,
  env: Env = process.env
): WarehouseCursorPayload {
  const parsed = parseToken(token, env);
  if (
    parsed.endpoint !== context.endpoint ||
    parsed.backend !== context.backend ||
    parsed.filtersHash !== normalizedHash(context.filters) ||
    parsed.sort !== context.sort ||
    parsed.direction !== context.direction
  ) {
    throw new WarehouseCursorError();
  }
  return parsed;
}

