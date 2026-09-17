
import { useState, useRef, useCallback, useEffect } from "react";
import { fmtSignedPct } from "@/lib/format";

export interface TreeCell {
  label: string;
  weight: number;
  value: number; // colored by this (e.g. % change)
  group?: string;
}

interface TreemapProps {
  cells: TreeCell[];
  height?: number;
  className?: string;
  maxAbs?: number;
}

function color(v: number, maxAbs: number): string {
  const t = Math.max(-1, Math.min(1, v / (maxAbs || 1)));
  if (t >= 0) return `rgba(46,204,113,${(0.18 + t * 0.62).toFixed(3)})`;
  return `rgba(255,59,59,${(0.18 + -t * 0.62).toFixed(3)})`;
}

interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
  cell: TreeCell;
}

interface Tooltip {
  label: string;
  value: number;
  group?: string;
  weight: number;
  px: number;
  py: number;
}

/**
 * Squarified-ish treemap (slice-and-dice rows) with optional group labels.
 *
 * Layout runs in real pixel space (W = measured container width via
 * ResizeObserver, H = the `height` prop) rather than an abstract 0-100
 * square — stretching a square viewBox to fit an arbitrary rectangle via
 * preserveAspectRatio="none" scales text/strokes horizontally more than
 * vertically, which reads as blurry and also distorts cell proportions.
 */
export function Treemap({ cells, height = 260, className, maxAbs = 4 }: TreemapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tooltip | null>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const hasGroups = cells.some((c) => c.group);

  const grouped = hasGroups
    ? Array.from(
        cells.reduce((m, c) => {
          const g = c.group ?? "";
          if (!m.has(g)) m.set(g, []);
          m.get(g)!.push(c);
          return m;
        }, new Map<string, TreeCell[]>()),
      )
        .map(([group, items]) => ({ group, items, weight: items.reduce((a, c) => a + c.weight, 0) }))
        .sort((a, b) => b.weight - a.weight)
    : [{ group: "", items: [...cells].sort((a, b) => b.weight - a.weight), weight: cells.reduce((a, c) => a + c.weight, 0) }];

  const total = grouped.reduce((a, g) => a + g.weight, 0) || 1;
  const W = width;
  const H = height;

  const out: LayoutRect[] = [];
  const groupBounds: { x: number; y: number; w: number; h: number; group: string }[] = [];

  const groupTarget = total / Math.ceil(Math.sqrt(grouped.length));
  const gRows: typeof grouped[] = [];
  let gRow: typeof grouped = [];
  let gRowSum = 0;
  for (const g of grouped) {
    gRow.push(g);
    gRowSum += g.weight;
    if (gRowSum >= groupTarget) {
      gRows.push(gRow);
      gRow = [];
      gRowSum = 0;
    }
  }
  if (gRow.length) gRows.push(gRow);

  const gRowWeights = gRows.map((r) => r.reduce((a, g) => a + g.weight, 0));
  const gRowTotal = gRowWeights.reduce((a, b) => a + b, 0) || 1;

  let gy = 0;
  for (let gi = 0; gi < gRows.length; gi++) {
    const grh = (gRowWeights[gi] / gRowTotal) * H;
    let gx = 0;
    const grw = gRowWeights[gi] || 1;
    for (const group of gRows[gi]) {
      const gcw = (group.weight / grw) * W;
      if (hasGroups && group.group) {
        groupBounds.push({ x: gx, y: gy, w: gcw, h: grh, group: group.group });
      }

      const sorted = [...group.items].sort((a, b) => b.weight - a.weight);
      const cellTotal = sorted.reduce((a, c) => a + c.weight, 0) || 1;
      const cellTarget = cellTotal / Math.ceil(Math.sqrt(sorted.length));
      const cRows: TreeCell[][] = [];
      let cRow: TreeCell[] = [];
      let cRowSum = 0;
      for (const c of sorted) {
        cRow.push(c);
        cRowSum += c.weight;
        if (cRowSum >= cellTarget) {
          cRows.push(cRow);
          cRow = [];
          cRowSum = 0;
        }
      }
      if (cRow.length) cRows.push(cRow);

      const cRowWeights = cRows.map((r) => r.reduce((a, c) => a + c.weight, 0));
      const cRowTotal = cRowWeights.reduce((a, b) => a + b, 0) || 1;

      let cy = gy;
      for (let ci = 0; ci < cRows.length; ci++) {
        const crh = (cRowWeights[ci] / cRowTotal) * grh;
        let cx = gx;
        const crw = cRowWeights[ci] || 1;
        for (const cell of cRows[ci]) {
          const cw = (cell.weight / crw) * gcw;
          out.push({ x: cx, y: cy, w: cw, h: crh, cell });
          cx += cw;
        }
        cy += crh;
      }
      gx += gcw;
    }
    gy += grh;
  }

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    const my = ((e.clientY - rect.top) / rect.height) * H;
    const hit = out.find((o) => mx >= o.x && mx <= o.x + o.w && my >= o.y && my <= o.y + o.h);
    if (hit) {
      setTip({
        label: hit.cell.label,
        value: hit.cell.value,
        group: hit.cell.group,
        weight: hit.cell.weight,
        px: e.clientX - rect.left,
        py: e.clientY - rect.top,
      });
    } else {
      setTip(null);
    }
  }, [out]);

  const handleMouseLeave = useCallback(() => setTip(null), []);

  return (
    <div ref={containerRef} className="relative" style={{ height }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className={className}
        style={{ width: "100%", height: "100%" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {out.map((o, i) => {
          const showLabel = o.w > 40 && o.h > 18;
          const showPct = o.w > 40 && o.h > 32;
          const showGroup = Boolean(o.cell.group) && o.w > 50 && o.h > 46;
          const cx = o.x + o.w / 2;
          const cy = o.y + o.h / 2;
          const labelY = showGroup ? cy - 8 : showPct ? cy - 4 : cy + 4;
          const pctY = showGroup ? cy + 7 : cy + 11;
          const groupY = cy + 19;
          return (
            <g key={i}>
              <rect
                x={o.x}
                y={o.y}
                width={o.w}
                height={o.h}
                fill={color(o.cell.value, maxAbs)}
                stroke="#0A0A0A"
                strokeWidth={1}
              />
              {showLabel && (
                <text
                  x={cx}
                  y={labelY}
                  textAnchor="middle"
                  fontSize={Math.min(13, o.w / 6)}
                  fill="#fff"
                  fontFamily="var(--font-mono)"
                  fontWeight={600}
                  style={{ pointerEvents: "none" }}
                >
                  {o.cell.label}
                </text>
              )}
              {showPct && (
                <text
                  x={cx}
                  y={pctY}
                  textAnchor="middle"
                  fontSize={Math.min(11, o.w / 7)}
                  fill="rgba(255,255,255,0.85)"
                  fontFamily="var(--font-mono)"
                  fontWeight={500}
                  style={{ pointerEvents: "none" }}
                >
                  {fmtSignedPct(o.cell.value, 1)}
                </text>
              )}
              {showGroup && (
                <text
                  x={cx}
                  y={groupY}
                  textAnchor="middle"
                  fontSize={Math.min(9, o.w / 10)}
                  fill="rgba(255,255,255,0.4)"
                  fontFamily="var(--font-mono)"
                  style={{ pointerEvents: "none" }}
                >
                  {o.cell.group}
                </text>
              )}
            </g>
          );
        })}
        <defs>
          {groupBounds.map((gb, i) => (
            <clipPath key={`clip-${i}`} id={`gclip-${i}`}>
              <rect x={gb.x} y={gb.y} width={gb.w} height={gb.h} />
            </clipPath>
          ))}
        </defs>
        {groupBounds.map((gb, i) => (
          <g key={`g-${i}`}>
            <rect x={gb.x} y={gb.y} width={gb.w} height={gb.h} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            {gb.w > 60 && gb.h > 20 && (
              <text
                x={gb.x + 4}
                y={gb.y + 13}
                fontSize={Math.min(10, gb.w / 14)}
                fill="rgba(255,255,255,0.55)"
                fontFamily="var(--font-mono)"
                fontWeight={600}
                clipPath={`url(#gclip-${i})`}
                style={{ pointerEvents: "none" }}
              >
                {gb.group}
              </text>
            )}
          </g>
        ))}
      </svg>
      {tip && (
        <div
          className="pointer-events-none absolute z-50 rounded border border-term-border bg-term-panel-2 px-2.5 py-1.5 shadow-lg"
          style={{
            left: Math.min(tip.px + 12, (containerRef.current?.clientWidth ?? 300) - 160),
            top: tip.py < height / 2 ? tip.py + 12 : tip.py - 70,
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-term-amber">{tip.label}</span>
            {tip.group && <span className="text-3xs text-term-text-mute">{tip.group}</span>}
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className={`text-sm font-semibold tnum ${tip.value >= 0 ? "text-term-up" : "text-term-down"}`}>
              {fmtSignedPct(tip.value, 2)}
            </span>
            <span className="text-3xs text-term-text-mute">
              {(tip.weight * 100).toFixed(1)}% weight
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
