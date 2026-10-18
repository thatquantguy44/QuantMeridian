import { useMemo, useState, type ReactNode } from "react";
import { CircleAlert, Copy, RotateCcw, ShieldCheck, Sigma, Table2 } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import {
  FAMILY_META, NEUTRAL_KNOBS, SCENARIOS, applyKnobs, solveSim, verifySim,
  type SimProblem, type SourceFamily, type StressKnobs,
} from "@/data/sourcesUsesSynthetic";
import { bps, mm, num, pct, signed } from "./format";
import { FamilyMix, ScenarioComparison, SourceUtilization, TierLadder, UseCoverage, VerificationList } from "./ShowcaseCharts";
import { TransportNetwork } from "./TransportNetwork";
import { TransportTableau } from "./TransportTableau";

export function SyntheticShowcase({ onCopyToWorkspace }: { onCopyToWorkspace: (problem: SimProblem, scenarioTitle: string) => void }) {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [knobs, setKnobs] = useState<StressKnobs>(NEUTRAL_KNOBS);
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;

  const scenarioProblem = useMemo(() => scenario.build(), [scenario]);
  const problem = useMemo(() => applyKnobs(scenarioProblem, knobs), [scenarioProblem, knobs]);
  const result = useMemo(() => solveSim(problem), [problem]);
  const checks = useMemo(() => (result.status === "optimal" ? verifySim(result) : []), [result]);
  const certified = result.status === "optimal" && checks.every((c) => c.passed);

  const baseline = useMemo(() => solveSim(SCENARIOS[0].build()), []);
  const scenarioResults = useMemo(() => Object.fromEntries(SCENARIOS.map((s) => [s.id, solveSim(s.build())])), []);
  const knobsActive = JSON.stringify(knobs) !== JSON.stringify(NEUTRAL_KNOBS);

  const selectScenario = (id: string) => { setScenarioId(id); setKnobs(NEUTRAL_KNOBS); };
  const toggleLane = (key: string) => setKnobs((k) => ({
    ...k, deniedLanes: k.deniedLanes.includes(key) ? k.deniedLanes.filter((x) => x !== key) : [...k.deniedLanes, key],
  }));

  const baseCost = baseline.status === "optimal" ? baseline.totals.annualCostMm : 0;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-3 p-3 lg:p-5">
      {/* SIM banner */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-term-cyan/25 bg-term-cyan/5 px-3 py-2 text-[11px] text-term-text-dim" role="note">
        <span className="rounded-sm border border-term-cyan/40 px-1.5 py-px font-mono text-[9px] font-bold tracking-[0.2em] text-term-cyan">SIM</span>
        <span>A synthetic, hand-built broker-dealer funding book (USD, $mm). It shows how the model behaves. It is not a funding recommendation and uses no live or customer data.</span>
        <span className="ml-auto text-[10px] text-term-text-mute">spec012 · SU-SIM</span>
      </div>

      {/* Scenario rail */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" role="radiogroup" aria-label="Scenario">
        {SCENARIOS.map((s) => {
          const r = scenarioResults[s.id];
          const active = s.id === scenarioId;
          return (
            <button key={s.id} type="button" role="radio" aria-checked={active} onClick={() => selectScenario(s.id)}
              className={`group rounded-lg border p-3 text-left transition ${active ? "border-term-amber/60 bg-term-amber/[0.07] shadow-glow" : "border-term-border bg-term-panel hover:border-term-text-mute"}`}>
              <div className="flex items-center justify-between">
                <span className={`text-[9px] font-semibold uppercase tracking-[0.18em] ${active ? "text-term-amber" : "text-term-text-mute"}`}>{s.kicker}</span>
                {r.status === "optimal"
                  ? <span className="font-mono text-[9px] text-term-text-mute">{pct(r.totals.coveragePct, 0)}</span>
                  : <span className="flex items-center gap-0.5 text-[9px] font-semibold text-term-down"><CircleAlert size={10} /> INFEASIBLE</span>}
              </div>
              <div className="mt-1 text-[13px] font-semibold text-term-text">{s.title}</div>
              <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-term-text-dim">{s.narrative}</p>
            </button>
          );
        })}
      </div>

      {/* KPI strip */}
      {result.status === "optimal" ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Annual carry" value={mm(result.totals.annualCostMm, 2)} sub={scenarioId === "base" && !knobsActive ? "baseline" : `${signed(result.totals.annualCostMm - baseCost, (v) => mm(v, 2))} vs base`} tone="amber" />
          <Kpi label="Weighted cost" value={bps(result.totals.weightedCostBps, 1)} sub={`on ${mm(result.totals.nominal, 0)} nominal`} />
          <Kpi label="Coverage" value={pct(result.totals.coveragePct)} sub={`${mm(result.totals.coverage, 0)} of ${mm(result.totals.demand, 0)}`} tone={result.totals.shortfall > 1e-6 ? undefined : "up"} />
          <Kpi label="Soft shortfall" value={mm(result.totals.shortfall, 1)} sub={result.totals.shortfall > 1e-6 ? "priced at use penalty" : "every use whole"} tone={result.totals.shortfall > 1e-6 ? "down" : undefined} />
          <Kpi label="Haircut drag" value={mm(result.totals.haircutDrag, 1)} sub="nominal − coverage" />
          <Kpi label="Optimality" value={certified ? "Certified" : "Check failed"} sub={`${result.stats.pivots} pivots · ${num(result.stats.millis, 1)}ms`} tone={certified ? "up" : "down"} icon={<ShieldCheck size={13} />} />
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-term-down/40 bg-term-down/[0.06] p-4 md:flex-row md:items-center" role="alert">
          <CircleAlert size={22} className="shrink-0 text-term-down" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-term-text">Infeasible: hard obligations exceed every eligible dollar by {mm(result.totalGap)}.</div>
            <p className="mt-0.5 text-[11px] text-term-text-dim">
              Elastic diagnostic (not a solution): {result.shortUses.map((u) => `${problem.uses.find((x) => x.id === u.useId)?.label} short ${mm(u.gap)}`).join("; ")}.
              {" "}Exhausted sources: {result.exhaustedSources.map((id) => problem.sources.find((s) => s.id === id)?.short).join(", ") || "none"}. No allocation is shown.
            </p>
          </div>
        </div>
      )}

      {/* Network + controls */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Transport network" code="FLOW" accent className="rounded-lg" subtitle="ribbon width = $; taper = haircut"
          right={<Legend />}>
          <div className="p-2 md:p-3">
            <TransportNetwork problem={problem} result={result} />
          </div>
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel title="Stress controls" code="LIVE" className="rounded-lg"
            right={knobsActive ? <button type="button" onClick={() => setKnobs(NEUTRAL_KNOBS)} className="flex items-center gap-1 rounded border border-term-border px-1.5 py-0.5 text-[10px] text-term-text-dim hover:text-term-amber"><RotateCcw size={11} /> Reset</button> : undefined}>
            <div className="space-y-3 p-3">
              <p className="text-[10px] leading-relaxed text-term-text-mute">Layered on “{scenario.title}”. Every change re-solves all {result.stats.stages} stages in the browser.</p>
              {(Object.keys(FAMILY_META) as SourceFamily[]).map((family) => (
                <Slider key={family} id={`cap-${family}`} label={`${FAMILY_META[family].label} capacity`} swatch={FAMILY_META[family].color}
                  min={0} max={1.5} step={0.05} value={knobs.capacity[family]} format={(v) => `${num(v * 100, 0)}%`}
                  onChange={(v) => setKnobs((k) => ({ ...k, capacity: { ...k.capacity, [family]: v } }))} />
              ))}
              <Slider id="haircut" label="Haircut shift (secured + SBL)" min={0} max={20} step={0.5} value={knobs.haircutShiftPp} format={(v) => `+${num(v, 1)}pp`}
                onChange={(v) => setKnobs((k) => ({ ...k, haircutShiftPp: v }))} />
              <Slider id="demand" label="Demand scale (all uses)" min={0.6} max={1.4} step={0.02} value={knobs.demandScale} format={(v) => `${num(v * 100, 0)}%`}
                onChange={(v) => setKnobs((k) => ({ ...k, demandScale: v }))} />
              <Slider id="unsecured" label="Unsecured cost shift" min={-50} max={300} step={5} value={knobs.unsecuredCostShiftBps} format={(v) => signed(v, (x) => `${num(x, 0)}bp`)}
                onChange={(v) => setKnobs((k) => ({ ...k, unsecuredCostShiftBps: v }))} />
              {knobs.deniedLanes.length > 0 && (
                <div className="rounded-md border border-term-border bg-term-panel-2 px-2 py-1.5 text-[10px] text-term-text-dim">
                  {knobs.deniedLanes.length} lane{knobs.deniedLanes.length === 1 ? "" : "s"} switched off in the tableau: <span className="font-mono text-term-text">{knobs.deniedLanes.join(", ").replace(/>/g, "→")}</span>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Solve sequence" code="LEX" className="rounded-lg">
            <div className="p-3">
              {result.status === "optimal" ? <TierLadder result={result} /> : <p className="text-[11px] text-term-down">Stage 1 is infeasible. The hard coverage rows cannot all hold.</p>}
              <p className="mt-2 text-[10px] leading-relaxed text-term-text-mute">Tiers are solved in order and each optimum is then fixed. A lower tier can never outbid a higher one, however large its penalty.</p>
            </div>
          </Panel>

          {result.status === "optimal" && (
            <Panel title="Funding mix" code="MIX" className="rounded-lg">
              <div className="p-3"><FamilyMix result={result} /></div>
            </Panel>
          )}
        </div>
      </div>

      {/* Tableau */}
      <Panel title="Transportation tableau" code="MODI" className="rounded-lg" subtitle="flows $mm · duals bp" right={<span className="flex items-center gap-1 text-[10px] text-term-text-mute"><Table2 size={12} /> click a cell to deny / allow</span>}>
        <div className="p-3">
          <TransportTableau problem={problem} baseLanes={scenarioProblem.lanes} deniedLanes={knobs.deniedLanes} result={result} onToggle={toggleLane} />
        </div>
      </Panel>

      {/* Diagnostics */}
      {result.status === "optimal" && (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          <Panel title="Source utilisation & shadow price" code="CAP" className="rounded-lg" right={<span className="text-[9px] text-term-text-mute">uᵢ bp</span>}>
            <div className="p-3">
              <SourceUtilization result={result} />
              <p className="mt-3 border-t border-term-border pt-2 text-[10px] leading-relaxed text-term-text-mute">
                The shadow price is the annual saving, in bp, from one more dollar of that source. Exhausted cheap sources carry the highest price. These are final-stage LP duals, conditional on the fixed tier levels (SIM-006).
              </p>
            </div>
          </Panel>
          <Panel title="Use coverage by tier" code="COV" className="rounded-lg">
            <div className="p-3"><UseCoverage result={result} /></div>
          </Panel>
          <Panel title="Marginal cost of coverage" code="vⱼ" className="rounded-lg">
            <div className="p-3"><MarginalCost problem={problem} useDual={result.useDualBps} /></div>
          </Panel>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Scenario comparison" code="CMP" className="rounded-lg" subtitle="preset scenarios, no stress controls">
          <div className="p-3"><ScenarioComparison scenarios={SCENARIOS} results={scenarioResults} activeId={scenarioId} onSelect={selectScenario} /></div>
        </Panel>
        <Panel title="Independent verification" code="CERT" className="rounded-lg" right={result.status === "optimal" ? <span className={`text-[10px] font-semibold ${certified ? "text-term-up" : "text-term-down"}`}>{checks.filter((c) => c.passed).length}/{checks.length}</span> : undefined}>
          <div className="p-3">
            {result.status === "optimal" ? <VerificationList checks={checks} /> : <p className="text-[11px] leading-relaxed text-term-text-dim">There is no candidate solution to verify. The elastic diagnostic is reported above and is never shown as a plan.</p>}
          </div>
        </Panel>
        <Panel title="Formulation disclosure" code="LP" className="rounded-lg">
          <Formulation problem={problem} stats={result.stats} infeasible={result.status === "infeasible"} />
        </Panel>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-term-border bg-term-panel px-3 py-2.5">
        <p className="text-[10px] text-term-text-mute">Copy this book, including your stress settings, into the workspace as an editable configuration. Copying does not enable solving there.</p>
        <button type="button" onClick={() => onCopyToWorkspace(problem, `${scenario.title}${knobsActive ? " (stressed)" : ""}`)}
          className="flex items-center gap-1.5 rounded-md border border-term-border bg-term-panel-2 px-3 py-1.5 text-xs text-term-text transition hover:border-term-amber/60 hover:text-term-amber">
          <Copy size={13} /> Copy to workspace
        </button>
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

function Slider({ id, label, min, max, step, value, format, onChange, swatch }: {
  id: string; label: string; min: number; max: number; step: number; value: number;
  format: (v: number) => string; onChange: (v: number) => void; swatch?: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px]">
        <label htmlFor={`sxu-${id}`} className="flex items-center gap-1.5 text-term-text-dim">
          {swatch && <span className="h-2 w-2 rounded-sm" style={{ background: swatch }} aria-hidden />}{label}
        </label>
        <span className="font-mono text-term-text">{format(value)}</span>
      </div>
      <input id={`sxu-${id}`} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-term-panel-3 accent-term-amber" />
    </div>
  );
}

function Legend() {
  return (
    <span className="hidden items-center gap-2.5 text-[9px] text-term-text-mute md:flex">
      {(Object.keys(FAMILY_META) as SourceFamily[]).map((f) => (
        <span key={f} className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: FAMILY_META[f].color }} />{FAMILY_META[f].label}</span>
      ))}
      <span className="flex items-center gap-1"><span className="w-3 border-t border-dashed border-term-text-mute" />eligible, idle</span>
    </span>
  );
}

function MarginalCost({ problem, useDual }: { problem: SimProblem; useDual: Record<string, number> }) {
  const max = Math.max(...problem.uses.map((u) => useDual[u.id]), 1);
  return (
    <div>
      <ul className="space-y-1.5" aria-label="Marginal cost of one more dollar of coverage per use">
        {problem.uses.map((u) => (
          <li key={u.id} className="grid grid-cols-[112px_minmax(0,1fr)_44px] items-center gap-2" title={`${u.label}: ${bps(useDual[u.id], 2)} per extra $ of coverage`}>
            <span className="truncate text-[11px] text-term-text">{u.short}</span>
            <div className="h-[10px]"><div className="h-full rounded-r-[3px] bg-term-amber/80" style={{ width: `${Math.max(0, useDual[u.id] / max) * 100}%` }} /></div>
            <span className="text-right font-mono text-[10px] text-term-text-dim">{num(useDual[u.id], 0)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-term-border pt-2 text-[10px] leading-relaxed text-term-text-mute">
        vⱼ is the cost in bp of covering one more dollar of a use at the optimum. Uses that compete for the same exhausted lanes share a price. A use that can be shed is capped by its penalty.
      </p>
    </div>
  );
}

function Formulation({ problem, stats, infeasible }: { problem: SimProblem; stats: { variables: number; rows: number; stages: number; pivots: number; millis: number }; infeasible: boolean }) {
  const hard = problem.uses.filter((u) => u.policy === "hard").length;
  return (
    <div className="space-y-2.5 p-3 text-[10px] leading-relaxed text-term-text-dim">
      <div className="space-y-1 rounded-md border border-term-border bg-term-panel-2 p-2.5 font-mono text-[10.5px] text-term-text">
        <div><span className="text-term-amber">min</span> Σ (cᵢ + fᵢⱼ)·xᵢⱼ + Σ pⱼ·sⱼ</div>
        <div><span className="text-term-text-mute">s.t.</span> Σⱼ xᵢⱼ ≤ Aᵢ <span className="text-term-text-mute">∀ source</span></div>
        <div className="pl-6">Σᵢ (1−hᵢ)·xᵢⱼ + sⱼ = Dⱼ <span className="text-term-text-mute">∀ use</span></div>
        <div className="pl-6">Σ_{"{j∈t}"} pⱼsⱼ ≤ z*ₜ <span className="text-term-text-mute">∀ tier t</span></div>
        <div className="pl-6">x, s ≥ 0; sⱼ ≡ 0 for hard uses</div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <Item k="Problem class" v="LP · generalised transport" />
        <Item k="Algorithm" v="2-phase simplex, Bland" />
        <Item k="Variables" v={`${stats.variables}`} />
        <Item k="Rows (final)" v={`${stats.rows}`} />
        <Item k="Stages" v={infeasible ? "elastic diagnostic" : `${stats.stages - 1} tier + 1 econ`} />
        <Item k="Pivots" v={`${stats.pivots}`} />
        <Item k="Lanes allowed" v={`${problem.lanes.length} / ${problem.sources.length * problem.uses.length}`} />
        <Item k="Hard uses" v={`${hard} of ${problem.uses.length}`} />
      </dl>
      <p className="flex gap-1.5 border-t border-term-border pt-2 text-[9px] text-term-text-mute">
        <Sigma size={11} className="mt-px shrink-0" /> Lane friction fᵢⱼ is illustrative SIM economics, not the production objective. The solve is single-currency and continuous. Values are rounded for display only.
      </p>
    </div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (<><dt className="text-term-text-mute">{k}</dt><dd className="text-right font-mono text-term-text">{v}</dd></>);
}
