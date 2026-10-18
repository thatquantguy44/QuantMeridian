"use client";

import { useEffect, useState } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { fmtAbbr, fmtUsdAbbr } from "@/lib/format";
import { changedSnapshotFields, comparableCollateralRuns, isCollateralRun, type CollateralRun } from "@/lib/collateralOptimizer";

const SCENARIOS = [
  ["baseline", "Baseline", "Reallocate the feasible, expensive current posting."],
  ["margin_spike", "Margin spike", "US CCP call rises 35%; incumbent savings are unavailable."],
  ["liquidity_scarcity", "Liquidity scarcity", "A higher local reserve binds."],
  ["cutoff_and_fees", "Cutoff + fees", "Near deadlines and higher activation fees."],
  ["infeasible_stress", "Infeasible stress", "Eligible capacity cannot cover an extreme call."]
] as const;

type Health = { status?: string; readiness?: string; detail?: string; model_status?: string };
type ErrorBody = { code?: string; message?: string; issues?: { location: string; message: string }[] };

function failure(body: ErrorBody, fallback: string): string {
  const issues = body.issues?.map((item) => item.location + ": " + item.message).join("; ");
  return [body.code, issues || body.message || fallback].filter(Boolean).join(" — ");
}

async function post(path: string, payload: unknown): Promise<unknown> {
  const response = await fetch(path, { method: "POST", cache: "no-store",
    headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json() as unknown;
  if (!response.ok) throw Error(failure(body as ErrorBody, "Request failed."));
  return body;
}

const cell = "border-b border-term-border-soft px-2 py-1.5 text-left text-xs";
const numberCell = cell + " text-right tnum";

export default function CollateralPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [scenario, setScenario] = useState("baseline");
  const [run, setRun] = useState<CollateralRun | null>(null);
  const [baseline, setBaseline] = useState<CollateralRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState("");

  async function solve(payload: unknown, selected: string) {
    setBusy(true); setError(null); setRun(null);
    try {
      const data = await post("/api/collateral-optimizer/runs", payload);
      if (!isCollateralRun(data)) throw Error("Terminal result contract failed.");
      setRun(data);
      setScenario(selected);
      if (selected === "baseline") setBaseline(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Collateral service unavailable.");
    } finally { setBusy(false); }
  }

  useEffect(() => {
    let active = true;
    async function start() {
      try {
        const response = await fetch("/api/collateral-optimizer/health", { cache: "no-store" });
        const body = await response.json() as Health & ErrorBody;
        if (!active) return;
        if (!response.ok) { setHealth({ readiness: body.code ?? "UNAVAILABLE", detail: body.message }); return; }
        setHealth(body);
        if (body.readiness === "READY") void solve({ source_mode: "SIM", scenario_id: "baseline" }, "baseline");
      } catch { if (active) setHealth({ readiness: "UNAVAILABLE", detail: "Service could not be reached." }); }
    }
    void start();
    return () => { active = false; };
  }, []);

  async function solveUpload() {
    try {
      const snapshot = JSON.parse(upload) as unknown;
      await post("/api/collateral-optimizer/validate", { source_mode: "USER_UPLOAD", snapshot });
      await solve({ source_mode: "USER_UPLOAD", snapshot }, "upload");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Invalid native JSON snapshot."); }
  }

  const result = run?.result;
  const verified = run?.lifecycle_status === "SUCCEEDED_VERIFIED" && run.adapter_verification.passed;
  const cost = verified ? result?.cost : null;
  const changes = baseline && run ? changedSnapshotFields(baseline.snapshot, run.snapshot) : [];
  const comparable = baseline && run ? comparableCollateralRuns(baseline, run) : false;
  const target = new Map<string, number>();
  for (const row of result?.allocations ?? []) target.set(row.asset_id, (target.get(row.asset_id) ?? 0) + row.market_value);
  const current = new Map<string, number>();
  for (const row of run?.snapshot.current_pledges ?? []) current.set(row.asset_id, (current.get(row.asset_id) ?? 0) + row.market_value);

  return <div className="flex min-h-full flex-col">
    <PageHeader code="COLL" title="Collateral Management"
      desc="Pinned InventoryBallast model · local demonstration preview"
      right={<Tag tone="amber">SIM / NO LIVE RECOMMENDATION</Tag>} />
    <div className="mx-2 mt-2 border border-term-amber/40 bg-term-panel p-3 text-xs text-term-text-dim" role="status">
      This is a deterministic synthetic book solved by the pinned model. Results are local previews, not governed inventory,
      production recommendations, booked movements, or audited operational runs.
    </div>
    <div className="grid gap-2 p-2 lg:grid-cols-[1fr_2fr]">
      <Panel title="Binding and scenario" code="BIND">
        <div className="space-y-3 p-3 text-xs">
          <p>Service: <strong>{health?.readiness ?? "LOADING"}</strong> · {health?.detail ?? "Checking binding…"}</p>
          <p>Model state: {health?.model_status ?? "Unavailable"}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SCENARIOS.map(([id, label, detail]) =>
              <button key={id} type="button" disabled={busy || health?.readiness !== "READY"}
                onClick={() => void solve({ source_mode: "SIM", scenario_id: id }, id)}
                aria-pressed={scenario === id}
                className={"border px-3 py-2 text-left hover:border-term-amber " +
                  (scenario === id ? "border-term-amber text-term-amber" : "border-term-border text-term-text-dim")}>
                <strong className="block">{label}</strong><span>{detail}</span>
              </button>)}
          </div>
          <button type="button" className="border border-term-border px-2 py-1 text-term-text"
            onClick={() => setUpload(run ? JSON.stringify(run.snapshot, null, 2) : "")}>
            Copy current native snapshot into editor
          </button>
          <label className="block">Validated JSON upload or edited native snapshot
            <textarea aria-label="Native collateral snapshot JSON" value={upload}
              onChange={(event) => setUpload(event.target.value)} rows={5}
              className="mt-1 w-full border border-term-border bg-term-bg p-2 font-mono text-xs text-term-text" />
          </label>
          <button type="button" onClick={() => void solveUpload()} disabled={!upload || busy || health?.readiness !== "READY"}
            className="border border-term-amber px-3 py-1 text-term-amber disabled:opacity-40">
            Validate and solve upload
          </button>
        </div>
      </Panel>
      <div className="space-y-2">
        {busy && <Panel title="Solving" code="RUN"><p className="p-3 text-xs" role="status">Running the pinned optimizer…</p></Panel>}
        {error && <Panel title="Validation or service error" code="ERR"><p className="p-3 text-xs text-term-down" role="alert">{error}</p></Panel>}
        {!run && !busy && !error && <Panel title="No result" code="EMPTY"><p className="p-3 text-xs">Select a scenario when the service is ready.</p></Panel>}
        {run && <>
          <Panel title="Model result" code="RESULT" right={<Tag tone={verified ? "up" : "down"}>{run.lifecycle_status}</Tag>}>
            <KpiStrip>
              <Stat label="Target cost" value={cost ? fmtUsdAbbr(cost.total_usd) : "Unavailable"}
                sub={run.snapshot.horizon_days + " day horizon · USD"} />
              <Stat label="Modeled savings" value={cost?.savings_usd == null ? "Unavailable" : fmtUsdAbbr(cost.savings_usd)}
                sub={cost?.savings_usd == null ? "Incumbent invalid or no verified target" : "vs verified incumbent · USD"} />
              <Stat label="Remaining liquidity" value={result?.residual_liquidity_usd == null ? "Unavailable" : fmtUsdAbbr(result.residual_liquidity_usd)}
                sub="supplied local policy · USD" />
            </KpiStrip>
            <div className="grid gap-1 p-3 text-xs text-term-text-dim md:grid-cols-2">
              <span>Input: {run.source_mode} / native {run.native_source} · {run.as_of}</span>
              <span>Input age: {run.input_age_minutes.toFixed(0)} minutes</span>
              <span>Model: {run.package_version} @ {run.model_commit.slice(0, 12)}</span>
              <span>Adapter: {run.adapter_version} · snapshot/result 1.0 · {result?.formulation}</span>
              <span className="break-all">Input hash: {run.input_hash}</span>
              <span className="break-all">Parent hash: {run.parent_hash ?? "None"}</span>
              <span>Scenario: {run.scenario_id ?? "Uploaded snapshot"}</span>
              <span>Verifier: {run.adapter_verification.passed ? "fresh assessment passed" : "no approved target"}</span>
            </div>
          </Panel>
          {baseline && run.run_id !== baseline.run_id &&
            <Panel title="Baseline comparison" code="COMPARE">
              <p className="p-3 text-xs text-term-text-dim">
                {comparable ? "Same snapshot and pin. Costs are comparable in USD over the same horizon."
                  : "NON-COMPARABLE for a causal savings claim: snapshot or pin differs."}
                {" "}Changed fields: {changes.join(", ") || "none"}.
                {" "}Baseline hash: {baseline.input_hash.slice(0, 12)} · Current hash: {run.input_hash.slice(0, 12)}.
              </p>
            </Panel>}
          {verified && cost && <Panel title="USD cost over modeled horizon" code="COST">
            <div className="grid grid-cols-2 gap-2 p-3 text-xs sm:grid-cols-4">
              <Stat label="Carry" value={fmtUsdAbbr(cost.carry_usd)} />
              <Stat label="Movement" value={fmtUsdAbbr(cost.variable_move_usd)} />
              <Stat label="Activation fees" value={fmtUsdAbbr(cost.fixed_activation_usd)} />
              <Stat label="Current cost" value={cost.current_cost_usd == null ? "Unavailable" : fmtUsdAbbr(cost.current_cost_usd)} />
            </div>
          </Panel>}
        </>}
      </div>
    </div>
    {run && <div className="grid gap-2 px-2 pb-2 xl:grid-cols-2">
      <Panel title="Calls and haircut-adjusted coverage" code="CALLS">
        <div className="overflow-x-auto"><table className="w-full">
          <thead><tr>{["Call / agreement", "Type", "Required USD", "Covered USD", "Shortfall USD"].map(x => <th key={x} className={cell}>{x}</th>)}</tr></thead>
          <tbody>{run.snapshot.calls.map(call => {
            const row = result?.coverage.find(item => item.call_id === call.call_id);
            return <tr key={call.call_id}>
              <td className={cell}>{call.call_id}<small className="block text-term-text-mute">{call.agreement_id}</small></td>
              <td className={cell}>{call.margin_type}</td>
              <td className={numberCell}>{row ? fmtUsdAbbr(row.required_usd) : "—"}</td>
              <td className={numberCell}>{row ? fmtUsdAbbr(row.covered_usd) : "—"}</td>
              <td className={numberCell}>{result?.diagnostics.call_shortfall_usd[call.call_id] == null ? "—" :
                fmtUsdAbbr(result.diagnostics.call_shortfall_usd[call.call_id])}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </Panel>
      <Panel title="Lots · native market values" code="LOTS">
        <div className="max-h-96 overflow-auto"><table className="w-full">
          <thead><tr>{["Lot", "Class", "Currency", "Available", "Current", "Target"].map(x => <th key={x} className={cell}>{x}</th>)}</tr></thead>
          <tbody>{run.snapshot.assets.map(asset => <tr key={asset.asset_id}>
            <td className={cell}>{asset.asset_id}</td><td className={cell}>{asset.asset_class}</td>
            <td className={cell}>{asset.currency}</td>
            <td className={numberCell}>{fmtAbbr(asset.allocatable_value)}</td>
            <td className={numberCell}>{fmtAbbr(current.get(asset.asset_id) ?? 0)}</td>
            <td className={numberCell}>{verified ? fmtAbbr(target.get(asset.asset_id) ?? 0) : "—"}</td>
          </tr>)}</tbody>
        </table></div>
      </Panel>
      <Panel title="Target allocation routes · model output" code="ALLOC">
        {verified && result?.allocations.length ? <div className="max-h-80 overflow-auto"><table className="w-full">
          <thead><tr>{["Lot", "Call", "Market / native", "FX USD/unit", "Haircut", "Covered USD"].map(x => <th key={x} className={cell}>{x}</th>)}</tr></thead>
          <tbody>{result.allocations.map(row => <tr key={row.asset_id + row.call_id}>
            <td className={cell}>{row.asset_id}</td><td className={cell}>{row.call_id}</td>
            <td className={numberCell}>{fmtAbbr(row.market_value)} {row.currency}</td>
            <td className={numberCell}>{run.snapshot.fx.find(q => q.currency === row.currency)?.usd_per_unit ?? "—"}</td>
            <td className={numberCell}>{(row.haircut * 100).toFixed(1)}%</td>
            <td className={numberCell}>{fmtUsdAbbr(row.covered_usd)}</td>
          </tr>)}</tbody>
        </table></div> : <p className="p-3 text-xs">No verified target allocation.</p>}
      </Panel>
      <Panel title="Movements · no execution" code="MOVE">
        {verified && result?.movements.length ? <div className="max-h-80 overflow-auto"><table className="w-full">
          <thead><tr>{["Lot", "Call", "Currency", "Previous", "Target", "Delta"].map(x => <th key={x} className={cell}>{x}</th>)}</tr></thead>
          <tbody>{result.movements.map(row => <tr key={row.asset_id + row.call_id}>
            <td className={cell}>{row.asset_id}</td><td className={cell}>{row.call_id}</td>
            <td className={cell}>{run.snapshot.assets.find(asset => asset.asset_id === row.asset_id)?.currency ?? "—"}</td>
            <td className={numberCell}>{fmtAbbr(row.previous_value)}</td>
            <td className={numberCell}>{fmtAbbr(row.target_value)}</td>
            <td className={numberCell}>{fmtAbbr(row.delta_value)}</td>
          </tr>)}</tbody>
        </table></div> : <p className="p-3 text-xs">No verified movement proposal.</p>}
      </Panel>
      <Panel title="Constraints and diagnostics" code="ROWS">
        <div className="space-y-2 p-3 text-xs text-term-text-dim">
          <p>Minimum supplied liquidity reserve: {fmtUsdAbbr(run.snapshot.minimum_liquidity_reserve_usd)} USD.
            Remaining after target: {result?.residual_liquidity_usd == null ? "Unavailable" : fmtUsdAbbr(result.residual_liquidity_usd)} USD.</p>
          <p>Binding rows: {result?.diagnostics.binding_constraints.join(", ") || "None reported"}.</p>
          <p>Incumbent violations: {result?.diagnostics.incumbent_violations.join(", ") || "None"}.</p>
          <p>Solver: {result?.diagnostics.solver_status} · {result?.diagnostics.message}</p>
          {result?.formulation === "LP" && Object.keys(result.diagnostics.lp_duals_usd_per_unit).length > 0 &&
            <details><summary>Model LP duals (USD per named row unit)</summary>
              <ul>{Object.entries(result.diagnostics.lp_duals_usd_per_unit).map(([key, value]) =>
                <li key={key}>{key}: {value}</li>)}</ul>
            </details>}
          {result?.formulation === "MIP" && <p>LP duals unavailable for MIP.</p>}
        </div>
      </Panel>
    </div>}
  </div>;
}
