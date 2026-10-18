import { FAMILY_META, idlePenalty, laneCost, laneKey, shortfallPenalty, type PenaltyConfig, type SimLane, type SimProblem, type SimResult } from "@/data/sourcesUsesSynthetic";
import { num } from "./format";

const cellCls = "border-l border-t border-term-border p-0";

/**
 * The classic balanced transportation tableau: sources × uses with unit cost
 * cᵢⱼ in the corner and optimal flow in the cell, a dummy "unmet demand" row
 * priced at each use's shortfall penalty and a dummy "idle" column priced at
 * each source's idle penalty, plus capacity/demand margins and the dual
 * potentials uᵢ and vⱼ. Selecting a cell opens the lane inspector.
 */
export function TransportTableau({
  problem, baseLanes, deniedLanes, config, result, selected, onSelect,
}: {
  problem: SimProblem;
  baseLanes: SimLane[];
  deniedLanes: string[];
  config: PenaltyConfig;
  result: SimResult;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const feasible = result.status === "optimal" ? result : null;
  const flowMap = new Map(feasible?.flows.map((f) => [laneKey(f.sourceId, f.useId), f]) ?? []);
  const base = new Map(baseLanes.map((l) => [laneKey(l.sourceId, l.useId), l]));
  const denied = new Set(deniedLanes);
  const maxFlow = Math.max(1, ...(feasible?.flows.map((f) => f.nominal) ?? [1]));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1020px] border-separate border-spacing-0 text-[11px]">
        <caption className="sr-only">Balanced transportation tableau: optimal nominal flow ($mm) per source and use, unit costs in bp, dummy shortfall row and idle column, and dual prices.</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-term-panel px-2 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-term-text-mute">Source \ Use</th>
            {problem.uses.map((u) => (
              <th key={u.id} scope="col" className="px-1 py-2 text-center align-bottom">
                <div className="text-[10px] font-semibold text-term-text">{u.short}</div>
                <div className="text-[9px] font-normal text-term-text-mute">T{u.tier} · {u.policy === "hard" ? "hard" : "soft"} · {u.tenorDays}d</div>
              </th>
            ))}
            <th scope="col" className="px-1 py-2 text-center align-bottom">
              <div className="text-[10px] font-semibold text-term-text-dim">Idle</div>
              <div className="text-[9px] font-normal text-term-text-mute">dummy sink</div>
            </th>
            <th scope="col" className="px-2 py-2 text-right text-[9px] uppercase tracking-[0.12em] text-term-text-mute">Supply</th>
            <th scope="col" className="px-2 py-2 text-right text-[9px] uppercase tracking-[0.12em] text-term-amber" title="Capacity shadow price: objective change per extra $ of this source">uᵢ</th>
          </tr>
        </thead>
        <tbody>
          {problem.sources.map((s) => {
            const used = feasible?.sourceUsed[s.id] ?? 0;
            const binding = feasible && s.amount > 0 && s.amount - used < 1e-6 * Math.max(1, s.amount);
            const idle = feasible?.idle[s.id] ?? 0;
            return (
              <tr key={s.id}>
                <th scope="row" className="sticky left-0 z-10 border-t border-term-border bg-term-panel px-2 py-1.5 text-left font-normal">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: FAMILY_META[s.family].color }} aria-hidden />
                    <span className="truncate font-semibold text-term-text">{s.short}</span>
                  </div>
                  <div className="pl-3.5 text-[9px] text-term-text-mute">{s.costBps}bp · h {num(s.haircutPct, 0)}% · {s.tenorDays}d</div>
                </th>
                {problem.uses.map((u) => {
                  const key = laneKey(s.id, u.id);
                  const lane = base.get(key);
                  if (!lane) {
                    return <td key={u.id} className={cellCls} aria-label={`${s.short} to ${u.short}: not eligible`}><div className="h-[42px] bg-[repeating-linear-gradient(135deg,transparent_0_5px,rgba(255,255,255,0.035)_5px_6px)]" /></td>;
                  }
                  const off = denied.has(key);
                  const flow = flowMap.get(key);
                  const value = flow?.nominal ?? 0;
                  const active = value > 1e-6;
                  const unit = laneCost(problem, config, lane).total;
                  const penalised = unit - s.costBps > 1e-9;
                  const isSel = selected === key;
                  const label = off
                    ? `${s.short} to ${u.short}: denied by you; unit cost ${num(unit, 1)}bp. Select to edit.`
                    : `${s.short} to ${u.short}: ${active ? `${num(value)} $mm` : "eligible, unused"}; unit cost ${num(unit, 1)}bp${flow ? `; reduced cost ${num(flow.reducedCostBps, 2)}bp` : ""}. Select to edit.`;
                  return (
                    <td key={u.id} className={cellCls}>
                      <button type="button" onClick={() => onSelect(key)} title={label} aria-label={label} aria-pressed={isSel}
                        className={`relative flex h-[42px] w-full flex-col items-center justify-center px-1 transition hover:ring-1 hover:ring-inset hover:ring-term-amber/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-term-amber ${isSel ? "ring-2 ring-inset ring-term-amber" : ""}`}
                        style={{ background: active ? `rgba(255,140,0,${0.12 + 0.55 * (value / maxFlow)})` : undefined }}>
                        <span className={`absolute right-1 top-0.5 font-mono text-[8px] ${penalised ? "text-term-amber/90" : "text-term-text-mute"}`}>{num(unit, unit % 1 ? 1 : 0)}</span>
                        {flow && flow.excess > 1e-6 && <span className="absolute left-1 top-0.5 text-[8px] text-term-amber" aria-hidden>▲</span>}
                        {off ? <span className="font-mono text-[10px] uppercase tracking-wider text-term-down">off</span>
                          : active ? <span className="font-mono text-[11px] font-semibold text-term-text">{num(value, 0)}</span>
                          : <span className="font-mono text-[10px] text-term-text-mute">{flow ? `+${num(flow.reducedCostBps, 0)}` : "·"}</span>}
                      </button>
                    </td>
                  );
                })}
                <td className={cellCls}>
                  <div className="relative flex h-[42px] items-center justify-center bg-[repeating-linear-gradient(135deg,transparent_0_5px,rgba(138,138,147,0.10)_5px_6px)]" title={`Idle ${num(idle)} $mm at ${idlePenalty(config, s)}bp`}>
                    <span className="absolute right-1 top-0.5 font-mono text-[8px] text-term-text-mute">{idlePenalty(config, s)}</span>
                    <span className={`font-mono text-[11px] ${idle > 1e-6 ? "font-semibold text-term-text-dim" : "text-term-text-mute"}`}>{feasible ? (idle > 1e-6 ? num(idle, 0) : "·") : "—"}</span>
                  </div>
                </td>
                <td className="border-l border-t border-term-border px-2 text-right font-mono text-[10px] text-term-text-dim">
                  {num(s.amount, 0)}
                  {binding && <span className="ml-1 rounded-sm bg-term-gold/15 px-1 text-[8px] font-semibold text-term-gold">BIND</span>}
                </td>
                <td className="border-l border-t border-term-border px-2 text-right font-mono text-[10px] text-term-amber">{feasible ? num(feasible.capacityDualBps[s.id], 1) : "—"}</td>
              </tr>
            );
          })}
          <tr>
            <th scope="row" className="sticky left-0 z-10 border-t border-term-border bg-term-panel px-2 py-1.5 text-left font-normal">
              <div className="font-semibold text-term-down">Unmet demand</div>
              <div className="text-[9px] text-term-text-mute">dummy source</div>
            </th>
            {problem.uses.map((u) => {
              const v = feasible?.shortfall[u.id] ?? 0;
              return (
                <td key={u.id} className={cellCls}>
                  <div className="relative flex h-[42px] items-center justify-center bg-[repeating-linear-gradient(45deg,transparent_0_5px,rgba(255,59,59,0.10)_5px_6px)]">
                    <span className="absolute right-1 top-0.5 font-mono text-[8px] text-term-text-mute">{u.policy === "hard" ? "∞" : shortfallPenalty(config, u)}</span>
                    <span className={`font-mono text-[11px] ${v > 1e-6 ? "font-semibold text-term-down" : "text-term-text-mute"}`}>{v > 1e-6 ? num(v, 0) : u.policy === "hard" ? "—" : "·"}</span>
                  </div>
                </td>
              );
            })}
            <td className={cellCls} /><td className="border-l border-t border-term-border" colSpan={2} />
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="sticky left-0 z-10 border-t border-term-border bg-term-panel px-2 py-1.5 text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-term-text-mute">Demand</th>
            {problem.uses.map((u) => <td key={u.id} className="border-l border-t border-term-border px-1 py-1.5 text-center font-mono text-[10px] text-term-text-dim">{num(u.amount, 0)}</td>)}
            <td className="border-l border-t border-term-border px-1 py-1.5 text-center font-mono text-[10px] text-term-text-mute">{feasible ? num(feasible.totals.idle, 0) : "—"}</td>
            <td className="border-l border-t border-term-border" colSpan={2} />
          </tr>
          <tr>
            <th scope="row" className="sticky left-0 z-10 border-t border-term-border bg-term-panel px-2 py-1.5 text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-term-amber" title="Marginal cost of one more $ of coverage for this use">vⱼ</th>
            {problem.uses.map((u) => <td key={u.id} className="border-l border-t border-term-border px-1 py-1.5 text-center font-mono text-[10px] text-term-amber">{feasible ? num(feasible.useDualBps[u.id], 1) : "—"}</td>)}
            <td className="border-l border-t border-term-border" colSpan={3} />
          </tr>
        </tfoot>
      </table>
      <p className="mt-2 text-[10px] leading-relaxed text-term-text-mute">
        Corner figure: unit cost cᵢⱼ in bp. It is shown in amber when penalties add to the source cost, and ▲ marks flow above the concentration threshold. Unused cells show the reduced cost <span className="font-mono">cᵢⱼ + uᵢ − (1−hᵢ)·vⱼ</span>, which is how much a lane must cheapen to enter the basis. The dummy row and column balance supply and demand as in the textbook tableau. Hatched cells are not eligible. Select any eligible cell to inspect its cost stack, override its pair penalty, or deny it.
      </p>
    </div>
  );
}
