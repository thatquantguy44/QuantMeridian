import { useState } from "react";
import { FAMILY_META, type Family, type RunAnalytics } from "@/data/mmkt";

const FAMILIES: Family[] = ["government", "secured", "bank", "credit"];
const CASH_COLOR = "#5E5E66";
const fmt = (v: number, dp = 0) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const shortDay = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

/**
 * Balance composition by day: invested holdings stacked by instrument family, with
 * uninvested cash on top (neutral). The total height is the account balance.
 */
export function HoldingsChart({ analytics }: { analytics: RunAnalytics }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 260, L = 48, R = 12, T = 12, B = 28;
  const data = analytics.holdings;
  const max = Math.max(1, ...data.map((d) => d.invested + Math.max(0, d.cash)));
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, data.length - 1);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const layers = [...FAMILIES, "cash" as const];
  const stackAt = (i: number, upTo: number) => {
    let s = 0;
    for (let k = 0; k < upTo; k++) {
      const key = layers[k];
      s += key === "cash" ? Math.max(0, data[i].cash) : data[i].byFamily[key];
    }
    return s;
  };
  const ticks = niceTicks(max);
  const h = hover !== null ? data[hover] : null;
  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Daily balance by instrument family and cash, $mm. The allocation table is the table equivalent.">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#1F1F23" />
            <text x={L - 6} y={y(t) + 3} textAnchor="end" fontSize={9} className="fill-term-text-mute" fontFamily="var(--font-mono)">{fmt(t)}</text>
          </g>
        ))}
        {layers.map((key, k) => {
          const top = data.map((_, i) => `${x(i)},${y(stackAt(i, k + 1))}`);
          const bottom = data.map((_, i) => `${x(i)},${y(stackAt(i, k))}`).reverse();
          return <polygon key={key} points={[...top, ...bottom].join(" ")} fill={key === "cash" ? CASH_COLOR : FAMILY_META[key].color} opacity={key === "cash" ? 0.35 : 0.85} stroke="#0F0F10" strokeWidth={1} />;
        })}
        {data.map((d, i) => (
          <text key={d.day} x={x(i)} y={H - 10} textAnchor="middle" fontSize={9} className="fill-term-text-mute" fontFamily="var(--font-mono)">{shortDay(d.day)}</text>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="#9A9AA3" strokeDasharray="3 3" />}
        {data.map((_, i) => (
          <rect key={i} x={x(i) - (W - L - R) / data.length / 2} y={T} width={(W - L - R) / data.length} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-2 z-10 rounded-md border border-term-border bg-term-panel-3/95 px-2.5 py-2 text-[11px] shadow-panel" style={{ left: `${(x(hover!) / W) * 100}%`, transform: hover! > data.length / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}>
          <div className="mb-1 font-semibold text-term-text">{h.day}</div>
          {FAMILIES.map((f) => (
            <div key={f} className="flex items-center justify-between gap-4 font-mono text-[10px] text-term-text-dim">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: FAMILY_META[f].color }} />{FAMILY_META[f].label}</span>{fmt(h.byFamily[f], 1)}
            </div>
          ))}
          <div className="flex items-center justify-between gap-4 font-mono text-[10px] text-term-text-dim"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[#5E5E66]" />Cash</span>{fmt(h.cash, 1)}</div>
        </div>
      )}
      <Legend />
    </div>
  );
}

export function Legend() {
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-term-text-mute">
      {FAMILIES.map((f) => <span key={f} className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: FAMILY_META[f].color }} />{FAMILY_META[f].label}</span>)}
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#5E5E66]" />Uninvested cash</span>
    </div>
  );
}

/** Entity cash against its liquidity floor (small multiples, one per entity). */
export function FloorChart({ analytics, entity, label }: { analytics: RunAnalytics; entity: string; label: string }) {
  const pts = analytics.floorHeadroom.filter((f) => f.entity === entity);
  if (!pts.length) return null;
  const W = 520, H = 170, L = 40, R = 10, T = 10, B = 22;
  const max = Math.max(1, ...pts.map((p) => Math.max(p.cash, p.floor))) * 1.08;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, pts.length - 1);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const binding = pts.filter((p) => p.headroom < 1e-6).length;
  return (
    <figure>
      <figcaption className="mb-1 flex items-baseline justify-between text-[10px]">
        <span className="font-semibold text-term-text">{label}</span>
        <span className="font-mono text-term-text-mute">{binding} of {pts.length} days at floor</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${label}: cash versus liquidity floor by day`}>
        {niceTicks(max).map((t) => (
          <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#1F1F23" /><text x={L - 4} y={y(t) + 3} textAnchor="end" fontSize={8} className="fill-term-text-mute" fontFamily="var(--font-mono)">{fmt(t)}</text></g>
        ))}
        <polyline points={pts.map((p, i) => `${x(i)},${y(p.floor)}`).join(" ")} fill="none" stroke="#FF3B3B" strokeWidth={1.5} strokeDasharray="4 3" />
        <polyline points={pts.map((p, i) => `${x(i)},${y(p.cash)}`).join(" ")} fill="none" stroke="#E6E6E6" strokeWidth={2} />
        {pts.map((p, i) => (
          <circle key={p.day} cx={x(i)} cy={y(p.cash)} r={3.5} fill={p.headroom < 1e-6 ? "#FFB400" : "#0F0F10"} stroke="#E6E6E6" strokeWidth={1.5}>
            <title>{`${p.day}: cash ${fmt(p.cash, 1)} vs floor ${fmt(p.floor, 1)} (headroom ${fmt(p.headroom, 1)})`}</title>
          </circle>
        ))}
        {pts.map((p, i) => <text key={p.day} x={x(i)} y={H - 6} textAnchor="middle" fontSize={8} className="fill-term-text-mute" fontFamily="var(--font-mono)">{shortDay(p.day)}</text>)}
      </svg>
      <div className="mt-0.5 flex gap-3 text-[9px] text-term-text-mute">
        <span className="flex items-center gap-1"><span className="w-3 border-t-2 border-term-text" />Cash</span>
        <span className="flex items-center gap-1"><span className="w-3 border-t-2 border-dashed border-term-down" />Floor</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-term-gold" />At floor (binding)</span>
      </div>
    </figure>
  );
}

/** Holdings still outstanding at horizon end, by time to maturity. */
export function MaturityLadder({ analytics }: { analytics: RunAnalytics }) {
  const max = Math.max(1, ...analytics.ladder.map((l) => l.amount));
  return (
    <div>
      <ul className="space-y-2" aria-label="Maturity ladder of holdings outstanding at horizon end">
        {analytics.ladder.map((l) => (
          <li key={l.bucket} className="grid grid-cols-[64px_minmax(0,1fr)_64px] items-center gap-2">
            <span className="font-mono text-[10px] text-term-text-dim">{l.bucket}</span>
            <div className="h-[12px]"><div className="h-full rounded-r-[3px] bg-term-amber/85" style={{ width: `${(l.amount / max) * 100}%` }} /></div>
            <span className="text-right font-mono text-[10px] text-term-text">{l.amount > 1e-6 ? fmt(l.amount, 1) : "—"}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 border-t border-term-border pt-2 text-[10px] text-term-text-mute">
        Outstanding after horizon end: <span className="font-mono text-term-text">{fmt(analytics.heldAtEnd, 1)}</span> $mm. Buckets are days from horizon end to maturity, and the total reconciles to allocations maturing after the horizon.
      </p>
    </div>
  );
}

/** Normalized yield curve of the selected snapshot (priced rows only). */
export function YieldBars({ rows, labels }: { rows: { instrument_id: string; mm_yield_pct: number | null; status: string }[]; labels: Record<string, string> }) {
  const priced = rows.filter((r) => r.status === "ok" && r.mm_yield_pct !== null).sort((a, b) => b.mm_yield_pct! - a.mm_yield_pct!);
  if (!priced.length) return null;
  const lo = Math.min(...priced.map((r) => r.mm_yield_pct!)) - 0.15;
  const hi = Math.max(...priced.map((r) => r.mm_yield_pct!));
  return (
    <ul className="space-y-1" aria-label="Normalized money-market yields, highest first">
      {priced.map((r) => (
        <li key={r.instrument_id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_48px] items-center gap-2" title={labels[r.instrument_id] ?? r.instrument_id}>
          <span className="truncate text-[10px] text-term-text-dim">{labels[r.instrument_id] ?? r.instrument_id}</span>
          <div className="h-[8px]"><div className="h-full rounded-r-[3px] bg-term-blue/80" style={{ width: `${((r.mm_yield_pct! - lo) / (hi - lo)) * 100}%` }} /></div>
          <span className="text-right font-mono text-[10px] text-term-text">{r.mm_yield_pct!.toFixed(3)}</span>
        </li>
      ))}
    </ul>
  );
}

function niceTicks(max: number): number[] {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}
