// Engine spec0020 solver diagnostics for the IBAL workbench and showcase (spec013 IBAL-004).
// Every figure is the engine's own; when the engine could not produce a diagnostic it says why with
// a stable reason code, which is shown as-is (with a plain-language gloss), never filled in.
import type {
  IbalCoefficientRange,
  IbalInfeasibilityExplanation,
  IbalResult,
  IbalSensitivity,
} from "@/lib/inventoryOptimizer";

const num = (value: number | null | undefined, digits = 6) =>
  value == null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: digits });
const sci = (value: number | null | undefined) => (value == null ? "—" : value.toExponential(3));
const bound = (value: number | null | undefined, side: "lower" | "upper") =>
  value == null ? (side === "lower" ? "−∞" : "+∞") : num(value);

/** Plain-language glosses for the engine's stable reason codes (spec0020). */
export const DIAGNOSTIC_REASONS: Record<string, string> = {
  formulation_not_continuous_lp: "LP ranges exist only for a continuous LP; this solve is a MIP or QP.",
  solve_not_optimal: "LP ranges need an optimal solve; this one is not optimal.",
  no_valid_basis: "The solver returned no valid basis to range.",
  backend_ranging_failed: "The solver could not compute ranges for this basis.",
  backend_does_not_report_ranging: "The installed solver backend does not report LP ranges.",
  formulation_has_no_integer_variables: "MIP progress applies only to a model with integer variables.",
  backend_does_not_report_mip_progress: "The installed solver backend does not report MIP progress.",
  parameter_changes_the_model_shape: "Changing this parameter changes the model's shape, so no single range applies; use the scenario grid.",
  parameter_moves_no_model_entry: "This parameter does not enter the solved model, so it has no range.",
  parameter_moves_more_than_one_model_entry: "This parameter moves more than one model coefficient, so one LP range cannot describe it; use the scenario grid.",
};

const OUTCOMES: Record<IbalInfeasibilityExplanation["outcome"], string> = {
  original_is_feasible: "The request is feasible; there is nothing to explain.",
  restorable: "Feasible if the utilization limits below move.",
  not_restorable: "No utilization change makes it feasible; the cause is a constraint that is never relaxed.",
  no_relaxable_rows: "The model has no utilization limits, the only rows the diagnostic may relax.",
  no_normalization_scale: "An inventory has no lendable shares to measure a relaxation against.",
  elastic_solve_failed: "The diagnostic model did not solve and verify.",
};

export function reasonText(code: string | null | undefined): string {
  if (!code) return "Unavailable.";
  return `${DIAGNOSTIC_REASONS[code] ?? "Unavailable."} (${code})`;
}

function RangeRow({ name, range }: { name: string; range: IbalCoefficientRange | null }) {
  if (!range) return null;
  return (
    <tr className="border-t border-term-border">
      <td className="py-1 pr-3">{name}</td>
      <td className="pr-3 text-right font-mono">{range.count}</td>
      <td className="pr-3 text-right font-mono">{sci(range.min_abs)}</td>
      <td className="pr-3 text-right font-mono">{sci(range.max_abs)}</td>
      <td className="text-right font-mono">{sci(range.ratio)}</td>
    </tr>
  );
}

/** Model size, HiGHS-style coefficient ranges, scaling warnings and phase timings (DIAG-001). */
export function ModelStatisticsView({ result }: { result: IbalResult | null }) {
  const stats = result?.model_statistics;
  if (!stats) return <p className="text-term-text-mute">Model statistics are unavailable for this result.</p>;
  const timings = result?.timings;
  return (
    <div className="space-y-2 text-[10px]">
      <dl className="grid grid-cols-2 gap-1 text-term-text-dim sm:grid-cols-5">
        <div><dt className="text-term-text-mute">Variables</dt><dd className="font-mono">{stats.variable_count}</dd></div>
        <div><dt className="text-term-text-mute">Rows</dt><dd className="font-mono">{stats.row_count}</dd></div>
        <div><dt className="text-term-text-mute">Nonzeros</dt><dd className="font-mono">{stats.nonzero_count}</dd></div>
        <div><dt className="text-term-text-mute">Integer variables</dt><dd className="font-mono">{stats.integer_variable_count}</dd></div>
        <div><dt className="text-term-text-mute">Quadratic entries</dt><dd className="font-mono">{stats.quadratic_nonzero_count}</dd></div>
      </dl>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-left">
          <thead>
            <tr className="text-term-text-mute">
              <th scope="col">Values (absolute, zeros and infinities left out)</th>
              <th scope="col" className="text-right">Count</th>
              <th scope="col" className="text-right">Min</th>
              <th scope="col" className="text-right">Max</th>
              <th scope="col" className="text-right">Max/min</th>
            </tr>
          </thead>
          <tbody>
            <RangeRow name="Constraint matrix" range={stats.matrix} />
            <RangeRow name="Objective" range={stats.objective} />
            <RangeRow name="Variable bounds" range={stats.bounds} />
            <RangeRow name="Row limits" range={stats.row_limits} />
            <RangeRow name="Quadratic objective" range={stats.quadratic_objective} />
          </tbody>
        </table>
      </div>
      {stats.scaling_warnings.length ? (
        <ul className="list-inside list-disc text-term-down">
          {stats.scaling_warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : (
        <p className="text-term-text-mute">No range spans more than {sci(stats.scaling_warning_ratio)}; no scaling warning.</p>
      )}
      {timings && (
        <p className="text-term-text-mute">
          Compile {num(timings.compile_seconds * 1000, 2)} ms · solve {num(timings.solve_seconds * 1000, 2)} ms · verify{" "}
          {num(timings.verify_seconds * 1000, 2)} ms (wall clock; differs on every run)
        </p>
      )}
    </div>
  );
}

/** LP sensitivity ranges (DIAG-002), or the engine's reason there are none. */
export function SensitivityView({ sensitivity, maxRows = 40 }: { sensitivity: IbalSensitivity | null | undefined; maxRows?: number }) {
  if (sensitivity == null) return <p className="text-term-text-mute">Ranges were not requested for this solve.</p>;
  if (!sensitivity.available) return <p className="text-term-text-mute">{reasonText(sensitivity.unavailable_reason)}</p>;
  const routes = sensitivity.objective_coefficients.filter((item) => item.variable.kind === "q");
  const rows = [...sensitivity.row_limits].sort((a, b) => Number(b.binding) - Number(a.binding));
  return (
    <div className="space-y-3 text-[10px]">
      <div>
        <h4 className="font-semibold text-term-text">Route objective coefficients · {routes.length}</h4>
        <p className="text-term-text-mute">The coefficient can move anywhere in the interval and the current allocation stays optimal.</p>
        <div className="max-h-64 overflow-auto">
          <table className="w-full min-w-[520px] text-left">
            <thead>
              <tr className="text-term-text-mute">
                <th scope="col">Route</th>
                <th scope="col" className="text-right">Shares</th>
                <th scope="col" className="text-right">Coefficient</th>
                <th scope="col" className="text-right">Range</th>
                <th scope="col" className="text-right">Objective at ends (USD)</th>
              </tr>
            </thead>
            <tbody>
              {routes.slice(0, maxRows).map((item) => (
                <tr key={item.variable.scope_id} className="border-t border-term-border">
                  <td className="py-1 font-mono">{item.variable.scope_id}</td>
                  <td className="text-right font-mono">{num(item.value, 2)}</td>
                  <td className="text-right font-mono">{sci(item.coefficient)}</td>
                  <td className="text-right font-mono">[{item.coefficient_lower == null ? "−∞" : sci(item.coefficient_lower)}, {item.coefficient_upper == null ? "+∞" : sci(item.coefficient_upper)}]</td>
                  <td className="text-right font-mono">{num(item.objective_at_lower)} … {num(item.objective_at_upper)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h4 className="font-semibold text-term-text">Row limits · {rows.length}</h4>
        <p className="text-term-text-mute">A binding limit moves the objective along its shadow price; a limit that does not bind can move out freely.</p>
        <div className="max-h-64 overflow-auto">
          <table className="w-full min-w-[560px] text-left">
            <thead>
              <tr className="text-term-text-mute">
                <th scope="col">Row</th>
                <th scope="col">Binding</th>
                <th scope="col" className="text-right">Activity</th>
                <th scope="col" className="text-right">Limit</th>
                <th scope="col" className="text-right">Range</th>
                <th scope="col" className="text-right">Objective at ends (USD)</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, maxRows).map((item) => (
                <tr key={`${item.row.kind}:${item.row.scope_id}`} className="border-t border-term-border">
                  <td className="py-1">{item.row.kind.replaceAll("_", " ")} <span className="font-mono text-term-text-mute">{item.row.scope_id}</span></td>
                  <td>{item.binding ? "yes" : "no"}</td>
                  <td className="text-right font-mono">{num(item.activity, 2)}</td>
                  <td className="text-right font-mono">{item.limit} {num(item.limit_value, 2)}</td>
                  <td className="text-right font-mono">[{bound(item.limit_lower, "lower")}, {bound(item.limit_upper, "upper")}]</td>
                  <td className="text-right font-mono">{num(item.objective_at_lower)} … {num(item.objective_at_upper)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** The elastic infeasibility explanation (DIAG-003). Describes; never applies a change. */
export function ExplanationSummary({ explanation }: { explanation: IbalInfeasibilityExplanation | null | undefined }) {
  if (!explanation) return null;
  return (
    <div className="mt-2 space-y-1 text-[10px]">
      <p className="text-term-text">
        <span className="font-semibold">Elastic diagnostic:</span> {OUTCOMES[explanation.outcome]}{" "}
        <span className="font-mono text-term-text-mute">({explanation.outcome})</span>
      </p>
      <p className="text-term-text-mute">{explanation.message}</p>
      {explanation.relaxations.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left">
            <thead>
              <tr className="text-term-text-mute">
                <th scope="col">Limit</th>
                <th scope="col">Inventory</th>
                <th scope="col" className="text-right">Shares</th>
                <th scope="col" className="text-right">Utilization</th>
              </tr>
            </thead>
            <tbody>
              {explanation.relaxations.map((item) => (
                <tr key={`${item.row.kind}:${item.row.scope_id}`} className="border-t border-term-border">
                  <td className="py-1">{item.row.kind.replaceAll("_", " ")} ({item.limit})</td>
                  <td className="font-mono">{item.inventory_id}</td>
                  <td className="text-right font-mono">{num(item.original_limit_shares, 2)} → {num(item.required_limit_shares, 2)}</td>
                  <td className="text-right font-mono">{num(item.original_utilization, 4)} → {num(item.required_utilization, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {explanation.relaxed_model_status && (
        <p className="text-term-text-mute">With only these limits moved, the original model solves {explanation.relaxed_model_status}. Nothing has been changed.</p>
      )}
    </div>
  );
}
