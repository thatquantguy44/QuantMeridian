const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const LONE_SURROGATE = /[\ud800-\udfff]/u;
const SOURCE_PATTERN = /^[a-z0-9_.-]+$/;

export class WarehouseValidationError extends Error {
  readonly code = "INVALID_REQUEST" as const;

  constructor(
    readonly field: string,
    message: string
  ) {
    super(message);
    this.name = "WarehouseValidationError";
  }
}

function invalid(field: string, message: string): never {
  throw new WarehouseValidationError(field, message);
}

function rejectUnsafeText(value: string, field: string): void {
  if (CONTROL_CHARACTERS.test(value) || LONE_SURROGATE.test(value)) {
    invalid(field, `${field} contains unsupported characters.`);
  }
}

export function parseBoundedText(
  value: string | null | undefined,
  field: string,
  options: { required?: boolean; maxLength: number; trim?: boolean }
): string | undefined {
  if (value == null) {
    if (options.required) invalid(field, `${field} is required.`);
    return undefined;
  }
  const normalized = options.trim === false ? value : value.trim();
  if (!normalized) {
    if (options.required) invalid(field, `${field} is required.`);
    return undefined;
  }
  rejectUnsafeText(normalized, field);
  if (normalized.length > options.maxLength) {
    invalid(field, `${field} must be at most ${options.maxLength} characters.`);
  }
  return normalized;
}

export function parseSource(value: string | null | undefined, required = true): string | undefined {
  const source = parseBoundedText(value, "source", { required, maxLength: 40 });
  if (source === undefined) return undefined;
  const normalized = source.toLowerCase();
  if (!SOURCE_PATTERN.test(normalized)) {
    invalid("source", "source may contain only letters, digits, dots, underscores, and hyphens.");
  }
  return normalized;
}

export function parseSeriesId(value: string | null | undefined, required = true): string | undefined {
  return parseBoundedText(value, "seriesId", { required, maxLength: 200 });
}

export interface SeriesKey {
  source: string;
  seriesId: string;
}

export function parseSeriesKey(params: URLSearchParams): SeriesKey {
  return {
    source: parseSource(params.get("source"), true)!,
    seriesId: parseSeriesId(params.get("seriesId"), true)!,
  };
}

function calendarDateValid(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseIsoDate(
  value: string | null | undefined,
  field: string,
  required = false
): string | undefined {
  const normalized = parseBoundedText(value, field, { required, maxLength: 10 });
  if (normalized === undefined) return undefined;
  if (!calendarDateValid(normalized)) invalid(field, `${field} must be a valid YYYY-MM-DD date.`);
  return normalized;
}

export function parseDateRange(params: URLSearchParams): { from?: string; to?: string } {
  const from = parseIsoDate(params.get("from"), "from");
  const to = parseIsoDate(params.get("to"), "to");
  if (from && to && from > to) invalid("from", "from must be on or before to.");
  return { from, to };
}

export function parseLimit(
  value: string | null | undefined,
  options: { defaultValue: number; maximum: number; field?: string }
): number {
  const field = options.field ?? "limit";
  if (value == null || value.trim() === "") return options.defaultValue;
  if (!/^\d+$/.test(value)) invalid(field, `${field} must be an integer.`);
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > options.maximum) {
    invalid(field, `${field} must be between 1 and ${options.maximum}.`);
  }
  return limit;
}

export function parseBoolean(
  value: string | null | undefined,
  field: string
): boolean | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return invalid(field, `${field} must be true or false.`);
}

export function parseEnum<const T extends readonly string[]>(
  value: string | null | undefined,
  field: string,
  allowed: T,
  fallback?: T[number]
): T[number] | undefined {
  if (value == null || value.trim() === "") return fallback;
  if (!allowed.includes(value as T[number])) invalid(field, `${field} is not supported.`);
  return value as T[number];
}

export function parseSearch(value: string | null | undefined): string | undefined {
  return parseBoundedText(value, "q", { maxLength: 100 });
}

/** Escape a value for `LIKE ... ESCAPE '!'`; callers still bind the returned value. */
export function escapeLike(value: string): string {
  return value.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_");
}

export function parseExactFilter(
  value: string | null | undefined,
  field: string,
  maxLength = 100
): string | undefined {
  return parseBoundedText(value, field, { maxLength });
}

