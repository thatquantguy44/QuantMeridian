import { useMemo, useState } from "react";
import {
  FAMILY_META, TIER_LABELS, laneKey,
  type SimProblem, type SimResult,
} from "@/data/sourcesUsesSynthetic";
import { bps, mm, pct } from "./format";

const W = 1000;
const H = 600;
const PAD_Y = 28;
const NODE_W = 14;
const SRC_X = 214;
const USE_X = W - 214 - NODE_W;
const GAP = 9;
const TIER_GAP = 22;
const SLOT_MIN = 32;

type Hover = { kind: "source" | "use"; id: string } | { kind: "lane"; key: string } | null;

interface Placed { y: number; h: number }

/**
 * Bipartite transport network. Ribbons start at the nominal width on the source
 * side and taper to the haircut-adjusted coverage on the use side, so the
 * haircut drag is visible as the narrowing of each lane.
 */
export function TransportNetwork({ problem, result }: { problem: SimProblem; result: SimResult }) {
  const [hover, setHover] = useState<Hover>(null);
  const [tip, setTip] = useState<{ x: number; y: number; flip: boolean; lines: string[] } | null>(null);
  const feasible = result.status === "optimal" ? result : null;

  const geo = useMemo(() => {
    const tiers = [...new Set(problem.uses.map((u) => u.tier))].sort((a, b) => a - b);
    const srcAvail = H - PAD_Y * 2 - GAP * (problem.sources.length - 1);
    const useAvail = H - PAD_Y * 2 - GAP * (problem.uses.length - 1) - TIER_GAP * (tiers.length - 1);
    // Each node gets a slot of at least SLOT_MIN so its two-line label never collides.
    const fit = (amounts: number[], avail: number) => {
      let k = avail / Math.max(amounts.reduce((a, v) => a + v, 0), 1);
      for (let pass = 0; pass < 3; pass++) {
        const big = amounts.filter((v) => v * k >= SLOT_MIN);
        const fixed = (amounts.length - big.length) * SLOT_MIN;
        k = (avail - fixed) / Math.max(big.reduce((a, v) => a + v, 0), 1);
      }
      return k;
    };
    const k = Math.min(fit(problem.sources.map((s) => Math.max(s.amount, 0)), srcAvail), fit(problem.uses.map((u) => u.amount), useAvail));
    const slot = (v: number) => Math.max(SLOT_MIN, v * k);

    const src: Record<string, Placed> = {};
    const srcSpan = problem.sources.reduce((a, s) => a + slot(Math.max(s.amount, 0)), 0);
    let y = PAD_Y + Math.max(0, (srcAvail - srcSpan) / 2);
    problem.sources.forEach((s) => {
      const h = Math.max(4, s.amount * k);
      const sl = slot(Math.max(s.amount, 0));
      src[s.id] = { y: y + (sl - h) / 2, h };
      y += sl + GAP;
    });

    const use: Record<string, Placed> = {};
    const tierBands: { tier: number; y0: number; y1: number }[] = [];
    const useSpan = problem.uses.reduce((a, u) => a + slot(u.amount), 0);
    y = PAD_Y + Math.max(0, (useAvail - useSpan) / 2);
    tiers.forEach((tier, ti) => {
      if (ti > 0) y += TIER_GAP - GAP;
      const y0 = y;
      problem.uses.filter((u) => u.tier === tier).forEach((u) => {
        const h = Math.max(4, u.amount * k);
        const sl = slot(u.amount);
        use[u.id] = { y: y + (sl - h) / 2, h };
        y += sl + GAP;
      });
      tierBands.push({ tier, y0, y1: y - GAP });
    });

    // Stack ribbons on each node in the opposite node's vertical order to minimise crossings.
    type Ribbon = { key: string; sourceId: string; useId: string; s0: number; s1: number; u0: number; u1: number; nominal: number; coverage: number; unit: number; reduced: number };
    const ribbons: Ribbon[] = [];
    if (feasible) {
      const srcOff: Record<string, number> = {};
      const useOff: Record<string, number> = {};
      const active = feasible.flows.filter((f) => f.nominal > 1e-6);
      const bySrc = [...active].sort((a, b) => use[a.useId].y - use[b.useId].y);
      const startOf: Record<string, [number, number]> = {};
      bySrc.forEach((f) => {
        const o = srcOff[f.sourceId] ?? 0;
        const w = f.nominal * k;
        startOf[laneKey(f.sourceId, f.useId)] = [src[f.sourceId].y + o, src[f.sourceId].y + o + w];
        srcOff[f.sourceId] = o + w;
      });
      const byUse = [...active].sort((a, b) => src[a.sourceId].y - src[b.sourceId].y);
      byUse.forEach((f) => {
        const o = useOff[f.useId] ?? 0;
        const w = f.coverage * k;
        const key = laneKey(f.sourceId, f.useId);
        const [s0, s1] = startOf[key];
        ribbons.push({ key, sourceId: f.sourceId, useId: f.useId, s0, s1, u0: use[f.useId].y + o, u1: use[f.useId].y + o + w, nominal: f.nominal, coverage: f.coverage, unit: f.unitCostBps, reduced: f.reducedCostBps });
        useOff[f.useId] = o + w;
      });
    }
    const flowing = new Set(ribbons.map((r) => r.key));
    const idle = problem.lanes.filter((l) => !flowing.has(laneKey(l.sourceId, l.useId)));
    return { k, src, use, tierBands, ribbons, idle };
  }, [problem, feasible]);

  const sourceById = new Map(problem.sources.map((s) => [s.id, s]));
  const useById = new Map(problem.uses.map((u) => [u.id, u]));
  const shortIds = new Set(result.status === "infeasible" ? result.shortUses.map((u) => u.useId) : []);
  const exhausted = new Set(result.status === "infeasible" ? result.exhaustedSources : []);

  const related = (sourceId: string, useId: string) => {
    if (!hover) return true;
    if (hover.kind === "lane") return hover.key === laneKey(sourceId, useId);
    return hover.kind === "source" ? hover.id === sourceId : hover.id === useId;
  };

  const showTip = (event: React.MouseEvent | React.FocusEvent, lines: string[]) => {
    const host = (event.currentTarget as Element).closest("[data-network-host]")?.getBoundingClientRect();
    const rect = (event.currentTarget as Element).getBoundingClientRect();
    const x = "clientX" in event ? event.clientX : rect.left + rect.width / 2;
    const y = "clientY" in event ? event.clientY : rect.top;
    if (host) setTip({ x: x - host.left, y: y - host.top, flip: x - host.left > host.width * 0.6, lines });
  };
  const clear = () => { setHover(null); setTip(null); };

  const ribbonPath = (r: { s0: number; s1: number; u0: number; u1: number }) => {
    const x1 = SRC_X + NODE_W;
    const x2 = USE_X;
    const mx = (x1 + x2) / 2;
    return `M${x1},${r.s0} C${mx},${r.s0} ${mx},${r.u0} ${x2},${r.u0} L${x2},${r.u1} C${mx},${r.u1} ${mx},${r.s1} ${x1},${r.s1} Z`;
  };
  const centreLine = (r: { s0: number; s1: number; u0: number; u1: number }) => {
    const x1 = SRC_X + NODE_W;
    const x2 = USE_X;
    const mx = (x1 + x2) / 2;
    const a = (r.s0 + r.s1) / 2;
    const b = (r.u0 + r.u1) / 2;
    return `M${x1},${a} C${mx},${a} ${mx},${b} ${x2},${b}`;
  };

  return (
    <div className="relative" data-network-host onMouseLeave={clear}>
      <style>{`
        @keyframes sxu-flow { to { stroke-dashoffset: -28; } }
        .sxu-pulse { animation: sxu-flow 1.4s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .sxu-pulse { animation: none; } }
      `}</style>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Transport network of synthetic sources to uses. A table equivalent is shown in the transportation tableau.">
        <defs>
          <pattern id="sxu-short" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#FF3B3B" opacity="0.18" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#FF3B3B" strokeWidth="2" opacity="0.8" />
          </pattern>
        </defs>

        {/* Column captions */}
        <text x={SRC_X + NODE_W / 2} y={14} textAnchor="middle" className="fill-term-text-mute" fontSize={10} letterSpacing="0.18em">SOURCES · CAPACITY</text>
        <text x={USE_X + NODE_W / 2} y={14} textAnchor="middle" className="fill-term-text-mute" fontSize={10} letterSpacing="0.18em">USES · DEMAND</text>

        {/* Tier bands */}
        {geo.tierBands.map((band) => (
          <g key={band.tier}>
            <rect x={USE_X - 8} y={band.y0 - 5} width={W - USE_X + 2} height={band.y1 - band.y0 + 10} rx={4} fill="#ffffff" opacity={0.022} />
            <text x={W - 8} y={band.y0 - 8} fontSize={8.5} className="fill-term-text-mute" textAnchor="end" letterSpacing="0.14em">
              {`TIER ${band.tier}`}
            </text>
          </g>
        ))}

        {/* Idle (eligible, unused) lanes */}
        {geo.idle.map((l) => {
          const s = geo.src[l.sourceId];
          const u = geo.use[l.useId];
          if (!s || !u) return null;
          const on = related(l.sourceId, l.useId);
          return (
            <path key={laneKey(l.sourceId, l.useId)} d={centreLine({ s0: s.y + s.h / 2, s1: s.y + s.h / 2, u0: u.y + u.h / 2, u1: u.y + u.h / 2 })}
              fill="none" stroke="#5E5E66" strokeWidth={1} strokeDasharray="2 5" opacity={on ? (hover ? 0.9 : 0.45) : 0.08} />
          );
        })}

        {/* Flow ribbons */}
        {geo.ribbons.map((r) => {
          const src = sourceById.get(r.sourceId)!;
          const color = FAMILY_META[src.family].color;
          const on = related(r.sourceId, r.useId);
          const lines = [
            `${src.label} → ${useById.get(r.useId)!.label}`,
            `Nominal ${mm(r.nominal)} · coverage ${mm(r.coverage)}`,
            `Unit cost ${bps(r.unit, 1)} · haircut ${pct(src.haircutPct / 100)}`,
            `Reduced cost ${bps(r.reduced, 2)} (basic)`,
          ];
          return (
            <g key={r.key} opacity={on ? 1 : 0.1} style={{ transition: "opacity 160ms" }}>
              <path d={ribbonPath(r)} fill={color} opacity={hover && on ? 0.62 : 0.38}
                onMouseEnter={(e) => { setHover({ kind: "lane", key: r.key }); showTip(e, lines); }}
                onMouseMove={(e) => showTip(e, lines)} />
              <path d={centreLine(r)} fill="none" stroke={color} strokeWidth={Math.min(2, Math.max(1, (r.s1 - r.s0) / 6))}
                strokeDasharray="4 10" className="sxu-pulse pointer-events-none" opacity={0.9} />
            </g>
          );
        })}

        {/* Source nodes */}
        {problem.sources.map((s) => {
          const p = geo.src[s.id];
          const used = feasible?.sourceUsed[s.id] ?? 0;
          const usedH = s.amount > 0 ? (used / s.amount) * p.h : 0;
          const binding = feasible ? s.amount > 0 && s.amount - used < 1e-6 * Math.max(1, s.amount) : exhausted.has(s.id);
          const flag = feasible ? "BINDING" : "EXHAUSTED";
          const color = FAMILY_META[s.family].color;
          const lines = [
            s.label, `${FAMILY_META[s.family].label} · ${s.legalEntity}`,
            `Capacity ${mm(s.amount)} · used ${mm(used)}`,
            `Cost ${bps(s.costBps)} · haircut ${pct(s.haircutPct / 100)}`,
            ...(feasible ? [`Shadow price ${bps(feasible.capacityDualBps[s.id], 1)} per $ capacity`] : exhausted.has(s.id) ? ["Exhausted in elastic diagnostic"] : []),
          ];
          return (
            <g key={s.id} tabIndex={0} role="button" aria-label={lines.join(". ")} className="cursor-pointer outline-none"
              onMouseEnter={(e) => { setHover({ kind: "source", id: s.id }); showTip(e, lines); }}
              onFocus={(e) => { setHover({ kind: "source", id: s.id }); showTip(e, lines); }} onBlur={clear}>
              <rect x={SRC_X} y={p.y} width={NODE_W} height={p.h} rx={3} fill="#1A1A1D" stroke={binding ? "#FFB400" : "#26262B"} strokeWidth={binding ? 1.5 : 1} />
              <rect x={SRC_X} y={p.y} width={NODE_W} height={Math.max(0, usedH)} rx={3} fill={color} />
              <text x={SRC_X - 10} y={p.y + p.h / 2 - 3} textAnchor="end" fontSize={12} className="fill-term-text" fontWeight={600}>{s.short}</text>
              <text x={SRC_X - 10} y={p.y + p.h / 2 + 11} textAnchor="end" fontSize={10} className="fill-term-text-mute" fontFamily="var(--font-mono)">
                {binding && <tspan fill="#FFB400" fontSize={8} letterSpacing="0.12em">{`${flag} `}</tspan>}
                {feasible ? `${mm(used, 0)} / ${mm(s.amount, 0)}` : `cap ${mm(s.amount, 0)}`}
              </text>
            </g>
          );
        })}

        {/* Use nodes */}
        {problem.uses.map((u) => {
          const p = geo.use[u.id];
          const short = feasible?.shortfall[u.id] ?? 0;
          const shortH = u.amount > 0 ? (short / u.amount) * p.h : 0;
          const infeasibleGap = result.status === "infeasible" ? result.shortUses.find((x) => x.useId === u.id)?.gap ?? 0 : 0;
          const lines = [
            u.label, `${TIER_LABELS[u.tier]} · ${u.policy === "hard" ? "hard obligation" : `soft · penalty ${bps(u.penaltyBps)}`}`,
            `Demand ${mm(u.amount)}${feasible ? ` · covered ${mm(u.amount - short)}` : ""}`,
            ...(short > 1e-6 ? [`Shortfall ${mm(short)}`] : []),
            ...(feasible ? [`Marginal coverage cost ${bps(feasible.useDualBps[u.id], 1)}`] : []),
            ...(infeasibleGap > 0 ? [`Hard gap ${mm(infeasibleGap)} — cannot be covered`] : []),
          ];
          return (
            <g key={u.id} tabIndex={0} role="button" aria-label={lines.join(". ")} className="cursor-pointer outline-none"
              onMouseEnter={(e) => { setHover({ kind: "use", id: u.id }); showTip(e, lines); }}
              onFocus={(e) => { setHover({ kind: "use", id: u.id }); showTip(e, lines); }} onBlur={clear}>
              <rect x={USE_X} y={p.y} width={NODE_W} height={p.h} rx={3} fill={feasible ? "#E6E6E6" : "#1A1A1D"} opacity={feasible ? 0.85 : 1}
                stroke={shortIds.has(u.id) ? "#FF3B3B" : "#26262B"} strokeWidth={shortIds.has(u.id) ? 1.5 : 1} />
              {shortH > 0.5 && <rect x={USE_X} y={p.y + p.h - shortH} width={NODE_W} height={shortH} rx={2} fill="url(#sxu-short)" />}
              <text x={USE_X + NODE_W + 10} y={p.y + p.h / 2 - 3} fontSize={12} className="fill-term-text" fontWeight={600}>
                {u.short}{u.policy === "hard" ? " ◆" : ""}
              </text>
              <text x={USE_X + NODE_W + 10} y={p.y + p.h / 2 + 11} fontSize={10} fontFamily="var(--font-mono)" className={short > 1e-6 || infeasibleGap > 0 ? "fill-term-down" : "fill-term-text-mute"}>
                {short > 1e-6 ? `short ${mm(short, 0)}` : infeasibleGap > 0 ? `gap ${mm(infeasibleGap, 0)}` : mm(u.amount, 0)}
              </text>
            </g>
          );
        })}
      </svg>

      {tip && (
        <div className="pointer-events-none absolute z-10 max-w-[280px] rounded-md border border-term-border bg-term-panel-3/95 px-2.5 py-2 text-[11px] leading-snug text-term-text-dim shadow-panel backdrop-blur"
          style={{ left: tip.x + 14, top: tip.y + 14, transform: tip.flip ? "translateX(calc(-100% - 28px))" : undefined }}>
          <div className="mb-0.5 font-semibold text-term-text">{tip.lines[0]}</div>
          {tip.lines.slice(1).map((line) => <div key={line} className="font-mono text-[10px]">{line}</div>)}
        </div>
      )}
    </div>
  );
}
