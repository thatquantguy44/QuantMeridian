import { useMemo, useState, type ReactNode } from "react";
import { CircleAlert, Copy, MousePointerClick, RotateCcw, ShieldCheck, Sigma } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import {
  DEFAULT_PENALTIES, FAMILY_META, NEUTRAL_KNOBS, SCENARIOS, applyKnobs, laneKey, solveSim, verifySim,
  type PenaltyConfig, type SimProblem, type SolveStats, type SourceFamily, type StressKnobs,
} from "@/data/sourcesUsesSynthetic";
import { bps, mm, num, pct, signed } from "./format";
import { CostBreakdownChart, LaneInspector, PenaltyControls } from "./PenaltyControls";
import { FamilyMix, ScenarioComparison, SourceUtilization, TierLadder, UseCoverage, VerificationList } from "./ShowcaseCharts";
import { TransportNetwork } from "./TransportNetwork";
import { TransportTableau } from "./TransportTableau";

export function SyntheticShowcase({ onCopyToWorkspace }: { onCopyToWorkspace: (problem: SimProblem, scenarioTitle: string, config: PenaltyConfig) => void }) {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [knobs, setKnobs] = useState<StressKnobs>(NEUTRAL_KNOBS);
  const [config, setConfig] = useState<PenaltyConfig>(DEFAULT_PENALTIES);
  const [selectedLane, setSelectedLane] = useState<string | null>(null);
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;

  const scenarioProblem = useMemo(() => scenario.build(), [scenario]);
  const problem = useMemo(() => applyKnobs(scenarioProblem, knobs), [scenarioProblem, knobs]);
  const result = useMemo(() => solveSim(problem, config), [problem, config]);
  const checks = useMemo(() => (result.status === "optimal" ? verifySim(result) : []), [result]);
  const certified = result.status === "optimal" && checks.every((c) => c.passed);

  const scenarioResults = useMemo(() => Object.fromEntries(SCENARIOS.map((s) => [s.id, solveSim(s.build(), config)])), [config]);
  const baseline = scenarioResults[SCENARIOS[0].id];
  const knobsActive = JSON.stringify(knobs) !== JSON.stringify(NEUTRAL_KNOBS);

  const selectScenario = (id: string) => { setScenarioId(id); setKnobs(NEUTRAL_KNOBS); setSelectedLane(null); };
  const toggleLane = (key: string) => setKnobs((k) => ({
    ...k, deniedLanes: k.deniedLanes.includes(key) ? k.deniedLanes.filter((x) => x !== key) : [...k.deniedLanes, key],
  }));
  const setLanePenalty = (key: string, bp: number | null) => setConfig((c) => {
    const lanePenaltyOverrides = { ...c.lanePenaltyOverrides };
    if (bp === null) delete lanePenaltyOverrides[key]; else lanePenaltyOverrides[key] = bp;
    return { ...c, lanePenaltyOverrides };
  });
  const selectedBaseLane = selectedLane ? scenarioProblem.lanes.find((l) => laneKey(l.sourceId, l.useId) === selectedLane) ?? null : null;

  const baseCost = baseline.status === "optimal" ? baseline.totals.totalCostMm : 0;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-3 p-3 lg:p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-term-cyan/25 bg-term-cyan/5 px-3 py-2 text-[11px] text-term-text-dim" role="note">
        <span className="rounded-sm border border-term-cyan/40 px-1.5 py-px font-mono text-[9px] font-bold tracking-[0.2em] text-term-cyan">SIM</span>
        <span>A synthetic, hand-built broker-dealer funding book (USD, $mm), solved as a penalised transportation problem. It shows how the model behaves. It is not a funding recommendation and uses no live or customer data.</span>
        <span className="ml-auto text-[10px] text-term-text-mute">spec012 · SU-SIM</span>
      </div>

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

      {result.status === "optimal" ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Objective" value={mm(result.totals.totalCostMm, 2)} sub={scenarioId === "base" && !knobsActive ? "baseline · $/yr" : `${signed(result.totals.totalCostMm - baseCost, (v) => mm(v, 2))} vs base`} tone="amber" />
          <Kpi label="Funding cost" value={mm(result.totals.fundingCostMm, 2)} sub={`${bps(result.totals.weightedCostBps, 1)} on ${mm(result.totals.nominal, 0)}`} />
          <Kpi label="Penalties" value={mm(result.totals.penaltyCostMm, 2)} sub={`${pct(result.totals.penaltyCostMm / Math.max(result.totals.totalCostMm, 1e-9), 0)} of objective`} />
          <Kpi label="Coverage" value={pct(result.totals.coveragePct)} sub={result.totals.shortfall > 1e-6 ? `${mm(result.totals.shortfall, 0)} unmet` : "every use whole"} tone={result.totals.shortfall > 1e-6 ? "down" : "up"} />
          <Kpi label="Idle capacity" value={mm(result.totals.idle, 0)} sub={`haircut drag ${mm(result.totals.haircutDrag, 0)}`} />
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

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Transport network" code="FLOW" accent className="rounded-lg" subtitle="ribbon width = $; taper = haircut; hatched = dummy nodes" right={<Legend />}>
          <div className="p-2 md:p-3"><TransportNetwork problem={problem} result={result} /></div>
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel title="Stress controls" code="LIVE" className="rounded-lg"
            right={knobsActive ? <button type="button" onClick={() => setKnobs(NEUTRAL_KNOBS)} className="flex items-center gap-1 rounded border border-term-border px-1.5 py-0.5 text-[10px] text-term-text-dim hover:text-term-amber"><RotateCcw size={11} /> Reset</button> : undefined}>
            <div className="space-y-3 p-3">
              <p className="text-[10px] leading-relaxed text-term-text-mute">Layered on “{scenario.title}”. Every change re-solves the full model in the browser.</p>
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
                  {knobs.deniedLanes.length} lane{knobs.deniedLanes.length === 1 ? "" : "s"} denied: <span className="font-mono text-term-text">{knobs.deniedLanes.join(", ").replace(/>/g, "→")}</span>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Solve sequence" code="LEX" className="rounded-lg">
            <div className="p-3">
              {result.status === "optimal" ? <TierLadder result={result} /> : <p className="text-[11px] text-term-down">The hard demand rows cannot all hold.</p>}
              <p className="mt-2 text-[10px] leading-relaxed text-term-text-mute">
                {config.priorityMode === "lexicographic"
                  ? "Tiers are solved in order and each optimum is then fixed. A lower tier can never outbid a higher one, however large its penalty."
                  : "Weighted mode prices shortfall directly against cost in one solve. Cheap-to-shed uses are dropped when funding is dearer than their penalty."}
              </p>
            </div>
          </Panel>

          {result.status === "optimal" && (
            <Panel title="Funding mix" code="MIX" className="rounded-lg">
              <div className="p-3"><FamilyMix result={result} /></div>
            </Panel>
          )}
        </div>
      </div>

      <Panel title="Penalty configuration" code="PEN" className="rounded-lg" subtitle="every term in cᵢⱼ and the dummy nodes is configurable">
        <PenaltyControls problem={problem} config={config} onChange={setConfig} />
      </Panel>

      <Panel title="Transportation tableau" code="MODI" className="rounded-lg" subtitle="flows $mm · costs & duals bp" right={<span className="flex items-center gap-1 text-[10px] text-term-text-mute"><MousePointerClick size={12} /> select a cell to edit the lane</span>}>
        <div className="p-3">
          <TransportTableau problem={problem} baseLanes={scenarioProblem.lanes} deniedLanes={knobs.deniedLanes} config={config} result={result}
            selected={selectedLane} onSelect={(key) => setSelectedLane((cur) => (cur === key ? null : key))} />
          {selectedBaseLane && (
            <LaneInspector problem={problem} baseLane={selectedBaseLane} config={config} result={result.status === "optimal" ? result : null}
              denied={knobs.deniedLanes.includes(selectedLane!)} onToggle={() => toggleLane(selectedLane!)}
              onPenalty={(bp) => setLanePenalty(selectedLane!, bp)} onClose={() => setSelectedLane(null)} />
          )}
        </div>
      </Panel>

      {result.status === "optimal" && (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
          <Panel title="Objective decomposition" code="OBJ" className="rounded-lg">
            <div className="p-3"><CostBreakdownChart result={result} /></div>
          </Panel>
          <Panel title="Source utilisation & shadow price" code="CAP" className="rounded-lg" right={<span className="text-[9px] text-term-text-mute">uᵢ bp</span>}>
            <div className="p-3">
              <SourceUtilization result={result} />
              <p className="mt-3 border-t border-term-border pt-2 text-[10px] leading-relaxed text-term-text-mute">
                uᵢ is the saving, in bp a year, from one more dollar of a source. It is negative when spare capacity only adds idle penalty. These are final-stage LP duals, conditional on the fixed tier levels (SIM-006).
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
        <Panel title="Scenario comparison" code="CMP" className="rounded-lg" subtitle="current penalties, no stress controls">
          <div className="p-3"><ScenarioComparison scenarios={SCENARIOS} results={scenarioResults} activeId={scenarioId} onSelect={selectScenario} /></div>
        </Panel>
        <Panel title="Independent verification" code="CERT" className="rounded-lg" right={result.status === "optimal" ? <span className={`text-[10px] font-semibold ${certified ? "text-term-up" : "text-term-down"}`}>{checks.filter((c) => c.passed).length}/{checks.length}</span> : undefined}>
          <div className="p-3">
            {result.status === "optimal" ? <VerificationList checks={checks} /> : <p className="text-[11px] leading-relaxed text-term-text-dim">There is no candidate solution to verify. The elastic diagnostic is reported above and is never shown as a plan.</p>}
          </div>
        </Panel>
        <Panel title="Formulation disclosure" code="LP" className="rounded-lg">
          <Formulation problem={problem} config={config} stats={result.stats} infeasible={result.status === "infeasible"} />
        </Panel>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-term-border bg-term-panel px-3 py-2.5">
        <p className="text-[10px] text-term-text-mute">Copy this book into the workspace as an editable configuration. Your stress settings, shortfall penalties and pair penalties are included. Copying does not enable solving there.</p>
        <button type="button" onClick={() => onCopyToWorkspace(problem, `${scenario.title}${knobsActive ? " (stressed)" : ""}`, config)}
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
        vⱼ is the cost in bp of covering one more dollar of a use at the optimum. It includes each lane's penalties. A shed use is capped at its shortfall penalty.
      </p>
    </div>
  );
}

function Formulation({ problem, config, stats, infeasible }: { problem: SimProblem; config: PenaltyConfig; stats: SolveStats; infeasible: boolean }) {
  const hard = problem.uses.filter((u) => u.policy === "hard").length;
  return (
    <div className="space-y-2.5 p-3 text-[10px] leading-relaxed text-term-text-dim">
      <div className="space-y-1 rounded-md border border-term-border bg-term-panel-2 p-2.5 font-mono text-[10.5px] text-term-text">
        <div><span className="text-term-amber">min</span> Σ cᵢⱼ·xᵢⱼ + κ·Σ x̂ᵢⱼ + Σ πⱼ·sⱼ + Σ ιᵢ·eᵢ + Σ μᵢ·mᵢ</div>
        <div className="pl-2 text-term-text-mute">cᵢⱼ = cᵢ + pᵢⱼ + χ·[entityᵢ≠entityⱼ] + τ·(Tⱼ−Tᵢ)⁺/30 + η·hᵢ</div>
        <div><span className="text-term-text-mute">s.t.</span> Σⱼ (xᵢⱼ+x̂ᵢⱼ) + eᵢ = Aᵢ <span className="text-term-text-mute">supply, dummy sink e</span></div>
        <div className="pl-6">Σᵢ (1−hᵢ)(xᵢⱼ+x̂ᵢⱼ) + sⱼ = Dⱼ <span className="text-term-text-mute">demand, dummy source s</span></div>
        <div className="pl-6">xᵢⱼ ≤ θ·Dⱼ/(1−hᵢ) <span className="text-term-text-mute">concentration split</span></div>
        <div className="pl-6">Σⱼ (xᵢⱼ+x̂ᵢⱼ) + mᵢ ≥ floorᵢ <span className="text-term-text-mute">min draw</span></div>
        {config.priorityMode === "lexicographic" && <div className="pl-6">Σ_{"{j∈t}"} πⱼsⱼ ≤ z*ₜ <span className="text-term-text-mute">∀ tier t</span></div>}
        <div className="pl-6">all ≥ 0; sⱼ ≡ 0 for hard uses</div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <Item k="Problem class" v="balanced generalised transport LP" />
        <Item k="Priority" v={config.priorityMode} />
        <Item k="Algorithm" v="2-phase simplex, Bland" />
        <Item k="Variables · rows" v={`${stats.variables} · ${stats.rows}`} />
        <Item k="Stages" v={infeasible ? "elastic diagnostic" : config.priorityMode === "weighted" ? "1 (weighted)" : `${stats.stages - 1} tier + 1 econ`} />
        <Item k="Pivots" v={`${stats.pivots}`} />
        <Item k="Lanes allowed" v={`${problem.lanes.length} / ${problem.sources.length * problem.uses.length}`} />
        <Item k="Hard uses" v={`${hard} of ${problem.uses.length}`} />
        <Item k="χ · τ · η" v={`${config.crossEntityBps} · ${config.tenorMismatchBpsPer30d} · ${config.haircutChargeBps}bp`} />
        <Item k="θ · κ" v={config.concentration.enabled ? `${config.concentration.thresholdPct}% · ${config.concentration.penaltyBps}bp` : "off"} />
      </dl>
      <p className="flex gap-1.5 border-t border-term-border pt-2 text-[9px] text-term-text-mute">
        <Sigma size={11} className="mt-px shrink-0" /> Penalty values are illustrative SIM economics, not the production objective. The solve is single-currency and continuous. Values are rounded for display only.
      </p>
    </div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (<><dt className="text-term-text-mute">{k}</dt><dd className="text-right font-mono text-term-text">{v}</dd></>);
}
