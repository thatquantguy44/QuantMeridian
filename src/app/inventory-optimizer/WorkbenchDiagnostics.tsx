// Workbench views for engine spec0020 diagnostics (spec013 IBAL-004): LP sensitivity ranges, the
// one-parameter sweep, the elastic infeasibility explanation, and the MIP progress trace. Each
// calls the pinned engine through the IBAL service and shows only what it returns.
import { useEffect, useState } from "react";
import {
  explainIbal,
  sweepIbal,
  type DatasetEnvelope,
  type IbalInfeasibilityExplanation,
  type IbalParameterSweep,
  type IbalResult,
  type IbalSweepParameter,
  type RunConfig,
} from "@/lib/inventoryOptimizer";
import { ExplanationSummary, SensitivityView, reasonText } from "./Diagnostics";

const PARAMETERS: { value: IbalSweepParameter; label: string; collection: string; key: string }[] = [
  { value: "route_fee_rate", label: "Route fee rate", collection: "routes", key: "route_id" },
  { value: "demand_elasticity", label: "Demand elasticity", collection: "demand", key: "demand_group_id" },
  { value: "utilization_maximum", label: "Maximum utilization", collection: "utilization_policies", key: "policy_id" },
  { value: "utilization_minimum", label: "Minimum utilization", collection: "utilization_policies", key: "policy_id" },
];

const num = (value: number | null | undefined, digits = 6) =>
  value == null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: digits });

function targets(dataset: DatasetEnvelope | null, parameter: IbalSweepParameter): string[] {
  const entry = PARAMETERS.find((item) => item.value === parameter);
  const records = entry ? (dataset?.request as Record<string, unknown> | undefined)?.[entry.collection] : undefined;
  if (!entry || !Array.isArray(records)) return [];
  return records
    .map((record) => (record as Record<string, unknown>)[entry.key])
    .filter((value): value is string => typeof value === "string");
}

/** A one-parameter sweep (DIAG-004). Describes the response; never applies a value. */
export function SweepPanel({ dataset, runConfig }: { dataset: DatasetEnvelope | null; runConfig: RunConfig }) {
  const [parameter, setParameter] = useState<IbalSweepParameter>("route_fee_rate");
  const options = targets(dataset, parameter);
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState<"local" | "scenario">("local");
  const [lower, setLower] = useState("0");
  const [upper, setUpper] = useState("0.05");
  const [points, setPoints] = useState("5");
  // The engine refines toward a regime change until it spends this budget (at most 25 solves).
  const [maxSolves, setMaxSolves] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<IbalParameterSweep | null>(null);
  const chosen = options.includes(target) ? target : options[0] ?? "";

  const run = async () => {
    if (!dataset || !chosen) return;
    setBusy(true);
    setError(null);
    try {
      const sweep = mode === "local"
        ? { parameter, target_id: chosen, mode }
        : { parameter, target_id: chosen, mode, lower: Number(lower), upper: Number(upper), points: Number(points), max_solves: Number(maxSolves) };
      setReport((await sweepIbal(dataset, runConfig, sweep)).sweep);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : "Sweep failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-term-border pt-2 text-[10px]">
      <h4 className="font-semibold text-term-text">Parameter sweep</h4>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-term-text-dim">Parameter
          <select aria-label="Sweep parameter" value={parameter} onChange={(event) => { setParameter(event.target.value as IbalSweepParameter); setReport(null); }} className="mt-1 block rounded border border-term-border bg-term-panel-2 px-2 py-1 text-term-text">
            {PARAMETERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="text-term-text-dim">Record
          <select aria-label="Sweep record" value={chosen} onChange={(event) => setTarget(event.target.value)} disabled={!options.length} className="mt-1 block rounded border border-term-border bg-term-panel-2 px-2 py-1 text-term-text">
            {options.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="text-term-text-dim">Mode
          <select aria-label="Sweep mode" value={mode} onChange={(event) => setMode(event.target.value as "local" | "scenario")} className="mt-1 block rounded border border-term-border bg-term-panel-2 px-2 py-1 text-term-text">
            <option value="local">Local range (LP ranging)</option>
            <option value="scenario">Scenario grid (re-solve each point)</option>
          </select>
        </label>
        {mode === "scenario" && <>
          <label className="text-term-text-dim">From<input aria-label="Sweep lower" value={lower} onChange={(event) => setLower(event.target.value)} className="mt-1 block w-20 rounded border border-term-border bg-term-panel-2 px-2 py-1 text-term-text" /></label>
          <label className="text-term-text-dim">To<input aria-label="Sweep upper" value={upper} onChange={(event) => setUpper(event.target.value)} className="mt-1 block w-20 rounded border border-term-border bg-term-panel-2 px-2 py-1 text-term-text" /></label>
          <label className="text-term-text-dim">Points<input aria-label="Sweep points" value={points} onChange={(event) => setPoints(event.target.value)} className="mt-1 block w-14 rounded border border-term-border bg-term-panel-2 px-2 py-1 text-term-text" /></label>
          <label className="text-term-text-dim">Max solves<input aria-label="Sweep max solves" value={maxSolves} onChange={(event) => setMaxSolves(event.target.value)} className="mt-1 block w-14 rounded border border-term-border bg-term-panel-2 px-2 py-1 text-term-text" /></label>
        </>}
        <button type="button" className="term-btn" disabled={!dataset || !chosen || busy} onClick={() => void run()}>{busy ? "Sweeping…" : "Run sweep"}</button>
      </div>
      {!options.length && <p className="text-term-text-mute">This dataset has no record for that parameter.</p>}
      {error && <p role="alert" className="text-term-down">{error}</p>}
      {report?.unavailable_reason && <p className="text-term-text-mute">{reasonText(report.unavailable_reason)}</p>}
      {report?.local && (
        <p className="text-term-text">
          {report.field} on {report.target_id} can move over [{num(report.local.parameter_lower)}, {num(report.local.parameter_upper)}]
          {report.local.upper_bounded_by_domain || report.local.lower_bounded_by_domain ? " (an end is the parameter's own domain limit)" : ""} with the same optimal basis; objective
          {" "}{num(report.local.objective_at_lower)} … {num(report.local.objective_at_upper)} USD. Baseline {num(report.baseline_value)}; maps to the {report.local.maps_to}.
        </p>
      )}
      {report && report.mode === "scenario" && (
        <div className="max-h-64 overflow-auto">
          <p className="text-term-text-mute">{report.solve_count} of at most {report.max_solves} solves; points marked “refined” were added where the regime changes.</p>
          <table className="w-full min-w-[520px] text-left">
            <thead><tr className="text-term-text-mute"><th scope="col">Value</th><th scope="col">Status</th><th scope="col">Verified</th><th scope="col" className="text-right">Objective</th><th scope="col" className="text-right">Δ vs baseline</th><th scope="col">Binding changes</th></tr></thead>
            <tbody>
              {report.points.map((point) => (
                <tr key={point.value} className="border-t border-term-border">
                  <td className="py-1 font-mono">{num(point.value)}{point.is_baseline ? " (baseline)" : point.refinement ? " (refined)" : ""}</td>
                  <td>{point.status ?? point.error ?? "—"}</td>
                  <td>{point.verification_passed == null ? "—" : point.verification_passed ? "yes" : "no"}</td>
                  <td className="text-right font-mono">{num(point.objective_usd)}</td>
                  <td className="text-right font-mono">{num(point.objective_delta_usd)}</td>
                  <td className="font-mono text-term-text-mute">{[...point.binding_added.map((row) => `+${row}`), ...point.binding_removed.map((row) => `−${row}`)].join(" ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SensitivityTab({ result, dataset, runConfig }: { result: IbalResult | null; dataset: DatasetEnvelope | null; runConfig: RunConfig }) {
  if (!result) return <p className="p-2 text-2xs text-term-text-mute">No run yet.</p>;
  return (
    <div className="space-y-2 p-2">
      <SensitivityView sensitivity={result.sensitivity} />
      <SweepPanel dataset={dataset} runConfig={runConfig} />
    </div>
  );
}

// Explanations already fetched, by run id, so returning to the tab does not re-solve.
const explained = new Map<string, IbalInfeasibilityExplanation>();

/** The elastic infeasibility explanation (DIAG-003). Spec013 decision 2: it opens, and is fetched,
 * automatically only when the run is infeasible. Nothing is applied. */
export function InfeasibilityTab({ result, dataset, runConfig }: { result: IbalResult | null; dataset: DatasetEnvelope | null; runConfig: RunConfig }) {
  const runId = result?.run_id ?? null;
  const infeasible = result?.status === "infeasible";
  const [shown, setShown] = useState<{ runId: string; explanation: IbalInfeasibilityExplanation | null; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const cached = runId ? explained.get(runId) ?? null : null;
  const current = cached ?? (shown?.runId === runId ? shown?.explanation ?? null : null);
  const error = shown?.runId === runId ? shown?.error ?? null : null;

  const explain = async () => {
    if (!dataset || !runId) return;
    setBusy(true);
    try {
      const explanation = (await explainIbal(dataset, runConfig)).explanation;
      if (explained.size >= 20) explained.clear();
      explained.set(runId, explanation);
      setShown({ runId, explanation, error: null });
    } catch (err) {
      setShown({ runId, explanation: null, error: err instanceof Error ? err.message : "Explanation failed." });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (infeasible && runId && dataset && !explained.has(runId)) void explain();
    // Fetch once per infeasible run; a failure is shown with a retry button, not retried in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, infeasible]);

  if (!result) return <p className="p-2 text-2xs text-term-text-mute">No run yet.</p>;
  return (
    <div className="space-y-2 p-2 text-[10px]">
      <p className="text-term-text-dim">
        {infeasible
          ? "This run is infeasible. The engine solves a separate diagnostic model in which only utilization limits may stretch, and reports how far. It never changes the request or this result."
          : `This run is ${result.status}; the explanation applies to infeasible runs.`}
      </p>
      {infeasible && (busy
        ? <p className="text-term-text-mute">Explaining…</p>
        : error && <button type="button" className="term-btn" disabled={!dataset} onClick={() => void explain()}>Retry explanation</button>)}
      {error && <p role="alert" className="text-term-down">{error}</p>}
      <ExplanationSummary explanation={current} />
    </div>
  );
}

/** The MIP incumbent trace (DIAG-005), or the engine's reason there is none. */
export function MipProgressView({ result }: { result: IbalResult | null }) {
  const progress = result?.mip_progress;
  if (!progress) return <p className="text-term-text-mute">MIP progress was not requested for this run.</p>;
  if (!progress.available) return <p className="text-term-text-mute">{reasonText(progress.unavailable_reason)}</p>;
  return (
    <div className="overflow-x-auto text-[10px]">
      <table className="w-full min-w-[360px] text-left">
        <thead><tr className="text-term-text-mute"><th scope="col">#</th><th scope="col" className="text-right">Incumbent</th><th scope="col" className="text-right">Best bound</th><th scope="col" className="text-right">Gap</th><th scope="col" className="text-right">Nodes</th></tr></thead>
        <tbody>
          {progress.points.map((point, index) => (
            <tr key={index} className="border-t border-term-border">
              <td className="py-1">{index + 1}</td>
              <td className="text-right font-mono">{num(point.incumbent_objective)}</td>
              <td className="text-right font-mono">{num(point.best_bound)}</td>
              <td className="text-right font-mono">{point.relative_gap == null ? "—" : `${num(point.relative_gap * 100, 4)}%`}</td>
              <td className="text-right font-mono">{point.nodes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
