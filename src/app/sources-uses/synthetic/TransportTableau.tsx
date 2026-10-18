import { Fragment } from "react";
import { FAMILY_META, laneKey, type SimLane, type SimProblem, type SimResult } from "@/data/sourcesUsesSynthetic";
import { bps, num } from "./format";

/**
 * The classic transportation tableau: sources × uses, unit cost in the corner,
 * optimal flow in the cell, capacity/demand on the margins and the dual
 * potentials (capacity shadow price uᵢ, coverage price vⱼ) on the outer edge.
 * Clicking an eligible cell toggles that lane and re-solves.
 */
export function TransportTableau({
  problem, baseLanes, deniedLanes, result, onToggle,
}: {
  problem: SimProblem;
  baseLanes: SimLane[];
  deniedLanes: string[];
  result: SimResult;
  onToggle: (key: string) => void;
}) {
  const feasible = result.status === "optimal" ? result : null;
  const flowMap = new Map(feasible?.flows.map((f) => [laneKey(f.sourceId, f.useId), f]) ?? []);
  const base = new Map(baseLanes.map((l) => [laneKey(l.sourceId, l.useId), l]));
  const denied = new Set(deniedLanes);
  const maxFlow = Math.max(1, ...(feasible?.flows.map((f) => f.nominal) ?? [1]));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[940px] border-separate border-spacing-0 text-[11px]">
        <caption className="sr-only">Transportation tableau: optimal nominal flow ($mm) per source and use, with unit costs and dual prices.</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-term-panel px-2 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-term-text-mute">Source \ Use</th>
            {problem.uses.map((u) => (
              <th key={u.id} scope="col" className="px-1 py-2 text-center align-bottom">
                <div className="text-[10px] font-semibold text-term-text">{u.short}</div>
                <div className="text-[9px] font-normal text-term-text-mute">T{u.tier} · {u.policy === "hard" ? "hard" : "soft"}</div>
              </th>
            ))}
            <th scope="col" className="px-2 py-2 text-right text-[9px] uppercase tracking-[0.12em] text-term-text-mute">Used / cap</th>
            <th scope="col" className="px-2 py-2 text-right text-[9px] uppercase tracking-[0.12em] text-term-amber" title="Capacity shadow price: objective saving per extra $ of capacity">uᵢ</th>
          </tr>
        </thead>
        <tbody>
          {problem.sources.map((s) => {
            const used = feasible?.sourceUsed[s.id] ?? 0;
            const binding = feasible && s.amount > 0 && s.amount - used < 1e-6 * Math.max(1, s.amount);
            return (
              <tr key={s.id}>
                <th scope="row" className="sticky left-0 z-10 border-t border-term-border bg-term-panel px-2 py-1.5 text-left font-normal">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: FAMILY_META[s.family].color }} aria-hidden />
                    <span className="truncate font-semibold text-term-text">{s.short}</span>
                  </div>
                  <div className="pl-3.5 text-[9px] text-term-text-mute">{bps(s.costBps)} · h {num(s.haircutPct, 0)}%</div>
                </th>
                {problem.uses.map((u) => {
                  const key = laneKey(s.id, u.id);
                  const lane = base.get(key);
                  const flow = flowMap.get(key);
                  if (!lane) {
                    return (
                      <td key={u.id} className="border-l border-t border-term-border p-0" aria-label={`${s.short} to ${u.short}: denied`}>
                        <div className="h-[42px] bg-[repeating-linear-gradient(135deg,transparent_0_5px,rgba(255,255,255,0.035)_5px_6px)]" />
                      </td>
                    );
                  }
                  const off = denied.has(key);
                  const value = flow?.nominal ?? 0;
                  const active = value > 1e-6;
                  const intensity = active ? 0.12 + 0.55 * (value / maxFlow) : 0;
                  const unit = s.costBps + lane.frictionBps;
                  const label = off
                    ? `${s.short} to ${u.short}: switched off by you. Click to re-allow.`
                    : `${s.short} to ${u.short}: ${active ? `${num(value)} $mm` : "eligible, unused"}; unit cost ${unit}bp${flow ? `; reduced cost ${num(flow.reducedCostBps, 2)}bp` : ""}. Click to deny.`;
                  return (
                    <td key={u.id} className="border-l border-t border-term-border p-0">
                      <button type="button" onClick={() => onToggle(key)} title={label} aria-label={label} aria-pressed={!off}
                        className="group relative flex h-[42px] w-full flex-col items-center justify-center px-1 transition hover:ring-1 hover:ring-inset hover:ring-term-amber/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-term-amber"
                        style={{ background: active ? `rgba(255,140,0,${intensity})` : undefined }}>
                        <span className="absolute right-1 top-0.5 font-mono text-[8px] text-term-text-mute">{unit}</span>
                        {off ? (
                          <span className="font-mono text-[10px] uppercase tracking-wider text-term-down">off</span>
                        ) : active ? (
                          <span className="font-mono text-[11px] font-semibold text-term-text">{num(value, 0)}</span>
                        ) : (
                          <span className="font-mono text-[10px] text-term-text-mute">{feasible && flow ? `+${num(flow.reducedCostBps, 0)}` : "·"}</span>
                        )}
                      </button>
                    </td>
                  );
                })}
                <td className="border-l border-t border-term-border px-2 text-right font-mono text-[10px] text-term-text-dim">
                  {num(used, 0)} / {num(s.amount, 0)}
                  {binding && <span className="ml-1 rounded-sm bg-term-gold/15 px-1 text-[8px] font-semibold text-term-gold">BIND</span>}
                </td>
                <td className="border-l border-t border-term-border px-2 text-right font-mono text-[10px] text-term-amber">{feasible ? num(feasible.capacityDualBps[s.id], 1) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          {[
            { label: "Demand", render: (id: string) => num(problem.uses.find((u) => u.id === id)!.amount, 0), tone: "text-term-text-dim" },
            { label: "Shortfall", render: (id: string) => { const v = feasible?.shortfall[id] ?? 0; return v > 1e-6 ? num(v, 0) : "—"; }, tone: "text-term-down" },
            { label: "vⱼ", render: (id: string) => (feasible ? num(feasible.useDualBps[id], 1) : "—"), tone: "text-term-amber" },
          ].map((row) => (
            <Fragment key={row.label}>
              <tr>
                <th scope="row" className="sticky left-0 z-10 border-t border-term-border bg-term-panel px-2 py-1.5 text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-term-text-mute"
                  title={row.label === "vⱼ" ? "Marginal cost of one more $ of coverage for this use" : undefined}>{row.label}</th>
                {problem.uses.map((u) => <td key={u.id} className={`border-l border-t border-term-border px-1 py-1.5 text-center font-mono text-[10px] ${row.tone}`}>{row.render(u.id)}</td>)}
                <td className="border-l border-t border-term-border" colSpan={2} />
              </tr>
            </Fragment>
          ))}
        </tfoot>
      </table>
      <p className="mt-2 text-[10px] leading-relaxed text-term-text-mute">
        Corner figure: unit cost cᵢ + fᵢⱼ (bp). Unused eligible cells show the reduced cost <span className="font-mono">cᵢⱼ + uᵢ − (1−hᵢ)·vⱼ</span>: how much cheaper that lane must get before it enters the basis. Hatched cells are denied by an explicit rule. Click any eligible cell to switch it off and watch the optimum re-route.
      </p>
    </div>
  );
}
