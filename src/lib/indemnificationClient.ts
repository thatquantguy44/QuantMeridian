// Browser-side calls to the INDEM routes (spec020 IND-T14). Every failure becomes a typed outcome with a
// plain-language message, so the page never has to interpret HTTP.
import type { BookSummary, UiRunInput } from "./indemnificationCompose";
import { isRunResponse, isServiceError, isTransportError, type RunResponse } from "./indemnificationApi";

export type FailureKind =
  | "unconfigured" | "disabled" | "unreachable" | "timeout" | "busy" | "invalid" | "too_large" | "incompatible" | "other";
export type Outcome<T> =
  | { ok: true; data: T }
  | { ok: false; kind: FailureKind; message: string; issues: string[]; status: number };

export const FAILURE_TEXT: Record<FailureKind, string> = {
  unconfigured: "The INDEM service is not configured. Set INDEMNIFICATION_API_URL and INDEMNIFICATION_API_TOKEN on the terminal server and start the service.",
  disabled: "INDEM is local-only for now and is switched off in production.",
  unreachable: "The INDEM service cannot be reached. Check that it is running.",
  timeout: "The INDEM service did not answer in time. A large annual run can take several minutes: try a preview run.",
  busy: "The service is busy with another run. Try again in a moment.",
  invalid: "The service rejected these settings.",
  too_large: "This run is too large for the service. Use fewer paths, a shorter horizon or a coarser step.",
  incompatible: "The service answered with something that does not match the contract, so the result was not used.",
  other: "Something went wrong.",
};

const KIND: Record<string, FailureKind> = {
  BINDING_UNCONFIGURED: "unconfigured", BINDING_INCOMPATIBLE: "unconfigured", PRODUCTION_DISABLED: "disabled",
  SERVICE_UNAVAILABLE: "unreachable", SERVICE_TIMEOUT: "timeout", SERVICE_BUSY: "busy",
  REQUEST_INVALID: "invalid", REQUEST_CONTRACT_INVALID: "invalid", SNAPSHOT_INVALID: "invalid",
  REQUEST_TOO_LARGE: "too_large", BODY_TOO_LARGE: "too_large", RUN_TOO_LARGE: "too_large",
  RESPONSE_INVALID: "incompatible", RESPONSE_INCOMPATIBLE: "incompatible", RESPONSE_TOO_LARGE: "incompatible",
};

type Fetcher = typeof fetch;

function failure(status: number, body: unknown): Outcome<never> {
  const b = (typeof body === "object" && body !== null ? body : {}) as { code?: string; message?: string; issues?: unknown };
  const kind = (b.code && KIND[b.code]) || "other";
  const issues = Array.isArray(b.issues) ? b.issues.filter((x): x is string => typeof x === "string") : [];
  return { ok: false, kind, message: typeof b.message === "string" ? b.message : FAILURE_TEXT[kind], issues, status };
}

async function call<T>(
  url: string, init: RequestInit | undefined, accept: (body: unknown) => body is T, fetcher: Fetcher,
): Promise<Outcome<T>> {
  let response: Response;
  try { response = await fetcher(url, init); }
  catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return { ok: false, kind: "other", message: "Cancelled.", issues: [], status: 0 };
    return { ok: false, kind: "unreachable", message: "The terminal server cannot be reached.", issues: [], status: 0 };
  }
  let body: unknown;
  try { body = await response.json(); }
  catch { return { ok: false, kind: "incompatible", message: "The server returned something that is not JSON.", issues: [], status: response.status }; }
  if (response.ok) {
    return accept(body)
      ? { ok: true, data: body }
      : { ok: false, kind: "incompatible", message: FAILURE_TEXT.incompatible, issues: [], status: response.status };
  }
  if (isTransportError(body) || isServiceError(body) || (typeof body === "object" && body !== null && "code" in body)) return failure(response.status, body);
  return failure(response.status, {});
}

const isBook = (v: unknown): v is BookSummary => typeof v === "object" && v !== null && Array.isArray((v as BookSummary).borrowers) && typeof (v as BookSummary).defaults === "object";
export interface Health { status: string; ready: boolean; model_version: string; auth_configured: boolean }
const isHealth = (v: unknown): v is Health => typeof v === "object" && v !== null && typeof (v as Health).ready === "boolean";

export const loadBook = (fetcher: Fetcher = fetch) => call("/api/indemnification/book", undefined, isBook, fetcher);
export const loadHealth = (fetcher: Fetcher = fetch) => call("/api/indemnification/health", undefined, isHealth, fetcher);

export function runAnalysis(
  input: UiRunInput, options: { idempotencyKey?: string; signal?: AbortSignal; fetcher?: Fetcher } = {},
): Promise<Outcome<RunResponse>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  return call("/api/indemnification/runs", { method: "POST", headers, body: JSON.stringify(input), signal: options.signal }, isRunResponse, options.fetcher ?? fetch);
}
