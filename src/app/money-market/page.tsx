import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CircleAlert, Layers, Play, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import {
  BASELINES, BASE_SET, DEFAULT_BASELINE, ENTITY_LABELS, MMKT_SCENARIOS, allocationsCsv, blotterCsv, analyzeCurrency, buildBaselineInput,
  buildRunInput, compareToBaseline, dayDiff, demoBook, explainRunError, type BaselineKind, type BaselineOutcome,
  type BookInputs, type MmktRunError, type MmktRunInput, type MmktRunResult, type RateRow,
} from "@/data/mmkt";
import { FloorChart, HoldingsChart, MaturityLadder, YieldBars } from "./components/charts";
import { CutoffTimeline, ExecutionBlotter, LiquidityFrontier, ScenarioPlanDelta, ShadowPrices } from "./components/execution";
import {
  AllocationTable, BaselinePanel, CandidateTable, CsvButton, ForecastTable, Lineage, PolicyEditor, RateTable, ScenarioCompare, SetupGuide,
  VerificationBlock, type CompareRow, type ServiceStatus,
} from "./components/panels";

interface SimSetSummary { sim_set_id: string; label: string; description: string; as_of_date: string; labels: Record<string, string> }
type RateChoice = { source: "sim"; simSetId: string } | { source: "gold" } | null;
interface Snapshot { rows: RateRow[]; hash: string; asOf: string; source: "SIM" | "DB" }
interface RunRecord { input: MmktRunInput; result: MmktRunResult; title: string; book: BookInputs; rows: RateRow[]; choice: NonNullable<RateChoice>; baseline: BaselineOutcome | null }

const fmt = (v: number, dp = 1) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

async function postRun(input: MmktRunInput): Promise<{ result?: MmktRunResult; error?: MmktRunError }> {
  try {
    const response = await fetch("/api/econ/mmkt-runs", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": input.request_id },
      body: JSON.stringify(input),
    });
    const body = await response.json().catch(() => ({ code: "INVALID_RESPONSE", message: `HTTP ${response.status}` }));
    return response.ok ? { result: body as MmktRunResult } : { error: body as MmktRunError };
  } catch {
    return { error: { code: "NETWORK_ERROR", message: "The terminal API could not be reached." } };
  }
}

export default function MoneyMarket() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [simSets, setSimSets] = useState<SimSetSummary[]>([]);
  const [choice, setChoice] = useState<RateChoice>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [book, setBook] = useState<BookInputs>(demoBook);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [runError, setRunError] = useState<MmktRunError | null>(null);
  const [compare, setCompare] = useState<CompareRow[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const [baselineKind, setBaselineKind] = useState<BaselineKind>(DEFAULT_BASELINE);

  const ready = status?.service_health === "READY" && Boolean(status.binding_id);
  const labels = useMemo(() => Object.assign({}, ...simSets.map((s) => s.labels)) as Record<string, string>, [simSets]);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const response = await fetch("/api/econ/mmkt-service", { cache: "no-store" });
      setStatus((await response.json()) as ServiceStatus);
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    fetch("/api/econ/mmkt-rate-snapshot?sets=1").then((r) => r.json()).then((b) => setSimSets(b.sim_sets ?? [])).catch(() => setSimSets([]));
  }, [refreshStatus]);

  // Load the explicitly chosen snapshot. Nothing is loaded until the user picks a source.
  useEffect(() => {
    if (!choice) { setSnapshot(null); return; }
    setSnapshotError(null);
    const url = choice.source === "sim"
      ? `/api/econ/mmkt-rate-snapshot?source=sim&sim_set_id=${encodeURIComponent(choice.simSetId)}`
      : "/api/econ/mmkt-rate-snapshot?source=gold";
    let cancelled = false;
    fetch(url, { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) { setSnapshot(null); setSnapshotError(`${body.code}: ${body.message}`); return; }
        setSnapshot({ rows: body.rate_snapshot.rows, hash: body.rate_snapshot.snapshot_hash, asOf: body.rate_snapshot.as_of_date, source: body.source });
      })
      .catch(() => { if (!cancelled) setSnapshotError("The rate snapshot route could not be reached."); });
    return () => { cancelled = true; };
  }, [choice]);

  const inputFor = useCallback((b: BookInputs, rows: RateRow[], c: NonNullable<RateChoice>): MmktRunInput => {
    const base = buildRunInput(b, rows, c.source === "sim" ? c.simSetId : "", crypto.randomUUID());
    return c.source === "sim" ? base : { ...base, rate_source: "gold", sim_set_id: undefined };
  }, []);

  /** Run the selected baseline as its own verified service request and compare it. */
  const runBaseline = useCallback(async (kind: BaselineKind, b: BookInputs, rows: RateRow[], c: NonNullable<RateChoice>, optimized: { input: MmktRunInput; result: MmktRunResult }): Promise<BaselineOutcome> => {
    const built = buildBaselineInput(kind, b, rows, c.source === "sim" ? c.simSetId : "", crypto.randomUUID());
    if ("unavailable" in built) return { kind, status: "unavailable", reason: built.unavailable };
    const selected = c.source === "sim" ? built.input : { ...built.input, rate_source: "gold" as const, sim_set_id: undefined };
    const input = { ...selected, policy: { ...selected.policy, frontier_multipliers: [] } };
    const { result, error } = await postRun(input);
    if (!result) return { kind, status: "error", reason: error ? `${explainRunError(error).title} (${error.code})` : "Baseline run failed." };
    const comparison = compareToBaseline(
      analyzeCurrency(optimized.result.currency_results[0], optimized.input),
      analyzeCurrency(result.currency_results[0], input),
      dayDiff(input.horizon.start_date, input.horizon.end_date),
    );
    return { kind, status: "ok", input, result, comparison };
  }, []);

  const runNow = useCallback(async (b: BookInputs, c: NonNullable<RateChoice>, rows: RateRow[], title: string) => {
    setRunning(true);
    setRunError(null);
    const input = inputFor(b, rows, c);
    const { result, error } = await postRun(input);
    if (result) {
      const baseline = await runBaseline(baselineKind, b, rows, c, { input, result });
      setRun({ input, result, title, book: b, rows, choice: c, baseline });
    } else { setRun(null); setRunError(error ?? null); }
    setRunning(false);
  }, [inputFor, runBaseline, baselineKind]);

  async function changeBaseline(kind: BaselineKind) {
    setBaselineKind(kind);
    if (!run) return;
    setRun({ ...run, baseline: null });
    const baseline = await runBaseline(kind, run.book, run.rows, run.choice, run);
    setRun((current) => (current && current.result.run.run_id === run.result.run.run_id ? { ...current, baseline } : current));
  }

  async function selectScenario(id: string) {
    const scenario = MMKT_SCENARIOS.find((s) => s.id === id)!;
    const nextBook = scenario.apply(demoBook());
    const nextChoice = { source: "sim" as const, simSetId: scenario.simSetId };
    setScenarioId(id);
    setBook(nextBook);
    setChoice(nextChoice);
    if (!ready || (nextBook.policy.execution_mode === "ticketed_plan" && status?.binding_id !== "local-mmkt-execution-v2")) return;
    const response = await fetch(`/api/econ/mmkt-rate-snapshot?source=sim&sim_set_id=${scenario.simSetId}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (response?.ok) await runNow(nextBook, nextChoice, response.rate_snapshot.rows, scenario.title);
  }

  async function runAllScenarios() {
    if (!ready || !ticketedAvailable) return;
    setComparing(true);
    const rows: CompareRow[] = [];
    for (const scenario of MMKT_SCENARIOS) {
      const snap = await fetch(`/api/econ/mmkt-rate-snapshot?source=sim&sim_set_id=${scenario.simSetId}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if (!snap?.ok) { rows.push({ id: scenario.id, title: scenario.title, analytics: null, error: "Rate set unavailable", hash: null, simSetId: scenario.simSetId, baseline: null }); continue; }
      const scenarioBook = scenario.apply(demoBook());
      const scenarioChoice = { source: "sim" as const, simSetId: scenario.simSetId };
      const selected = inputFor(scenarioBook, snap.rate_snapshot.rows, scenarioChoice);
      const input = { ...selected, policy: { ...selected.policy, frontier_multipliers: [] } };
      const { result, error } = await postRun(input);
      const baseline = result ? await runBaseline(baselineKind, scenarioBook, snap.rate_snapshot.rows, scenarioChoice, { input, result }) : null;
      rows.push({
        id: scenario.id, title: scenario.title, simSetId: scenario.simSetId,
        analytics: result ? analyzeCurrency(result.currency_results[0], input) : null,
        error: error ? explainRunError(error).title : null,
        hash: result?.run.request_hash ?? null,
        result: result ?? null,
        baseline: baseline?.status === "ok" ? { upliftMm: baseline.comparison.upliftMm, upliftBps: baseline.comparison.upliftBps } : baseline ? { reason: baseline.reason } : null,
      });
      setCompare([...rows]);
    }
    setComparing(false);
  }

  const analytics = run ? run.result.currency_results.map((cr) => analyzeCurrency(cr, run.input)) : [];
  const primary = analytics[0] ?? null;
  const types = useMemo(() => new Map(book.candidates.map((c) => [c.candidate_id, c.instrument_type as string])), [book]);
  const sourceLabel = choice?.source === "gold" ? "Gold" : choice ? `SIM · ${choice.simSetId}` : "No rate source selected";
  const ticketedAvailable = status?.binding_id === "local-mmkt-execution-v2";
  const canRun = ready && (book.policy.execution_mode !== "ticketed_plan" || ticketedAvailable) && choice !== null && snapshot !== null && !running;

  return (
    <div className="flex min-h-full flex-col bg-term-bg">
      <PageHeader code="MMKT" title="Money Market Optimizer" desc="Forecast cash deployment · verified ticketed plan (spec011)" showStreaming={false}
        right={<span className="flex items-center gap-2">
          {choice?.source === "gold" && snapshot ? <ProvenanceBadge source="DB" asOf={snapshot.asOf} /> : choice ? <Tag tone="blue">SIM</Tag> : null}
          <Tag tone={ready ? "up" : "amber"}>{statusLoading ? "CHECKING" : ready ? "MODEL READY" : status?.service_health ?? "OFFLINE"}</Tag>
        </span>} />

      <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-3 p-3 lg:p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-term-amber/30 bg-term-amber/5 px-3 py-2 text-[11px] text-term-text-dim" role="note">
          <span className="rounded-sm border border-term-amber/40 px-1.5 py-px font-mono text-[9px] font-bold tracking-[0.2em] text-term-amber">{book.policy.execution_mode === "ticketed_plan" ? "TICKETED PLAN" : "LP PREVIEW"}</span>
          <span>{book.policy.execution_mode === "ticketed_plan" ? "The MMKT service enforces ticket, lot, count, and cutoff rules and independently verifies the resulting plan." : "The continuous LP does not enforce execution rules."} Cash forecasts and policy are illustrative inputs. The plan is for human review; no order is routed or live trade recommendation made.</span>
        </div>

        {/* Engine + rate source */}
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Panel title="Model service" code="ENGINE" className="rounded-lg"
            right={<button type="button" onClick={() => void refreshStatus()} disabled={statusLoading} className="flex items-center gap-1 rounded border border-term-border px-1.5 py-0.5 text-[10px] text-term-text-dim hover:text-term-amber disabled:opacity-50"><RefreshCw size={11} /> Recheck</button>}>
            <div className="space-y-3 p-3">
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                <dt className="text-term-text-mute">Health</dt><dd className="text-right font-mono text-term-text">{status?.service_health ?? "—"}</dd>
                <dt className="text-term-text-mute">Binding</dt><dd className="text-right font-mono text-term-text">{status?.binding_id ?? "none"}</dd>
                <dt className="text-term-text-mute">Model</dt><dd className="text-right font-mono text-term-text">{status?.model_status?.replace(/_/g, " ") ?? "—"}</dd>
                <dt className="text-term-text-mute">Contract</dt><dd className="text-right font-mono text-term-text">{status?.api_schema_version ?? "—"}</dd>
                <dt className="text-term-text-mute">Terminal token</dt><dd className="text-right font-mono text-term-text">{status?.token_configured ? "configured" : "missing"}</dd>
              </dl>
              <p className="text-[10px] leading-relaxed text-term-text-dim">{status?.detail ?? "Checking the MMKT service…"}</p>
              {(!ready || (book.policy.execution_mode === "ticketed_plan" && !ticketedAvailable)) && !statusLoading && <SetupGuide status={status} />}
            </div>
          </Panel>

          <Panel title="Rate source" code="RATES" className="rounded-lg" subtitle={snapshot ? `as of ${snapshot.asOf} · ${snapshot.hash.slice(0, 12)}…` : undefined}>
            <div className="space-y-3 p-3">
              <p className="text-[10px] leading-relaxed text-term-text-mute">Choose a rate source explicitly. SIM is never selected silently and never stands in for Gold. Selecting a scenario below also selects its labelled SIM set.</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Rate source">
                <SourceButton active={choice?.source === "gold"} onClick={() => { setScenarioId(null); setChoice({ source: "gold" }); }} title="Gold · MacroMedallion" sub="gold.mmkt_rate_snapshot" />
                {simSets.map((s) => (
                  <SourceButton key={s.sim_set_id} active={choice?.source === "sim" && choice.simSetId === s.sim_set_id}
                    onClick={() => { setScenarioId(null); setChoice({ source: "sim", simSetId: s.sim_set_id }); }} title={s.label} sub={s.sim_set_id} sim />
                ))}
              </div>
              {snapshotError && <div role="alert" className="flex gap-2 rounded-md border border-term-down/40 bg-term-down/5 px-2.5 py-2 text-[10px] text-term-down"><CircleAlert size={13} className="shrink-0" />{snapshotError}{choice?.source === "gold" ? " Gold MMKT rates are not wired upstream yet (handoff XR-3). Use a named SIM set." : ""}</div>}
              {snapshot && (
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                  <RateTable rows={snapshot.rows} labels={labels} sourceTag={snapshot.source} />
                  <div>
                    <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-term-text-mute">Normalized curve (priced rows)</div>
                    <YieldBars rows={snapshot.rows} labels={labels} />
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </div>

        {/* Scenarios */}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" role="radiogroup" aria-label="Scenario">
          {MMKT_SCENARIOS.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={scenarioId === s.id} onClick={() => void selectScenario(s.id)}
              className={`rounded-lg border p-3 text-left transition ${scenarioId === s.id ? "border-term-amber/60 bg-term-amber/[0.07] shadow-glow" : "border-term-border bg-term-panel hover:border-term-text-mute"}`}>
              <div className="flex items-center justify-between">
                <span className={`text-[9px] font-semibold uppercase tracking-[0.18em] ${scenarioId === s.id ? "text-term-amber" : "text-term-text-mute"}`}>{s.kicker}</span>
                <span className="font-mono text-[9px] text-term-cyan">{s.simSetId === BASE_SET ? "SIM base" : "SIM cut"}</span>
              </div>
              <div className="mt-1 text-[13px] font-semibold text-term-text">{s.title}</div>
              <p className="mt-1 line-clamp-3 text-[10px] leading-snug text-term-text-dim">{s.narrative}</p>
            </button>
          ))}
        </div>

        {/* Inputs */}
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Panel title="Instrument universe" code="CANDIDATES" className="rounded-lg" subtitle="illustrative · USD $mm"
            right={<button type="button" onClick={() => { setBook(demoBook()); setScenarioId(null); }} className="flex items-center gap-1 rounded border border-term-border px-1.5 py-0.5 text-[10px] text-term-text-dim hover:text-term-amber"><RotateCcw size={11} /> Reset inputs</button>}>
            <div className="space-y-3 p-3">
              <CandidateTable book={book} rates={snapshot?.rows ?? null} onChange={(b) => { setBook(b); setScenarioId(null); }} />
              <ForecastTable book={book} />
            </div>
          </Panel>
          <Panel title="Policy" code="POLICY" className="rounded-lg">
            <div className="space-y-3 p-3">
              <PolicyEditor book={book} onChange={(b) => { setBook(b); setScenarioId(null); }} />
              <div className="text-[10px]">
                <label htmlFor="mmkt-baseline" className="mb-1 block text-term-text-dim">Baseline for comparison</label>
                <select id="mmkt-baseline" value={baselineKind} onChange={(e) => void changeBaseline(e.target.value as BaselineKind)}
                  className="w-full rounded border border-term-border bg-term-panel-2 px-2 py-1 text-[11px] text-term-text outline-none focus:border-term-amber/60">
                  {BASELINES.map((b) => <option key={b.id} value={b.id}>{b.label}{b.id === DEFAULT_BASELINE ? " (default)" : ""}{b.id === "current_allocation" ? " — needs positions feed" : ""}</option>)}
                </select>
                <p className="mt-1 text-term-text-mute">{BASELINES.find((b) => b.id === baselineKind)!.description}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-term-border pt-3">
                <button type="button" disabled={!canRun} onClick={() => choice && snapshot && void runNow(book, choice, snapshot.rows, scenarioId ? MMKT_SCENARIOS.find((s) => s.id === scenarioId)!.title : "Custom inputs")}
                  className="flex items-center gap-1.5 rounded-md bg-term-amber px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-[#ffa329] disabled:cursor-not-allowed disabled:opacity-40">
                  <Play size={13} /> {running ? "Solving…" : "Run optimizer"}
                </button>
                <span className="text-[10px] text-term-text-mute">{!ready ? "Service not ready" : book.policy.execution_mode === "ticketed_plan" && !ticketedAvailable ? "Ticketed model needs local-mmkt-execution-v2" : !choice ? "Select a rate source" : !snapshot ? "Loading rates…" : sourceLabel}</span>
              </div>
            </div>
          </Panel>
        </div>

        {runError && <RunErrorPanel error={runError} />}

        {/* Results */}
        {run && primary && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-term-text">Result · {run.title} <span className="font-normal text-term-text-mute">· {run.result.run.rate_source === "sim" ? `SIM ${run.result.run.sim_set_id}` : "Gold"} · {run.result.run.cash_forecast_case}</span></h2>
              <span className="font-mono text-[10px] text-term-text-mute">run {run.result.run.run_id.slice(0, 8)} · request {run.result.run.request_hash.slice(0, 12)}…</span>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
              <Kpi label="Modeled net return" value={`$${fmt(primary.objective * 1000, 1)}k`} sub="over the horizon (10 business days)" tone="amber" />
              <Kpi label="Annualized on invested" value={`${primary.annualizedReturnPct.toFixed(3)}%`} sub={`avg invested $${fmt(primary.avgInvested, 0)}mm`} />
              <Kpi label="Uplift vs baseline"
                value={run.baseline?.status === "ok" ? `${run.baseline.comparison.upliftMm >= 0 ? "+" : "−"}$${fmt(Math.abs(run.baseline.comparison.upliftMm) * 1000, 1)}k` : run.baseline ? "—" : "…"}
                sub={run.baseline?.status === "ok" ? `${run.baseline.comparison.upliftBps.toFixed(1)}bp · ${BASELINES.find((b) => b.id === run.baseline!.kind)!.label}` : run.baseline ? "baseline not computed" : "running baseline"}
                tone={run.baseline?.status === "ok" ? "up" : undefined} />
              <Kpi label="Held past horizon" value={`$${fmt(primary.heldAtEnd, 0)}mm`} sub="see maturity ladder" />
              <Kpi label="Min floor headroom" value={primary.minHeadroom === null ? "—" : `$${fmt(primary.minHeadroom, 1)}mm`} sub={`${primary.floorHeadroom.filter((f) => f.headroom < 1e-6).length} entity-days at floor`} tone={primary.minHeadroom !== null && primary.minHeadroom < -1e-6 ? "down" : undefined} />
              <Kpi label="Verification" value="Passed" sub={`row Δ ${run.result.currency_results[0].verification.max_row_violation.toExponential(1)}`} tone="up" icon={<ShieldCheck size={13} />} />
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <Panel title="Balance composition by day" code="HOLDINGS" accent className="rounded-lg" subtitle="$mm · holdings by family + uninvested cash">
                <div className="p-3"><HoldingsChart analytics={primary} /></div>
              </Panel>
              <Panel title="Liquidity floors" code="FLOORS" className="rounded-lg">
                <div className="space-y-3 p-3">
                  {Object.entries(ENTITY_LABELS).map(([id, label]) => <FloorChart key={id} analytics={primary} entity={id} label={label} />)}
                </div>
              </Panel>
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <Panel title={run.result.execution_ready ? "Verified execution blotter" : "LP allocation · continuous preview"} code="ALLOC" className="rounded-lg" subtitle={run.result.execution_ready ? "indicative order · no routing" : "not an execution blotter"}
                right={<CsvButton csv={run.result.execution_ready ? blotterCsv(run.result) : allocationsCsv(run.result)} filename={`mmkt-${run.result.run.run_id.slice(0, 8)}.csv`} />}>
                <div className="max-h-[420px] overflow-y-auto p-3">{run.result.execution_ready ? <ExecutionBlotter result={run.result} /> : <AllocationTable result={run.result} types={types} />}</div>
              </Panel>
              <div className="flex flex-col gap-3">
                <Panel title="Maturity ladder" code="LADDER" className="rounded-lg"><div className="p-3"><MaturityLadder analytics={primary} /></div></Panel>
                <Panel title="Verification" code="CERT" className="rounded-lg"><div className="p-3"><VerificationBlock result={run.result} /></div></Panel>
                <Panel title="Lineage" code="RUN" className="rounded-lg"><div className="p-3"><Lineage result={run.result} /></div></Panel>
              </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-3">
              <Panel title="Cutoff timeline" code="CUTOFF" className="rounded-lg"><div className="p-3"><CutoffTimeline result={run.result} /></div></Panel>
              <Panel title="Shadow prices" code="DUALS" className="rounded-lg"><div className="p-3"><ShadowPrices result={run.result} /></div></Panel>
              <Panel title="Yield / liquidity frontier" code="FRONTIER" className="rounded-lg"><div className="p-3"><LiquidityFrontier result={run.result} /></div></Panel>
            </div>

            <Panel title="Baseline comparison" code="BASE" className="rounded-lg" subtitle="each side is its own verified run">
              <div className="p-3"><BaselinePanel optimized={primary} baseline={run.baseline} optimizedHash={run.result.run.request_hash} /></div>
            </Panel>

            <Panel title="Model assumptions (returned with this run)" code="ASSUME" className="rounded-lg">
              <ul className="grid gap-x-6 gap-y-1 p-3 text-[10px] leading-relaxed text-term-text-dim md:grid-cols-2">
                {run.result.assumptions.map((a) => <li key={a} className="flex gap-1.5"><span className="text-term-amber">·</span>{a}</li>)}
              </ul>
            </Panel>
          </>
        )}

        <Panel title="Scenario comparison" code="CMP" className="rounded-lg" subtitle="each scenario is a separate verified run"
          right={<button type="button" disabled={!ready || !ticketedAvailable || comparing} onClick={() => void runAllScenarios()} className="flex items-center gap-1 rounded border border-term-border px-1.5 py-0.5 text-[10px] text-term-text-dim hover:text-term-amber disabled:opacity-40"><Layers size={11} /> {comparing ? "Running…" : "Run all scenarios"}</button>}>
          <div className="p-3">
            {compare ? <ScenarioCompare rows={compare} activeId={scenarioId} /> : <p className="text-[11px] text-term-text-mute">{ready ? "Run every named scenario against the service to compare modeled return, invested balance and mix." : "Available once the model service is ready."}</p>}
          </div>
        </Panel>
        {compare && <Panel title="Base → rate cut → forecast miss" code="IMPACT" className="rounded-lg" subtitle="verified plan and liquidity changes">
          <div className="p-3"><ScenarioPlanDelta rows={compare} /></div>
        </Panel>}
      </div>
    </div>
  );
}

function SourceButton({ active, onClick, title, sub, sim }: { active: boolean; onClick: () => void; title: string; sub: string; sim?: boolean }) {
  return (
    <button type="button" role="radio" aria-checked={active} onClick={onClick}
      className={`rounded-md border px-2.5 py-1.5 text-left transition ${active ? "border-term-amber/60 bg-term-amber/10" : "border-term-border bg-term-panel-2 hover:border-term-text-mute"}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-term-text">{sim && <span className="rounded-sm border border-term-cyan/40 px-1 font-mono text-[8px] font-bold text-term-cyan">SIM</span>}{title}</div>
      <div className="font-mono text-[9px] text-term-text-mute">{sub}</div>
    </button>
  );
}

function RunErrorPanel({ error }: { error: MmktRunError }) {
  const { title, fix } = explainRunError(error);
  const issues = Array.isArray(error.issues) ? (error.issues as { location: string; code: string }[]) : [];
  const gate = error.pricing_gate as { issues?: { instrument_id: string; code: string }[] } | undefined;
  return (
    <div role="alert" className="flex gap-3 rounded-lg border border-term-down/40 bg-term-down/[0.06] p-4">
      <CircleAlert size={20} className="shrink-0 text-term-down" />
      <div className="min-w-0 space-y-1 text-[11px]">
        <div className="text-sm font-semibold text-term-text">{title}</div>
        <div className="text-term-text-dim">{fix}</div>
        <div className="font-mono text-[10px] text-term-text-mute">{error.code}{error.message ? ` · ${String(error.message)}` : ""}</div>
        {issues.length > 0 && <ul className="font-mono text-[10px] text-term-text-mute">{issues.slice(0, 6).map((i) => <li key={`${i.location}-${i.code}`}>{i.location}: {i.code}</li>)}</ul>}
        {gate?.issues?.length ? <ul className="font-mono text-[10px] text-term-text-mute">{gate.issues.slice(0, 6).map((i) => <li key={i.instrument_id}>{i.instrument_id}: {i.code}</li>)}</ul> : null}
        <div className="text-[10px] text-term-text-mute">No allocation is shown for a failed run.</div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone, icon }: { label: string; value: string; sub: string; tone?: "amber" | "up" | "down"; icon?: ReactNode }) {
  const color = tone === "amber" ? "text-term-amber" : tone === "up" ? "text-term-up" : tone === "down" ? "text-term-down" : "text-term-text";
  return (
    <div className="rounded-lg border border-term-border bg-term-panel px-3 py-2.5">
      <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-term-text-mute">{label}</div>
      <div className={`mt-1 flex items-center gap-1.5 font-mono text-lg font-semibold tabular-nums leading-tight ${color}`}>{icon}{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-term-text-mute">{sub}</div>
    </div>
  );
}
