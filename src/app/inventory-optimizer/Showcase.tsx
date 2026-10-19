import { useEffect, useState } from "react";
import { Panel, Tag } from "@/components/ui/Panel";
import {
  getIbalShowcaseBooks, runIbalShowcase,
  type IbalCapabilities, type IbalHealth, type IbalResult,
  type IbalShowcaseCatalog, type IbalShowcaseComparison, type IbalShowcaseRun,
} from "@/lib/inventoryOptimizer";

const STEPS = ["base", "shock", "diagnose", "repair", "compare"] as const;
type Step = (typeof STEPS)[number];
const amount = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 6 });

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function DisclosureTable({ title, value }: { title: string; value: unknown }) {
  const items = rows(value);
  if (!items.length) return null;
  const columns = Object.keys(items[0]);
  return <details className="rounded border border-term-border p-2"><summary className="cursor-pointer font-semibold text-term-text">{title} · {items.length}</summary>
    <div className="mt-2 max-h-56 overflow-auto"><table className="w-full min-w-[470px] text-left text-[10px]"><thead><tr>{columns.map((key) => <th key={key} scope="col" className="pr-3 text-term-text-mute">{key.replaceAll("_", " ")}</th>)}</tr></thead>
      <tbody>{items.map((item, index) => <tr key={index} className="border-t border-term-border">{columns.map((key) => <td key={key} className="py-1 pr-3 font-mono text-term-text-dim">{typeof item[key] === "object" ? JSON.stringify(item[key]) : String(item[key] ?? "—")}</td>)}</tr>)}</tbody></table></div>
  </details>;
}

function TrustStrip({ result, commit }: { result: IbalResult | null; commit: string }) {
  if (!result) return null;
  return <dl className="grid gap-x-4 gap-y-1 rounded border border-term-border bg-term-panel-2 p-2 text-[10px] sm:grid-cols-2 xl:grid-cols-3">
    <div><dt className="text-term-text-mute">Solve / verification</dt><dd className="font-mono text-term-text">{result.status} / {result.verification?.passed ? "VERIFIED" : "NOT VERIFIED"}</dd></div>
    <div><dt className="text-term-text-mute">Objective USD</dt><dd className="font-mono text-term-text">{result.verification?.passed && result.status === "optimal" ? amount(result.economics?.total_value_usd) : "No recommendation"}</dd></div>
    <div><dt className="text-term-text-mute">Termination</dt><dd className="font-mono text-term-text">{result.termination_reason ?? result.solver?.termination_reason ?? "—"}</dd></div>
    <div><dt className="text-term-text-mute">Run</dt><dd className="truncate font-mono text-term-text" title={result.run_id}>{result.run_id}</dd></div>
    <div><dt className="text-term-text-mute">Input hash</dt><dd className="truncate font-mono text-term-text" title={result.input_hash}>{result.input_hash}</dd></div>
    <div><dt className="text-term-text-mute">Engine pin</dt><dd className="truncate font-mono text-term-text" title={commit}>{commit}</dd></div>
  </dl>;
}

function BindingRows({ result }: { result: IbalResult | null }) {
  if (!result) return null;
  const binding = result.constraints.filter((row) => Math.abs(row.slack) <= 1e-6).slice(0, 12);
  return <div className="space-y-1 text-[10px]"><h4 className="font-semibold text-term-text">Binding model rows · {binding.length}</h4>
    {binding.length ? <div className="overflow-x-auto"><table className="w-full min-w-[440px]"><thead><tr className="text-left text-term-text-mute"><th scope="col">Constraint</th><th scope="col">Scope</th><th scope="col" className="text-right">Activity</th><th scope="col" className="text-right">Shadow price</th></tr></thead>
      <tbody>{binding.map((row) => <tr key={`${row.row.kind}-${row.row.scope_id}`} className="border-t border-term-border"><td className="py-1">{row.row.kind.replaceAll("_", " ")}</td><td className="font-mono">{row.row.scope_id}</td><td className="text-right font-mono">{amount(row.activity)}</td><td className="text-right font-mono">{row.dual_value == null ? "Unavailable for this formulation" : amount(row.dual_value)}</td></tr>)}</tbody></table></div> : <p className="text-term-text-mute">No binding row is returned for this solve.</p>}
  </div>;
}

function AllocationRows({ result }: { result: IbalResult | null }) {
  if (!result) return null;
  if (result.status === "infeasible" || !result.verification?.passed) return <p className="text-term-down">No verified allocation is available for this step.</p>;
  return <DisclosureTable title="Route allocations" value={result.allocations.map((row) => ({
    route_id: row.route_id, current_shares: row.current_quantity_shares,
    target_shares: row.post_quantity_shares, increase: row.increase_shares, decrease: row.decrease_shares,
  }))} />;
}

function CompareRows({ comparison }: { comparison: IbalShowcaseComparison | null }) {
  if (!comparison) return null;
  return <div className="space-y-2 text-[10px]">
    <p className="text-term-text-dim">Verified comparison: {comparison.verification_passed ? "yes" : "no"} · objective Δ {amount(comparison.objective_delta_usd)} USD. Matched, new and unmatched entities remain separate.</p>
    <DisclosureTable title="Allocation drivers" value={comparison.driver_deltas} />
    <DisclosureTable title="Driver reconciliation" value={comparison.driver_reconciliations} />
    <DisclosureTable title="Economic attribution" value={Array.isArray(comparison.economics_component_deltas)
      ? comparison.economics_component_deltas
      : Object.entries(comparison.economics_component_deltas ?? {}).map(([component, delta_usd]) => ({ component, delta_usd }))} />
  </div>;
}

function DomainDisclosures({ result, capabilities }: { result: IbalResult | null; capabilities: IbalCapabilities | null }) {
  if (!result || !capabilities) return null;
  const agency = result.agency as Record<string, unknown> | null;
  const prime = result.prime as Record<string, unknown> | null;
  return <div className="grid gap-2 sm:grid-cols-2">
    {capabilities.output_sections.includes("agency") && agency && <div className="space-y-2"><h4 className="font-semibold text-term-text">Agency disclosure</h4>
      <DisclosureTable title="Owner economics" value={agency.owners} /><DisclosureTable title="Bound mandates" value={agency.bound_mandates} /><DisclosureTable title="Indemnification" value={agency.indemnification} />
    </div>}
    {capabilities.output_sections.includes("prime") && prime && <div className="space-y-2"><h4 className="font-semibold text-term-text">Prime coverage and flow</h4>
      <DisclosureTable title="Coverage" value={prime.coverage} /><DisclosureTable title="External borrow flow" value={prime.external_borrows} /><DisclosureTable title="Excluded sources" value={prime.excluded_sources} />
    </div>}
  </div>;
}

function EngineDiagnostics({ result, capabilities }: { result: IbalResult | null; capabilities: IbalCapabilities | null }) {
  if (!result || !capabilities) return null;
  return <div className="grid gap-2 text-[10px] sm:grid-cols-2">
    <details className="rounded border border-term-border p-2"><summary className="cursor-pointer font-semibold text-term-text">Solver and formulation</summary>
      <dl className="mt-2 grid grid-cols-2 gap-1 text-term-text-dim">
        <dt>Backend</dt><dd className="font-mono">{result.solver?.backend_name ?? "Unavailable"}</dd>
        <dt>Native status</dt><dd className="font-mono">{result.native_status ?? "—"}</dd>
        <dt>Relative gap</dt><dd className="font-mono">{amount(result.solver?.relative_gap)}</dd>
        <dt>Best bound</dt><dd className="font-mono">{amount(result.solver?.best_bound)}</dd>
        <dt>Formulation</dt><dd className="font-mono">{result.formulation?.variant ?? "—"}</dd>
        <dt>Integer variables</dt><dd className="font-mono">{result.formulation?.integer_variable_count ?? "—"}</dd>
      </dl>
    </details>
    <div className="space-y-2">
      {capabilities.output_sections.includes("economics") && <DisclosureTable title="Economics components" value={result.economics?.components} />}
      <DisclosureTable title="Demand and unfilled flow" value={result.demand} />
      <DisclosureTable title="Availability buffers" value={result.availability_buffers} />
      <DisclosureTable title="Concentration" value={result.concentration} />
      <details className="rounded border border-term-border p-2"><summary className="cursor-pointer font-semibold text-term-text">Sensitivity scope</summary><p className="mt-1 text-term-text-mute">The pinned engine does not return LP ranging for these mixed integer showcase books. Shadow prices appear only when the engine supplies them; an unavailable value is never estimated in the terminal.</p></details>
    </div>
  </div>;
}

export function IbalShowcase({ health, capabilities }: { health: IbalHealth | null; capabilities: IbalCapabilities | null }) {
  const [catalog, setCatalog] = useState<IbalShowcaseCatalog | null>(null);
  const [bookId, setBookId] = useState("principal");
  const [run, setRun] = useState<IbalShowcaseRun | null>(null);
  const [step, setStep] = useState<Step>("base");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = health?.ready && capabilities?.engine_compatible && capabilities.output_sections.includes("showcase");

  useEffect(() => {
    if (!enabled) { setCatalog(null); return; }
    let cancelled = false;
    getIbalShowcaseBooks().then((value) => { if (!cancelled) setCatalog(value); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Showcase catalog unavailable."); });
    return () => { cancelled = true; };
  }, [enabled]);

  async function start() {
    const selectedCatalog = catalog;
    if (!selectedCatalog) return;
    setBusy(true); setError(null); setRun(null); setStep("base");
    try {
      const response = await runIbalShowcase(bookId);
      if (response.engine_commit !== selectedCatalog.engine_commit || response.engine_fingerprint !== selectedCatalog.engine_fingerprint) throw new Error("The showcase response does not match the reviewed engine pin.");
      setRun(response);
      if (!response.report.passed) setError("The pinned showcase did not meet its verified outcome contract. No recommendation is shown.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The showcase service failed."); }
    finally { setBusy(false); }
  }

  const book = catalog?.books.find((item) => item.book_id === bookId);
  const active = run?.report.steps.find((item) => item.step === step);
  const result = step === "base" ? run?.artifacts.base_result : step === "repair" || step === "compare" ? run?.artifacts.repair_result : run?.artifacts.shock_result;
  const comparison = step === "compare" ? run?.artifacts.repair_comparison : step === "shock" ? run?.artifacts.shock_comparison : null;
  const index = STEPS.indexOf(step);

  return <Panel title="Guided InventoryBallast showcase" code="SIM" className="mx-2 mt-2" subtitle="base → shock → diagnose → repair → compare"
    right={<Tag tone={run?.report.passed ? "up" : error ? "down" : "neutral"}>{run?.report.passed ? "VERIFIED SIM" : "LOCAL SIM"}</Tag>}>
    <div className="space-y-3 p-3 text-[11px]">
      <p className="rounded border border-term-amber/30 bg-term-amber/5 p-2 text-term-text-dim">SIMULATED DATA · local service · no live positions, order, or governance gate. The presenter flow uses the pinned engine's checked-in books and named repairs.</p>
      {!enabled && <p role="status" className="text-term-amber">Showcase unavailable: {health?.error_category ?? (health?.ready ? "the pinned service does not advertise showcase output" : "optimizer service is not ready")}. Recheck service health above.</p>}
      {enabled && <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[220px] flex-1 text-term-text-dim">Showcase book
          <select aria-label="Showcase book" value={bookId} onChange={(event) => { setBookId(event.target.value); setRun(null); setStep("base"); }} className="mt-1 w-full rounded border border-term-border bg-term-panel-2 px-2 py-1 text-term-text">
            {(catalog?.books ?? []).map((item) => <option key={item.book_id} value={item.book_id}>{item.title}</option>)}
          </select>
        </label>
        <button type="button" disabled={!catalog || busy} onClick={() => void start()} className="rounded bg-term-amber px-3 py-1.5 font-semibold text-black disabled:opacity-40">{busy ? "Running verified sequence…" : "Start guided run"}</button>
      </div>}
      {book && <p className="text-term-text-mute">{book.behavior} Shock: {book.shock.scenario_type.replaceAll("_", " ")}. Repair: {book.repair.description}.</p>}
      {catalog && <p className="truncate font-mono text-[9px] text-term-text-mute" title={catalog.engine_commit}>Engine {catalog.engine_package_version} · {catalog.engine_commit} · {catalog.provenance.source_version} · G2D/G2E/G3 ungranted</p>}
      {error && <p role="alert" className="rounded border border-term-down/40 bg-term-down/10 p-2 text-term-down">{error}</p>}
      {run && <>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Guided steps">{STEPS.map((item, itemIndex) => <button key={item} type="button" aria-current={item === step ? "step" : undefined} disabled={itemIndex > index + 1 && !run.report.passed} onClick={() => setStep(item)} className={`rounded border px-2 py-1 capitalize ${item === step ? "border-term-amber bg-term-amber/10 text-term-amber" : "border-term-border text-term-text-dim"}`}>{itemIndex + 1}. {item}</button>)}</div>
        <div className="flex items-start justify-between gap-3"><p role="status" className={active?.outcome === "failed" ? "text-term-down" : "text-term-text"}>{active?.headline}</p><button type="button" disabled={index === STEPS.length - 1} onClick={() => setStep(STEPS[index + 1])} className="shrink-0 rounded border border-term-border px-2 py-1 text-term-text disabled:opacity-40">Next →</button></div>
        <TrustStrip result={result ?? null} commit={run.engine_commit} />
        {step === "diagnose" && <div className="grid gap-2 sm:grid-cols-2"><DisclosureTable title="Unfilled demand" value={run.artifacts.diagnosis?.unfilled_demand} /><DisclosureTable title="Excluded sources" value={run.artifacts.diagnosis?.excluded_sources} /><DisclosureTable title="Coverage" value={run.artifacts.diagnosis?.coverage} /><DisclosureTable title="Reason codes" value={Object.entries(run.artifacts.diagnosis?.reason_codes ?? {}).map(([code, count]) => ({ code, count }))} /></div>}
        {(step === "base" || step === "shock" || step === "repair" || step === "diagnose") && <><BindingRows result={result ?? null} /><AllocationRows result={result ?? null} /></>}
        <EngineDiagnostics result={result ?? null} capabilities={capabilities} />
        {comparison && <CompareRows comparison={comparison} />}
        {step === "compare" && <CompareRows comparison={run.artifacts.shock_comparison} />}
        <DomainDisclosures result={result ?? null} capabilities={capabilities} />
        {step === "diagnose" && <details open={result?.status === "infeasible"} className="rounded border border-term-border p-2"><summary className="cursor-pointer font-semibold text-term-text">Infeasibility and sensitivity limits</summary><ul className="mt-1 list-inside list-disc text-term-text-mute">{(run.artifacts.diagnosis?.warnings ?? []).concat(run.artifacts.diagnosis?.not_yet_available ?? []).map((item) => <li key={item}>{item}</li>)}</ul></details>}
      </>}
    </div>
  </Panel>;
}
