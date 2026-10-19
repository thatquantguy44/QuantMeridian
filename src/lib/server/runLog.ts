// OPT session run log (InventoryBallast 0018 REQ-029 / T-015). Every model run the terminal's own
// server routes forward to a model service is recorded here as metadata only: identity, the
// service's own status and verification, the service-reported solve time, the round trip this
// server measured, the source label and the input hash. No request rows, allocations or objective
// values are kept. The log lives in this server process's memory, holds the newest RUN_LOG_CAPACITY
// entries and is lost on restart. It is not an audit record; Spec015 owns the durable registry.

export const RUN_LOG_CAPACITY = 200;

export type RunLogModel = "IBAL" | "MMKT" | "COLL";
export type RunLogKind = "run" | "stress" | "showcase";

export interface RunLogEntry {
  model: RunLogModel;
  kind: RunLogKind;
  /** When this server received the service's answer (ISO 8601, server clock). */
  recorded_at: string;
  http_status: number;
  run_id: string | null;
  /** The service's own status, or its error code when the run did not complete. */
  status: string;
  /** The service's own verification verdict; null when it returned none. */
  verified: boolean | null;
  /** Solve time the service reported, in milliseconds; null when it reports none. */
  solve_ms: number | null;
  /** Round trip from this server to the service and back, in milliseconds. */
  round_trip_ms: number;
  source: string | null;
  input_hash: string | null;
  model_version: string | null;
}

type Json = Record<string, unknown>;

const STORE_KEY = Symbol.for("quantmeridian.optRunLog");
type Store = { started_at: string; entries: RunLogEntry[] };

function store(): Store {
  const holder = globalThis as unknown as Record<symbol, Store | undefined>;
  holder[STORE_KEY] ??= { started_at: new Date().toISOString(), entries: [] };
  return holder[STORE_KEY]!;
}

export function recordRun(entry: RunLogEntry): void {
  const { entries } = store();
  entries.push(entry);
  if (entries.length > RUN_LOG_CAPACITY) entries.splice(0, entries.length - RUN_LOG_CAPACITY);
}

/** Newest first. */
export function listRuns(): { started_at: string; entries: RunLogEntry[] } {
  const { started_at, entries } = store();
  return { started_at, entries: [...entries].reverse() };
}

export function clearRunLog(): void {
  const holder = globalThis as unknown as Record<symbol, Store | undefined>;
  delete holder[STORE_KEY];
}

const obj = (value: unknown): Json | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const bool = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);
const ms = (seconds: number | null) => (seconds == null ? null : Math.round(seconds * 1000 * 100) / 100);

function base(model: RunLogModel, kind: RunLogKind, httpStatus: number, roundTripMs: number) {
  return { model, kind, recorded_at: new Date().toISOString(), http_status: httpStatus, round_trip_ms: Math.round(roundTripMs) };
}

/** A non-2xx answer: keep the service's error code, never a guessed status. */
function failed(model: RunLogModel, kind: RunLogKind, httpStatus: number, payload: unknown, roundTripMs: number): RunLogEntry {
  const body = obj(payload);
  return {
    ...base(model, kind, httpStatus, roundTripMs),
    run_id: null,
    status: str(body?.code) ?? `HTTP_${httpStatus}`,
    verified: null, solve_ms: null, source: null, input_hash: null, model_version: null,
  };
}

const IBAL_KINDS: Record<string, RunLogKind> = {
  "/v1/runs": "run",
  "/v1/scenarios/stress-test": "stress",
  "/v1/showcase/runs": "showcase",
};

/** The IBAL paths that are model runs; diagnostics (explain, sweep) and reads are not logged. */
export function ibalRunKind(path: string): RunLogKind | null {
  return IBAL_KINDS[path] ?? null;
}

export function ibalLogEntry(kind: RunLogKind, httpStatus: number, payload: unknown, request: unknown, roundTripMs: number): RunLogEntry {
  if (httpStatus < 200 || httpStatus >= 300) return failed("IBAL", kind, httpStatus, payload, roundTripMs);
  const body = obj(payload) ?? {};
  const source = obj(body.source);
  const sourceLabel = str(source?.mode);
  if (kind === "showcase") {
    const report = obj(body.report);
    const passed = bool(report?.passed);
    const book = str(obj(request)?.book_id);
    return {
      ...base("IBAL", kind, httpStatus, roundTripMs),
      run_id: book ? `showcase:${book}` : null,
      status: passed == null ? "unknown" : passed ? "passed" : "failed",
      verified: passed, solve_ms: null,
      source: str(body.data_label), input_hash: null, model_version: str(body.engine_commit),
    };
  }
  if (kind === "stress") {
    const report = obj(body.stress_report);
    const count = num(report?.scenario_count);
    const feasible = num(report?.feasible_count);
    const failedChecks = num(report?.verification_failed_count);
    return {
      ...base("IBAL", kind, httpStatus, roundTripMs),
      run_id: [str(body.baseline_run_id), str(body.scenario_type)].filter(Boolean).join(" · ") || null,
      status: count == null ? "unknown" : `${feasible ?? 0}/${count} feasible`,
      verified: failedChecks == null ? null : failedChecks === 0,
      solve_ms: null, source: sourceLabel, input_hash: str(body.request_hash), model_version: null,
    };
  }
  const result = obj(body.result) ?? {};
  const timings = obj(result.timings);
  const solver = obj(result.solver);
  return {
    ...base("IBAL", kind, httpStatus, roundTripMs),
    run_id: str(result.run_id),
    status: str(result.status) ?? "unknown",
    verified: bool(obj(result.verification)?.passed),
    solve_ms: ms(num(timings?.solve_seconds) ?? num(solver?.runtime_seconds)),
    source: sourceLabel, input_hash: str(result.input_hash), model_version: str(result.package_version),
  };
}

export function mmktLogEntry(httpStatus: number, payload: unknown, roundTripMs: number): RunLogEntry {
  if (httpStatus < 200 || httpStatus >= 300) return failed("MMKT", "run", httpStatus, payload, roundTripMs);
  const body = obj(payload) ?? {};
  const run = obj(body.run) ?? {};
  const currencies = Array.isArray(body.currency_results) ? body.currency_results.map(obj) : [];
  const checks = currencies.map((item) => bool(obj(item?.verification)?.passed));
  const rateSource = str(run.rate_source);
  return {
    ...base("MMKT", "run", httpStatus, roundTripMs),
    run_id: str(run.run_id),
    status: str(run.status) ?? "unknown",
    verified: checks.length && checks.every((item) => item !== null) ? checks.every(Boolean) : null,
    solve_ms: null,
    source: rateSource === "sim" ? `sim:${str(run.sim_set_id) ?? "unnamed"}` : rateSource,
    input_hash: str(run.request_hash),
    model_version: str(run.model_family),
  };
}

export function collateralLogEntry(httpStatus: number, payload: unknown, roundTripMs: number): RunLogEntry {
  if (httpStatus < 200 || httpStatus >= 300) return failed("COLL", "run", httpStatus, payload, roundTripMs);
  const body = obj(payload) ?? {};
  const verification = obj(body.adapter_verification);
  return {
    ...base("COLL", "run", httpStatus, roundTripMs),
    run_id: str(body.run_id),
    status: str(body.lifecycle_status) ?? "unknown",
    verified: bool(verification?.passed),
    solve_ms: null,
    source: str(body.source_mode),
    input_hash: str(body.input_hash),
    model_version: str(body.model_commit),
  };
}
