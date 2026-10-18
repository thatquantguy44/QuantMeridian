import { useMemo, useState } from "react";
import {
  FAMILY_META, idlePenalty, laneKey, shortfallPenalty,
  type SimProblem, type SimResult,
} from "@/data/sourcesUsesSynthetic";
import { bps, mm, pct } from "./format";

const W = 1000;
const H = 640;
const PAD_Y = 28;
const NODE_W = 14;
const SRC_X = 214;
const USE_X = W - 214 - NODE_W;
const GAP = 9;
const TIER_GAP = 22;
const SLOT_MIN = 32;
const DUMMY_SRC = "__shortfall";
const DUMMY_USE = "__idle";

type Hover = { kind: "source" | "use"; id: string } | { kind: "lane"; key: string } | null;
type Kind = "flow" | "short" | "idle";

interface Placed { y: number; h: number }
interface Ribbon { key: string; kind: Kind; from: string; to: string; s0: number; s1: number; u0: number; u1: number; lines: string[]; color: string }

/**
 * Balanced transport network. Ribbons start at the nominal width on the source
 * side and taper to haircut-adjusted coverage on the use side. The dummy
 * "unmet demand" supply node and "idle capacity" demand node close the balance,
 * as in the textbook transportation tableau.
 */
export function TransportNetwork({ problem, result }: { problem: SimProblem; result: SimResult }) {
  const [hover, setHover] = useState<Hover>(null);
  const [tip, setTip] = useState<{ x: number; y: number; flip: boolean; lines: string[] } | null>(null);
  const feasible = result.status === "optimal" ? result : null;

  const geo = useMemo(() => {
    const totalShort = feasible ? Object.values(feasible.shortfall).reduce((a, v) => a + v, 0) : 0;
    const totalIdle = feasible ? Object.values(feasible.idle).reduce((a, v) => a + v, 0) : 0;
    const srcNodes = [...problem.sources.map((s) => ({ id: s.id, amount: Math.max(0, s.amount) })), ...(totalShort > 1e-6 ? [{ id: DUMMY_SRC, amount: totalShort }] : [])];
    const tiers = [...new Set(problem.uses.map((u) => u.tier))].sort((a, b) => a - b);
    const groups: { label: string; ids: { id: string; amount: number }[] }[] = tiers.map((tier) => ({
      label: `TIER ${tier}`, ids: problem.uses.filter((u) => u.tier === tier).map((u) => ({ id: u.id, amount: u.amount })),
    }));
    if (totalIdle > 1e-6) groups.push({ label: "DUMMY SINK", ids: [{ id: DUMMY_USE, amount: totalIdle }] });
    const useNodes = groups.flatMap((g) => g.ids);

    const srcAvail = H - PAD_Y * 2 - GAP * (srcNodes.length - 1) - (totalShort > 1e-6 ? TIER_GAP : 0);
    const useAvail = H - PAD_Y * 2 - GAP * (useNodes.length - 1) - TIER_GAP * (groups.length - 1);
    // Each node gets a slot of at least SLOT_MIN so its two-line label never collides.
    const fit = (amounts: number[], avail: number) => {
      let k = avail / Math.max(amounts.reduce((a, v) => a + v, 0), 1);
      for (let pass = 0; pass < 3; pass++) {
        const big = amounts.filter((v) => v * k >= SLOT_MIN);
        k = (avail - (amounts.length - big.length) * SLOT_MIN) / Math.max(big.reduce((a, v) => a + v, 0), 1);
      }
      return k;
    };
    const k = Math.min(fit(srcNodes.map((n) => n.amount), srcAvail), fit(useNodes.map((n) => n.amount), useAvail));
    const slot = (v: number) => Math.max(SLOT_MIN, v * k);

    const pos: Record<string, Placed> = {};
    const srcSpan = srcNodes.reduce((a, n) => a + slot(n.amount), 0);
    let y = PAD_Y + Math.max(0, (srcAvail - srcSpan) / 2);
    srcNodes.forEach((n) => {
      if (n.id === DUMMY_SRC) y += TIER_GAP - GAP;
      const h = Math.max(4, n.amount * k);
      const sl = slot(n.amount);
      pos[`s:${n.id}`] = { y: y + (sl - h) / 2, h };
      y += sl + GAP;
    });
    const bands: { label: string; y0: number; y1: number }[] = [];
    const useSpan = useNodes.reduce((a, n) => a + slot(n.amount), 0);
    y = PAD_Y + Math.max(0, (useAvail - useSpan) / 2);
    groups.forEach((g, gi) => {
      if (gi > 0) y += TIER_GAP - GAP;
      const y0 = y;
      g.ids.forEach((n) => {
        const h = Math.max(4, n.amount * k);
        const sl = slot(n.amount);
        pos[`u:${n.id}`] = { y: y + (sl - h) / 2, h };
        y += sl + GAP;
      });
      bands.push({ label: g.label, y0, y1: y - GAP });
    });

    const ribbons: Ribbon[] = [];
    if (feasible) {
      const srcOff: Record<string, number> = {};
      const useOff: Record<string, number> = {};
      const uy = (id: string) => pos[`u:${id}`].y;
      const sy = (id: string) => pos[`s:${id}`].y;
      type Edge = { kind: Kind; from: string; to: string; out: number; in: number; lines: string[]; color: string };
      const edges: Edge[] = [];
      feasible.flows.filter((f) => f.nominal > 1e-6).forEach((f) => {
        const s = problem.sources.find((x) => x.id === f.sourceId)!;
        const u = problem.uses.find((x) => x.id === f.useId)!;
        edges.push({
          kind: "flow", from: f.sourceId, to: f.useId, out: f.nominal, in: f.coverage, color: FAMILY_META[s.family].color,
          lines: [
            `${s.label} → ${u.label}`,
            `Nominal ${mm(f.nominal)} · coverage ${mm(f.coverage)}`,
            `Unit cost ${bps(f.cost.total, 1)} (source ${bps(f.cost.base)} + penalties ${bps(f.cost.total - f.cost.base, 1)})`,
            ...(f.excess > 1e-6 ? [`Above concentration threshold ${mm(f.excess)}`] : []),
          ],
        });
      });
      problem.uses.forEach((u) => {
        const v = feasible.shortfall[u.id];
        if (v > 1e-6) edges.push({ kind: "short", from: DUMMY_SRC, to: u.id, out: v, in: v, color: "#FF3B3B", lines: [`Unmet demand → ${u.label}`, `Shortfall ${mm(v)}`, `Penalty ${bps(shortfallPenalty(feasible.config, u))} per $`] });
      });
      problem.sources.forEach((s) => {
        const v = feasible.idle[s.id];
        if (v > 1e-6) edges.push({ kind: "idle", from: s.id, to: DUMMY_USE, out: v, in: v, color: "#8A8A93", lines: [`${s.label} → idle capacity`, `Idle ${mm(v)}`, `Idle penalty ${bps(idlePenalty(feasible.config, s))} per $`] });
      });
      // Real flows first on each node (dummy flows sit at the bottom), ordered to minimise crossings.
      const order = (kind: Kind) => (kind === "flow" ? 0 : 1);
      const starts: Record<string, [number, number]> = {};
      [...edges].sort((a, b) => order(a.kind) - order(b.kind) || uy(a.to) - uy(b.to)).forEach((e) => {
        const o = srcOff[e.from] ?? 0;
        starts[`${e.from}>${e.to}`] = [sy(e.from) + o, sy(e.from) + o + e.out * k];
        srcOff[e.from] = o + e.out * k;
      });
      [...edges].sort((a, b) => order(a.kind) - order(b.kind) || sy(a.from) - sy(b.from)).forEach((e) => {
        const o = useOff[e.to] ?? 0;
        const [s0, s1] = starts[`${e.from}>${e.to}`];
        ribbons.push({ key: `${e.from}>${e.to}`, kind: e.kind, from: e.from, to: e.to, s0, s1, u0: uy(e.to) + o, u1: uy(e.to) + o + e.in * k, lines: e.lines, color: e.color });
        useOff[e.to] = o + e.in * k;
      });
    }
    const flowing = new Set(ribbons.map((r) => r.key));
    const idleLanes = problem.lanes.filter((l) => !flowing.has(laneKey(l.sourceId, l.useId)));
    return { pos, bands, ribbons, idleLanes, totalShort, totalIdle, hasDummySrc: totalShort > 1e-6 };
  }, [problem, feasible]);

  const shortIds = new Set(result.status === "infeasible" ? result.shortUses.map((u) => u.useId) : []);
  const exhausted = new Set(result.status === "infeasible" ? result.exhaustedSources : []);

  const related = (from: string, to: string) => {
    if (!hover) return true;
    if (hover.kind === "lane") return hover.key === `${from}>${to}`;
    return hover.kind === "source" ? hover.id === from : hover.id === to;
  };

  const showTip = (event: React.MouseEvent | React.FocusEvent, lines: string[]) => {
    const host = (event.currentTarget as Element).closest("[data-network-host]")?.getBoundingClientRect();
    const rect = (event.currentTarget as Element).getBoundingClientRect();
    const x = "clientX" in event ? event.clientX : rect.left + rect.width / 2;
    const y = "clientY" in event ? event.clientY : rect.top;
    if (host) setTip({ x: x - host.left, y: y - host.top, flip: x - host.left > host.width * 0.6, lines });
  };
  const clear = () => { setHover(null); setTip(null); };

  const x1 = SRC_X + NODE_W;
  const x2 = USE_X;
  const mx = (x1 + x2) / 2;
  const ribbonPath = (r: { s0: number; s1: number; u0: number; u1: number }) =>
    `M${x1},${r.s0} C${mx},${r.s0} ${mx},${r.u0} ${x2},${r.u0} L${x2},${r.u1} C${mx},${r.u1} ${mx},${r.s1} ${x1},${r.s1} Z`;
  const centreLine = (a: number, b: number) => `M${x1},${a} C${mx},${a} ${mx},${b} ${x2},${b}`;

  const nodeEvents = (kind: "source" | "use", id: string, lines: string[]) => ({
    tabIndex: 0, role: "button" as const, "aria-label": lines.join(". "), className: "cursor-pointer outline-none",
    onMouseEnter: (e: React.MouseEvent) => { setHover({ kind, id }); showTip(e, lines); },
    onFocus: (e: React.FocusEvent) => { setHover({ kind, id }); showTip(e, lines); },
    onBlur: clear,
  });

  return (
    <div className="relative" data-network-host onMouseLeave={clear}>
      <style>{`
        @keyframes sxu-flow { to { stroke-dashoffset: -28; } }
        .sxu-pulse { animation: sxu-flow 1.4s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .sxu-pulse { animation: none; } }
      `}</style>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Balanced transportation network of synthetic sources to uses, with dummy shortfall and idle nodes. The transportation tableau is the table equivalent.">
        <defs>
          <pattern id="sxu-short" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#FF3B3B" opacity="0.18" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#FF3B3B" strokeWidth="2" opacity="0.8" />
          </pattern>
          <pattern id="sxu-idle" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(135)">
            <rect width="6" height="6" fill="#8A8A93" opacity="0.12" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#8A8A93" strokeWidth="1.5" opacity="0.6" />
          </pattern>
        </defs>

        <text x={SRC_X + NODE_W / 2} y={14} textAnchor="middle" className="fill-term-text-mute" fontSize={10} letterSpacing="0.18em">SUPPLY · SOURCES</text>
        <text x={USE_X + NODE_W / 2} y={14} textAnchor="middle" className="fill-term-text-mute" fontSize={10} letterSpacing="0.18em">DEMAND · USES</text>

        {geo.bands.map((band) => (
          <g key={band.label}>
            <rect x={USE_X - 8} y={band.y0 - 5} width={W - USE_X + 2} height={band.y1 - band.y0 + 10} rx={4} fill="#ffffff" opacity={0.022} />
            <text x={W - 8} y={band.y0 - 8} fontSize={8.5} className="fill-term-text-mute" textAnchor="end" letterSpacing="0.14em">{band.label}</text>
          </g>
        ))}

        {geo.idleLanes.map((l) => {
          const s = geo.pos[`s:${l.sourceId}`];
          const u = geo.pos[`u:${l.useId}`];
          if (!s || !u) return null;
          const on = related(l.sourceId, l.useId);
          return <path key={laneKey(l.sourceId, l.useId)} d={centreLine(s.y + s.h / 2, u.y + u.h / 2)} fill="none" stroke="#5E5E66" strokeWidth={1} strokeDasharray="2 5" opacity={on ? (hover ? 0.9 : 0.4) : 0.08} />;
        })}

        {geo.ribbons.map((r) => {
          const on = related(r.from, r.to);
          const fill = r.kind === "short" ? "url(#sxu-short)" : r.kind === "idle" ? "url(#sxu-idle)" : r.color;
          return (
            <g key={r.key} opacity={on ? 1 : 0.1} style={{ transition: "opacity 160ms" }}>
              <path d={ribbonPath(r)} fill={fill} opacity={r.kind === "flow" ? (hover && on ? 0.62 : 0.38) : 0.9}
                onMouseEnter={(e) => { setHover({ kind: "lane", key: r.key }); showTip(e, r.lines); }}
                onMouseMove={(e) => showTip(e, r.lines)} />
              {r.kind === "flow" && <path d={centreLine((r.s0 + r.s1) / 2, (r.u0 + r.u1) / 2)} fill="none" stroke={r.color} strokeWidth={Math.min(2, Math.max(1, (r.s1 - r.s0) / 6))} strokeDasharray="4 10" className="sxu-pulse pointer-events-none" opacity={0.9} />}
            </g>
          );
        })}

        {problem.sources.map((s) => {
          const p = geo.pos[`s:${s.id}`];
          const used = feasible?.sourceUsed[s.id] ?? 0;
          const usedH = s.amount > 0 ? (used / s.amount) * p.h : 0;
          const binding = feasible ? s.amount > 0 && s.amount - used < 1e-6 * Math.max(1, s.amount) : exhausted.has(s.id);
          const flag = feasible ? "BINDING" : "EXHAUSTED";
          const lines = [
            s.label, `${FAMILY_META[s.family].label} · ${s.legalEntity} · ${s.tenorDays}d`,
            `Capacity ${mm(s.amount)} · used ${mm(used)}`,
            `Cost ${bps(s.costBps)} · haircut ${pct(s.haircutPct / 100)}`,
            ...(feasible ? [`Shadow price ${bps(feasible.capacityDualBps[s.id], 1)} per $ capacity`] : exhausted.has(s.id) ? ["Exhausted in elastic diagnostic"] : []),
            ...(feasible && feasible.minDrawGap[s.id] > 1e-6 ? [`Below minimum draw by ${mm(feasible.minDrawGap[s.id])}`] : []),
          ];
          return (
            <g key={s.id} {...nodeEvents("source", s.id, lines)}>
              <rect x={SRC_X} y={p.y} width={NODE_W} height={p.h} rx={3} fill="url(#sxu-idle)" stroke={binding ? "#FFB400" : "#26262B"} strokeWidth={binding ? 1.5 : 1} />
              <rect x={SRC_X} y={p.y} width={NODE_W} height={Math.max(0, usedH)} rx={3} fill={FAMILY_META[s.family].color} />
              <text x={SRC_X - 10} y={p.y + p.h / 2 - 3} textAnchor="end" fontSize={12} className="fill-term-text" fontWeight={600}>{s.short}</text>
              <text x={SRC_X - 10} y={p.y + p.h / 2 + 11} textAnchor="end" fontSize={10} className="fill-term-text-mute" fontFamily="var(--font-mono)">
                {binding && <tspan fill="#FFB400" fontSize={8} letterSpacing="0.12em">{`${flag} `}</tspan>}
                {feasible ? `${mm(used, 0)} / ${mm(s.amount, 0)}` : `cap ${mm(s.amount, 0)}`}
              </text>
            </g>
          );
        })}

        {geo.hasDummySrc && (() => {
          const p = geo.pos[`s:${DUMMY_SRC}`];
          const lines = ["Dummy supply · unmet demand", `Total shortfall ${mm(geo.totalShort)}`, "Priced at each use's shortfall penalty"];
          return (
            <g {...nodeEvents("source", DUMMY_SRC, lines)}>
              <rect x={SRC_X} y={p.y} width={NODE_W} height={p.h} rx={3} fill="url(#sxu-short)" stroke="#FF3B3B" strokeDasharray="3 2" />
              <text x={SRC_X - 10} y={p.y + p.h / 2 - 3} textAnchor="end" fontSize={12} className="fill-term-down" fontWeight={600}>Unmet demand</text>
              <text x={SRC_X - 10} y={p.y + p.h / 2 + 11} textAnchor="end" fontSize={10} className="fill-term-text-mute" fontFamily="var(--font-mono)">dummy · {mm(geo.totalShort, 0)}</text>
            </g>
          );
        })()}

        {problem.uses.map((u) => {
          const p = geo.pos[`u:${u.id}`];
          const short = feasible?.shortfall[u.id] ?? 0;
          const infeasibleGap = result.status === "infeasible" ? result.shortUses.find((x) => x.useId === u.id)?.gap ?? 0 : 0;
          const lines = [
            u.label, `Tier ${u.tier} · ${u.policy === "hard" ? "hard obligation" : `soft · shortfall ${bps(feasible ? shortfallPenalty(feasible.config, u) : u.penaltyBps)}`} · ${u.tenorDays}d`,
            `Demand ${mm(u.amount)}${feasible ? ` · covered ${mm(u.amount - short)}` : ""}`,
            ...(short > 1e-6 ? [`Shortfall ${mm(short)}`] : []),
            ...(feasible ? [`Marginal coverage cost ${bps(feasible.useDualBps[u.id], 1)}`] : []),
            ...(infeasibleGap > 0 ? [`Hard gap ${mm(infeasibleGap)}: cannot be covered`] : []),
          ];
          const shortH = u.amount > 0 ? (short / u.amount) * p.h : 0;
          return (
            <g key={u.id} {...nodeEvents("use", u.id, lines)}>
              <rect x={USE_X} y={p.y} width={NODE_W} height={p.h} rx={3} fill={feasible ? "#E6E6E6" : "#1A1A1D"} opacity={feasible ? 0.85 : 1}
                stroke={shortIds.has(u.id) ? "#FF3B3B" : "#26262B"} strokeWidth={shortIds.has(u.id) ? 1.5 : 1} />
              {shortH > 0.5 && <rect x={USE_X} y={p.y + p.h - shortH} width={NODE_W} height={shortH} rx={2} fill="url(#sxu-short)" />}
              <text x={USE_X + NODE_W + 10} y={p.y + p.h / 2 - 3} fontSize={12} className="fill-term-text" fontWeight={600}>{u.short}{u.policy === "hard" ? " ◆" : ""}</text>
              <text x={USE_X + NODE_W + 10} y={p.y + p.h / 2 + 11} fontSize={10} fontFamily="var(--font-mono)" className={short > 1e-6 || infeasibleGap > 0 ? "fill-term-down" : "fill-term-text-mute"}>
                {short > 1e-6 ? `short ${mm(short, 0)}` : infeasibleGap > 0 ? `gap ${mm(infeasibleGap, 0)}` : mm(u.amount, 0)}
              </text>
            </g>
          );
        })}

        {geo.totalIdle > 1e-6 && feasible && (() => {
          const p = geo.pos[`u:${DUMMY_USE}`];
          const lines = ["Dummy demand · idle capacity", `Total idle ${mm(geo.totalIdle)}`, "Priced at each source's idle penalty"];
          return (
            <g {...nodeEvents("use", DUMMY_USE, lines)}>
              <rect x={USE_X} y={p.y} width={NODE_W} height={p.h} rx={3} fill="url(#sxu-idle)" stroke="#8A8A93" strokeDasharray="3 2" />
              <text x={USE_X + NODE_W + 10} y={p.y + p.h / 2 - 3} fontSize={12} className="fill-term-text-dim" fontWeight={600}>Idle capacity</text>
              <text x={USE_X + NODE_W + 10} y={p.y + p.h / 2 + 11} fontSize={10} fontFamily="var(--font-mono)" className="fill-term-text-mute">dummy · {mm(geo.totalIdle, 0)}</text>
            </g>
          );
        })()}
      </svg>

      {tip && (
        <div className="pointer-events-none absolute z-10 max-w-[300px] rounded-md border border-term-border bg-term-panel-3/95 px-2.5 py-2 text-[11px] leading-snug text-term-text-dim shadow-panel backdrop-blur"
          style={{ left: tip.x + 14, top: tip.y + 14, transform: tip.flip ? "translateX(calc(-100% - 28px))" : undefined }}>
          <div className="mb-0.5 font-semibold text-term-text">{tip.lines[0]}</div>
          {tip.lines.slice(1).map((line) => <div key={line} className="font-mono text-[10px]">{line}</div>)}
        </div>
      )}
    </div>
  );
}
