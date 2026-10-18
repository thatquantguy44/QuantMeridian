import { Ban, Check, RotateCcw } from "lucide-react";
import {
  DEFAULT_PENALTIES, laneCost, laneKey, shortfallPenalty,
  type CostBreakdown, type FeasibleResult, type PenaltyConfig, type SimLane, type SimProblem,
} from "@/data/sourcesUsesSynthetic";
import { bps, mm, num } from "./format";

const inputCls = "w-16 rounded border border-term-border bg-term-panel-2 px-1.5 py-0.5 text-right font-mono text-[10px] text-term-text outline-none focus:border-term-amber/60";

/** Global and per-node penalty configuration for the transport objective. */
export function PenaltyControls({ problem, config, onChange }: {
  problem: SimProblem;
  config: PenaltyConfig;
  onChange: (next: PenaltyConfig) => void;
}) {
  const set = (patch: Partial<PenaltyConfig>) => onChange({ ...config, ...patch });
  const changed = JSON.stringify(config) !== JSON.stringify(DEFAULT_PENALTIES);
  return (
    <div className="grid gap-4 p-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <section aria-labelledby="pen-global" className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 id="pen-global" className="text-[9px] font-semibold uppercase tracking-[0.16em] text-term-text-mute">Objective & lane penalties</h3>
          {changed && <button type="button" onClick={() => onChange(DEFAULT_PENALTIES)} className="flex items-center gap-1 rounded border border-term-border px-1.5 py-0.5 text-[10px] text-term-text-dim hover:text-term-amber"><RotateCcw size={11} /> Defaults</button>}
        </div>
        <div>
          <div className="mb-1 text-[10px] text-term-text-dim">Priority handling</div>
          <div className="flex overflow-hidden rounded-md border border-term-border" role="radiogroup" aria-label="Priority handling">
            {([["lexicographic", "Lexicographic tiers"], ["weighted", "Weighted penalties"]] as const).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={config.priorityMode === id} onClick={() => set({ priorityMode: id })}
                className={`flex-1 px-2 py-1 text-[10px] font-medium transition ${config.priorityMode === id ? "bg-term-amber text-black" : "bg-term-panel-2 text-term-text-dim hover:text-term-text"}`}>{label}</button>
            ))}
          </div>
          <p className="mt-1 text-[9px] leading-snug text-term-text-mute">
            {config.priorityMode === "lexicographic"
              ? "Spec default (SU-004). Each tier's shortfall is minimised and fixed before any cost is optimised."
              : "Comparison only. One transport solve trades shortfall penalties directly against funding cost."}
          </p>
        </div>
        <Range id="xent" label="Cross-entity transfer" value={config.crossEntityBps} min={0} max={60} step={1} unit="bp" onChange={(v) => set({ crossEntityBps: v })} />
        <Range id="tenor" label="Tenor mismatch / 30d" value={config.tenorMismatchBpsPer30d} min={0} max={6} step={0.25} unit="bp" dp={2} onChange={(v) => set({ tenorMismatchBpsPer30d: v })} />
        <Range id="hc" label="Haircut capital charge" value={config.haircutChargeBps} min={0} max={300} step={5} unit="bp × h" onChange={(v) => set({ haircutChargeBps: v })} />
        <div className="rounded-md border border-term-border bg-term-panel-2/60 p-2">
          <Toggle id="conc" label="Concentration penalty" checked={config.concentration.enabled} onChange={(enabled) => set({ concentration: { ...config.concentration, enabled } })} />
          {config.concentration.enabled && <div className="mt-2 space-y-2">
            <Range id="conc-t" label="Lane threshold (% of use)" value={config.concentration.thresholdPct} min={20} max={100} step={5} unit="%" onChange={(v) => set({ concentration: { ...config.concentration, thresholdPct: v } })} />
            <Range id="conc-p" label="Penalty above threshold" value={config.concentration.penaltyBps} min={0} max={60} step={1} unit="bp" onChange={(v) => set({ concentration: { ...config.concentration, penaltyBps: v } })} />
          </div>}
        </div>
      </section>

      <section aria-labelledby="pen-src">
        <div className="mb-2 flex items-center justify-between">
          <h3 id="pen-src" className="text-[9px] font-semibold uppercase tracking-[0.16em] text-term-text-mute">Supply side · dummy idle sink</h3>
        </div>
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          <Toggle id="idle" label="Idle capacity penalty" checked={config.idleEnabled} onChange={(idleEnabled) => set({ idleEnabled })} />
          <Toggle id="mind" label="Minimum-draw penalty" checked={config.minDrawEnabled} onChange={(minDrawEnabled) => set({ minDrawEnabled })} />
        </div>
        <table className="w-full text-[10px]">
          <thead><tr className="text-[9px] uppercase tracking-[0.1em] text-term-text-mute">
            <th scope="col" className="pb-1 text-left font-semibold">Source</th>
            <th scope="col" className="pb-1 text-right font-semibold">Tenor</th>
            <th scope="col" className="pb-1 text-right font-semibold" title="Penalty per $ of unused capacity">Idle bp</th>
            <th scope="col" className="pb-1 text-right font-semibold" title="Minimum draw · penalty per $ below it">Floor</th>
          </tr></thead>
          <tbody>
            {problem.sources.map((s) => (
              <tr key={s.id} className="border-t border-term-border">
                <th scope="row" className="py-1 text-left font-normal text-term-text">{s.short}</th>
                <td className="py-1 text-right font-mono text-term-text-mute">{s.tenorDays}d</td>
                <td className="py-1 text-right">
                  <input type="number" min={0} step={1} aria-label={`${s.label} idle penalty (bp)`} disabled={!config.idleEnabled}
                    value={config.idleOverrides[s.id] ?? s.idlePenaltyBps} className={`${inputCls} disabled:opacity-40`}
                    onChange={(e) => set({ idleOverrides: { ...config.idleOverrides, [s.id]: Math.max(0, Number(e.target.value) || 0) } })} />
                </td>
                <td className={`py-1 text-right font-mono ${config.minDrawEnabled && s.minDraw > 0 ? "text-term-text-dim" : "text-term-text-mute"}`}>
                  {s.minDraw > 0 ? `${num(s.minDraw, 0)} · ${s.minDrawPenaltyBps}bp` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="pen-use">
        <h3 id="pen-use" className="mb-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-term-text-mute">Demand side · dummy shortfall source</h3>
        <table className="w-full text-[10px]">
          <thead><tr className="text-[9px] uppercase tracking-[0.1em] text-term-text-mute">
            <th scope="col" className="pb-1 text-left font-semibold">Use</th>
            <th scope="col" className="pb-1 text-right font-semibold">Tenor</th>
            <th scope="col" className="pb-1 text-right font-semibold" title="Penalty per $ of unmet coverage">Shortfall bp</th>
          </tr></thead>
          <tbody>
            {problem.uses.map((u) => (
              <tr key={u.id} className="border-t border-term-border">
                <th scope="row" className="py-1 text-left font-normal text-term-text">{u.short} <span className="text-[9px] text-term-text-mute">T{u.tier}</span></th>
                <td className="py-1 text-right font-mono text-term-text-mute">{u.tenorDays}d</td>
                <td className="py-1 text-right">
                  {u.policy === "hard"
                    ? <span className="font-mono text-[9px] uppercase tracking-wider text-term-text-mute" title="Hard obligation: no shortfall variable">hard ◆</span>
                    : <input type="number" min={0} step={5} aria-label={`${u.label} shortfall penalty (bp)`} value={shortfallPenalty(config, u)} className={inputCls}
                        onChange={(e) => set({ shortfallOverrides: { ...config.shortfallOverrides, [u.id]: Math.max(0, Number(e.target.value) || 0) } })} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const BREAKDOWN_ROWS: { key: keyof CostBreakdown; label: string; hint: string }[] = [
  { key: "funding", label: "Funding cost", hint: "Σ cᵢ·xᵢⱼ" },
  { key: "pair", label: "Pair penalties", hint: "Σ pᵢⱼ·xᵢⱼ" },
  { key: "crossEntity", label: "Cross-entity", hint: "entity ≠" },
  { key: "tenor", label: "Tenor mismatch", hint: "Δtenor/30d" },
  { key: "haircut", label: "Haircut charge", hint: "hᵢ × charge" },
  { key: "concentration", label: "Concentration", hint: "above threshold" },
  { key: "idle", label: "Idle capacity", hint: "dummy sink" },
  { key: "minDraw", label: "Min-draw breach", hint: "below floor" },
  { key: "shortfall", label: "Shortfall", hint: "dummy source" },
];

/** Objective decomposition: funding vs penalties, then each component ranked. */
export function CostBreakdownChart({ result }: { result: FeasibleResult }) {
  const b = result.breakdown;
  const total = Math.max(result.totals.totalCostMm, 1e-9);
  const max = Math.max(...BREAKDOWN_ROWS.map((r) => b[r.key]), 1e-9);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] text-term-text-dim">Objective</span>
        <span className="font-mono text-[13px] font-semibold text-term-text">{mm(total, 2)}<span className="text-[10px] text-term-text-mute">/yr</span></span>
      </div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-[3px]" role="img" aria-label={`Funding ${mm(b.funding, 2)}, penalties ${mm(result.totals.penaltyCostMm, 2)}`}>
        <div className="bg-term-text/75" style={{ width: `${(b.funding / total) * 100}%` }} />
        {result.totals.penaltyCostMm > 1e-9 && <div className="bg-term-amber" style={{ width: `${(result.totals.penaltyCostMm / total) * 100}%` }} />}
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-term-text-mute">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-term-text/75" /> funding {mm(b.funding, 2)}</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-term-amber" /> penalties {mm(result.totals.penaltyCostMm, 2)}</span>
      </div>
      <ul className="mt-3 space-y-1.5" aria-label="Objective components">
        {BREAKDOWN_ROWS.map((row) => {
          const v = b[row.key];
          return (
            <li key={row.key} className="grid grid-cols-[104px_minmax(0,1fr)_52px] items-center gap-2" title={`${row.label} (${row.hint}): ${mm(v, 3)}/yr`}>
              <span className={`truncate text-[11px] ${v > 1e-9 ? "text-term-text" : "text-term-text-mute"}`}>{row.label}</span>
              <div className="h-[9px]"><div className={`h-full rounded-r-[3px] ${row.key === "funding" ? "bg-term-text/75" : "bg-term-amber"}`} style={{ width: `${(v / max) * 100}%` }} /></div>
              <span className={`text-right font-mono text-[10px] ${v > 1e-9 ? "text-term-text-dim" : "text-term-text-mute"}`}>{v > 1e-9 ? num(v, 2) : "—"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Selected lane: unit-cost stack, reduced cost, allow/deny and pair-penalty override. */
export function LaneInspector({ problem, baseLane, config, result, denied, onToggle, onPenalty, onClose }: {
  problem: SimProblem;
  baseLane: SimLane;
  config: PenaltyConfig;
  result: FeasibleResult | null;
  denied: boolean;
  onToggle: () => void;
  onPenalty: (bp: number | null) => void;
  onClose: () => void;
}) {
  const s = problem.sources.find((x) => x.id === baseLane.sourceId)!;
  const u = problem.uses.find((x) => x.id === baseLane.useId)!;
  const c = laneCost(problem, config, baseLane);
  const key = laneKey(baseLane.sourceId, baseLane.useId);
  const flow = result?.flows.find((f) => f.sourceId === s.id && f.useId === u.id);
  const overridden = config.lanePenaltyOverrides[key] !== undefined;
  const parts: [string, number][] = [["Source cost", c.base], ["Pair penalty", c.pair], ["Cross-entity", c.crossEntity], ["Tenor mismatch", c.tenor], ["Haircut charge", c.haircut]];
  const max = Math.max(c.total + (config.concentration.enabled ? config.concentration.penaltyBps : 0), 1);
  let acc = 0;
  return (
    <div className="mt-3 grid gap-3 rounded-md border border-term-amber/30 bg-term-amber/[0.04] p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]" role="region" aria-label={`Lane ${s.short} to ${u.short}`}>
      <div className="min-w-0">
        <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-term-amber">Lane</div>
        <div className="mt-0.5 text-sm font-semibold text-term-text">{s.label} → {u.label}</div>
        <div className="mt-0.5 text-[10px] text-term-text-mute">{baseLane.note}</div>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
          <dt className="text-term-text-mute">Entities</dt><dd className="text-right text-term-text-dim">{s.legalEntity === u.legalEntity ? "same" : "cross-entity"}</dd>
          <dt className="text-term-text-mute">Tenor</dt><dd className="text-right font-mono text-term-text-dim">{s.tenorDays}d → {u.tenorDays}d</dd>
          <dt className="text-term-text-mute">Flow</dt><dd className="text-right font-mono text-term-text">{denied ? "denied" : flow ? mm(flow.nominal) : "—"}</dd>
          {flow && flow.excess > 1e-6 && <><dt className="text-term-text-mute">Above threshold</dt><dd className="text-right font-mono text-term-amber">{mm(flow.excess)}</dd></>}
          {flow && <><dt className="text-term-text-mute">Reduced cost</dt><dd className="text-right font-mono text-term-text-dim">{bps(flow.reducedCostBps, 2)}</dd></>}
        </dl>
      </div>
      <div className="min-w-0">
        <div className="mb-1 flex items-baseline justify-between text-[10px]">
          <span className="text-term-text-dim">Unit cost cᵢⱼ</span>
          <span className="font-mono text-[12px] font-semibold text-term-text">{bps(c.total, 1)}</span>
        </div>
        <ul className="space-y-1">
          {parts.map(([label, v]) => {
            const start = acc; acc += v;
            return (
              <li key={label} className="grid grid-cols-[96px_minmax(0,1fr)_44px] items-center gap-2 text-[10px]">
                <span className={v > 0 ? "text-term-text-dim" : "text-term-text-mute"}>{label}</span>
                <div className="relative h-[8px]">{v > 0 && <div className={`absolute inset-y-0 rounded-[2px] ${label === "Source cost" ? "bg-term-text/75" : "bg-term-amber"}`} style={{ left: `${(start / max) * 100}%`, width: `${(v / max) * 100}%` }} />}</div>
                <span className="text-right font-mono text-term-text-dim">{num(v, 1)}</span>
              </li>
            );
          })}
          {config.concentration.enabled && (
            <li className="grid grid-cols-[96px_minmax(0,1fr)_44px] items-center gap-2 text-[10px]">
              <span className="text-term-text-mute">+ above {config.concentration.thresholdPct}%</span>
              <div className="relative h-[8px]"><div className="absolute inset-y-0 rounded-[2px] border border-dashed border-term-amber/70" style={{ left: `${(c.total / max) * 100}%`, width: `${(config.concentration.penaltyBps / max) * 100}%` }} /></div>
              <span className="text-right font-mono text-term-text-mute">{num(config.concentration.penaltyBps, 1)}</span>
            </li>
          )}
        </ul>
      </div>
      <div className="flex flex-col gap-2 md:w-44">
        <label className="text-[10px] text-term-text-dim" htmlFor="lane-penalty">Pair penalty (bp)</label>
        <div className="flex items-center gap-1.5">
          <input id="lane-penalty" type="number" min={0} step={1} value={c.pair} className={inputCls.replace("w-16", "w-20")}
            onChange={(e) => onPenalty(Math.max(0, Number(e.target.value) || 0))} />
          {overridden && <button type="button" onClick={() => onPenalty(null)} className="text-[10px] text-term-text-mute underline hover:text-term-amber">reset to {baseLane.penaltyBps}</button>}
        </div>
        <button type="button" onClick={onToggle} className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition ${denied ? "border-term-up/40 text-term-up hover:bg-term-up/10" : "border-term-down/40 text-term-down hover:bg-term-down/10"}`}>
          {denied ? <><Check size={12} /> Allow lane</> : <><Ban size={12} /> Deny lane</>}
        </button>
        <button type="button" onClick={onClose} className="text-[10px] text-term-text-mute hover:text-term-text">Close</button>
      </div>
    </div>
  );
}

function Range({ id, label, value, min, max, step, unit, dp = 0, onChange }: {
  id: string; label: string; value: number; min: number; max: number; step: number; unit: string; dp?: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px]">
        <label htmlFor={`pen-${id}`} className="text-term-text-dim">{label}</label>
        <span className="font-mono text-term-text">{num(value, dp)}{unit.startsWith("%") ? "" : " "}{unit}</span>
      </div>
      <input id={`pen-${id}`} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-term-panel-3 accent-term-amber" />
    </div>
  );
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={`pen-${id}`} className="flex cursor-pointer items-center gap-2 text-[10px] text-term-text-dim">
      <input id={`pen-${id}`} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-3 w-3 accent-term-amber" />
      {label}
    </label>
  );
}
