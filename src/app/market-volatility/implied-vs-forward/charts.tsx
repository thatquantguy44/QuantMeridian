import { thin, zHistogram, type ForwardObservation } from "@/lib/vixImpliedForward";

const C = {
  grid: "#1F1F23",
  axis: "#5E5E66",
  text: "#C9C9D1",
  amber: "#FF8C00",
  blue: "#3B9DFF",
  up: "#2ECC71",
  down: "#FF3B3B",
  violet: "#A78BFA",
  panel: "#0A0A0A",
};
const MONO = "var(--font-mono)";

export function EmptyChart({ label, height = 260 }: { label: string; height?: number }) {
  return (
    <div style={{ height }} className="flex items-center justify-center border border-term-border-soft bg-term-panel-2 text-2xs uppercase tracking-wide text-term-text-mute">
      {label}
    </div>
  );
}

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

const path = (points: [number, number][]) => points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

function Legend({ items, x, y }: { items: { label: string; color: string; dash?: boolean; dot?: boolean }[]; x: number; y: number }) {
  let offset = 8;
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={0} y={0} width={items.reduce((w, item) => w + 30 + item.label.length * 5.6, 8)} height={18} fill={C.panel} opacity={0.78} />
      {items.map((item) => {
        const at = offset;
        offset += 30 + item.label.length * 5.6;
        return (
          <g key={item.label}>
            {item.dot
              ? <circle cx={at + 8} cy={9} r={3} fill={item.color} />
              : <line x1={at} x2={at + 18} y1={9} y2={9} stroke={item.color} strokeWidth={2} strokeDasharray={item.dash ? "4 3" : undefined} />}
            <text x={at + 23} y={12} fontSize={9} fill={C.text} fontFamily={MONO}>{item.label}</text>
          </g>
        );
      })}
    </g>
  );
}

const zColor = (z: number) => (Math.abs(z) <= 1 ? C.blue : Math.abs(z) <= 2 ? C.amber : C.down);

/** Implied 1σ move (x) against the realized 30-day return (y), with the ±1σ and ±2σ price cones. */
export function ImpliedScatter({ observations }: { observations: ForwardObservation[] }) {
  if (observations.length < 2) return <EmptyChart label="Not enough observations" height={320} />;
  const data = thin(observations, 2500);
  const W = 760, H = 320, padL = 46, padR = 14, padT = 12, padB = 30;
  const xMax = Math.max(...data.map((o) => o.impliedMovePct)) * 1.04;
  // The range follows the data; cone lines are clipped to it rather than stretching it.
  const yMin = Math.min(-5, Math.min(...data.map((o) => o.forwardReturnPct)) * 1.08);
  const yMax = Math.max(5, Math.max(...data.map((o) => o.forwardReturnPct)) * 1.08);
  const x = (v: number) => padL + (v / xMax) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);
  const cone = (k: number, sign: 1 | -1) => {
    const pts: [number, number][] = [];
    for (let s = 0; s <= xMax; s += xMax / 60) {
      const v = (Math.exp((sign * k * s) / 100) - 1) * 100;
      if (v >= yMin && v <= yMax) pts.push([x(s), y(v)]);
    }
    return path(pts);
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Scatter of VIX implied 30-day move against realized 30-day S&P 500 return">
      {niceTicks(yMin, yMax, 6).map((t) => (
        <g key={`y${t}`}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#3a3a40" : C.grid} />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill={C.axis} fontFamily={MONO}>{t}%</text>
        </g>
      ))}
      {niceTicks(0, xMax, 6).map((t) => (
        <text key={`x${t}`} x={x(t)} y={H - 16} textAnchor="middle" fontSize={9} fill={C.axis} fontFamily={MONO}>{t}%</text>
      ))}
      <text x={(padL + W - padR) / 2} y={H - 3} textAnchor="middle" fontSize={9} fill={C.axis} fontFamily={MONO}>VIX-implied 1σ 30-day move</text>
      {data.map((o) => (
        <circle key={o.date} cx={x(o.impliedMovePct)} cy={y(o.forwardReturnPct)} r={1.8} fill={zColor(o.z)} opacity={0.55} />
      ))}
      {[1, 2].map((k) => (
        <g key={k}>
          <path d={cone(k, 1)} fill="none" stroke={k === 1 ? C.up : C.violet} strokeWidth={1.5} strokeDasharray={k === 2 ? "5 3" : undefined} />
          <path d={cone(k, -1)} fill="none" stroke={k === 1 ? C.up : C.violet} strokeWidth={1.5} strokeDasharray={k === 2 ? "5 3" : undefined} />
        </g>
      ))}
      <Legend x={padL + 6} y={padT + 4} items={[
        { label: "±1σ", color: C.up }, { label: "±2σ", color: C.violet, dash: true },
        { label: "inside 1σ", color: C.blue, dot: true }, { label: "1–2σ", color: C.amber, dot: true }, { label: "beyond 2σ", color: C.down, dot: true },
      ]} />
    </svg>
  );
}

function yearTicks(startMs: number, endMs: number, x: (ms: number) => number) {
  const first = new Date(startMs).getUTCFullYear();
  const last = new Date(endMs).getUTCFullYear();
  const step = Math.max(1, Math.ceil((last - first + 1) / 8));
  const out: { label: string; x: number }[] = [];
  for (let yr = first + 1; yr <= last; yr += step) out.push({ label: String(yr), x: x(Date.UTC(yr, 0, 1)) });
  return out;
}

const ms = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** The ±1σ band implied on each date against the return that followed, through time. */
export function ConeTimeline({ observations }: { observations: ForwardObservation[] }) {
  if (observations.length < 2) return <EmptyChart label="Not enough observations" />;
  const data = thin(observations, 900);
  const W = 760, H = 260, padL = 46, padR = 14, padT = 12, padB = 22;
  const t0 = ms(data[0].date), t1 = ms(data[data.length - 1].date);
  const up = data.map((o) => (Math.exp(o.impliedMovePct / 100) - 1) * 100);
  const down = data.map((o) => (Math.exp(-o.impliedMovePct / 100) - 1) * 100);
  const yMax = Math.max(...up, ...data.map((o) => o.forwardReturnPct)) * 1.05;
  const yMin = Math.min(...down, ...data.map((o) => o.forwardReturnPct)) * 1.05;
  const x = (t: number) => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - padT - padB);
  const band = `${path(data.map((o, i) => [x(ms(o.date)), y(up[i])]))} ${data.map((o, i) => `L${x(ms(o.date)).toFixed(1)},${y(down[i]).toFixed(1)}`).reverse().join(" ")} Z`;
  const breaches = data.filter((o) => Math.abs(o.z) > 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Implied one-sigma band through time with realized 30-day returns">
      {niceTicks(yMin, yMax, 6).map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#3a3a40" : C.grid} />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill={C.axis} fontFamily={MONO}>{t}%</text>
        </g>
      ))}
      {yearTicks(t0, t1, x).map((tick) => (
        <text key={tick.label} x={tick.x} y={H - 7} textAnchor="middle" fontSize={9} fill={C.axis} fontFamily={MONO}>{tick.label}</text>
      ))}
      <path d={band} fill={C.up} opacity={0.12} stroke="none" />
      <path d={path(data.map((o) => [x(ms(o.date)), y(o.forwardReturnPct)]))} fill="none" stroke={C.text} strokeWidth={0.8} opacity={0.8} />
      {breaches.map((o) => <circle key={o.date} cx={x(ms(o.date))} cy={y(o.forwardReturnPct)} r={1.6} fill={o.z > 0 ? C.amber : C.down} />)}
      <Legend x={padL + 6} y={padT + 4} items={[
        { label: "implied ±1σ band", color: C.up }, { label: "realized 30d return", color: C.text },
        { label: "outside band", color: C.down, dot: true },
      ]} />
    </svg>
  );
}

/** VIX against the volatility actually realized over the next 30 days, both in vol points. */
export function VolTimeline({ observations }: { observations: ForwardObservation[] }) {
  if (observations.length < 2) return <EmptyChart label="Not enough observations" />;
  const data = thin(observations, 900);
  const W = 760, H = 260, padL = 40, padR = 14, padT = 12, padB = 22;
  const t0 = ms(data[0].date), t1 = ms(data[data.length - 1].date);
  const yMax = Math.max(...data.flatMap((o) => [o.vix, o.realizedVolPct])) * 1.05;
  const x = (t: number) => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / (yMax || 1)) * (H - padT - padB);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="VIX against subsequent realized volatility">
      {niceTicks(0, yMax, 5).map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={C.grid} />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill={C.axis} fontFamily={MONO}>{t}</text>
        </g>
      ))}
      {yearTicks(t0, t1, x).map((tick) => (
        <text key={tick.label} x={tick.x} y={H - 7} textAnchor="middle" fontSize={9} fill={C.axis} fontFamily={MONO}>{tick.label}</text>
      ))}
      <path d={path(data.map((o) => [x(ms(o.date)), y(o.realizedVolPct)]))} fill="none" stroke={C.blue} strokeWidth={1} opacity={0.85} />
      <path d={path(data.map((o) => [x(ms(o.date)), y(o.vix)]))} fill="none" stroke={C.amber} strokeWidth={1.3} />
      <Legend x={padL + 6} y={padT + 4} items={[{ label: "VIX (implied)", color: C.amber }, { label: "next-30d realized vol", color: C.blue }]} />
    </svg>
  );
}

/** Distribution of moves in implied standard deviations, against the standard normal. */
export function ZHistogram({ observations }: { observations: ForwardObservation[] }) {
  if (observations.length < 2) return <EmptyChart label="Not enough observations" />;
  const bins = zHistogram(observations);
  const W = 520, H = 260, padL = 40, padR = 10, padT = 12, padB = 30;
  const yMax = Math.max(...bins.flatMap((b) => [b.count, b.normal])) * 1.08 || 1;
  const bw = (W - padL - padR) / bins.length;
  const x = (k: number) => padL + k * bw;
  const y = (v: number) => padT + (1 - v / yMax) * (H - padT - padB);
  const normalPath = path(bins.map((b, k) => [x(k) + bw / 2, y(b.normal)]));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Histogram of standardized 30-day moves against a normal distribution">
      {niceTicks(0, yMax, 4).map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={C.grid} />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill={C.axis} fontFamily={MONO}>{t}</text>
        </g>
      ))}
      {bins.map((b, k) => (
        <rect key={b.lo} x={x(k) + 1} y={y(b.count)} width={bw - 2} height={Math.max(0, H - padB - y(b.count))}
          fill={Math.abs(b.lo + 0.25) <= 1 ? C.blue : Math.abs(b.lo + 0.25) <= 2 ? C.amber : C.down} opacity={0.7}>
          <title>{`${b.lo.toFixed(1)}σ to ${b.hi.toFixed(1)}σ: ${b.count} observed, ${b.normal.toFixed(0)} normal`}</title>
        </rect>
      ))}
      <path d={normalPath} fill="none" stroke={C.text} strokeWidth={1.4} strokeDasharray="4 3" />
      {[-4, -3, -2, -1, 0, 1, 2, 3, 4].map((z) => (
        <text key={z} x={padL + ((z + 4) / 8) * (W - padL - padR)} y={H - 16} textAnchor="middle" fontSize={9} fill={C.axis} fontFamily={MONO}>{z === -4 ? "≤−4" : z === 4 ? "≥4" : z}</text>
      ))}
      <text x={(padL + W - padR) / 2} y={H - 3} textAnchor="middle" fontSize={9} fill={C.axis} fontFamily={MONO}>30-day log move ÷ implied 1σ</text>
      <Legend x={padL + 6} y={padT + 4} items={[{ label: "observed", color: C.blue, dot: true }, { label: "normal", color: C.text, dash: true }]} />
    </svg>
  );
}

/** Mean forward return and mean realized ÷ implied per VIX bucket. */
export function BucketBars({ buckets }: { buckets: { label: string; meanForwardReturnPct: number; n: number }[] }) {
  if (!buckets.length) return <EmptyChart label="No buckets" height={180} />;
  const W = 520, H = 180, padL = 40, padR = 10, padT = 10, padB = 30;
  const vals = buckets.map((b) => b.meanForwardReturnPct);
  const yMax = Math.max(0, ...vals) * 1.15 || 1;
  const yMin = Math.min(0, ...vals) * 1.15;
  const bw = (W - padL - padR) / buckets.length;
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - padT - padB);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Mean 30-day forward return by VIX bucket">
      {niceTicks(yMin, yMax, 4).map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#3a3a40" : C.grid} />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill={C.axis} fontFamily={MONO}>{t}%</text>
        </g>
      ))}
      {buckets.map((b, k) => {
        const top = y(Math.max(0, b.meanForwardReturnPct)), bottom = y(Math.min(0, b.meanForwardReturnPct));
        return (
          <g key={b.label}>
            <rect x={padL + k * bw + bw * 0.18} y={top} width={bw * 0.64} height={Math.max(1, bottom - top)} fill={b.meanForwardReturnPct >= 0 ? C.up : C.down} opacity={0.75}>
              <title>{`${b.label}: mean ${b.meanForwardReturnPct.toFixed(2)}%, n ${b.n}`}</title>
            </rect>
            <text x={padL + k * bw + bw / 2} y={H - 16} textAnchor="middle" fontSize={8.5} fill={C.axis} fontFamily={MONO}>{b.label.replace(/^Q(\d) · .*/, "Q$1")}</text>
            <text x={padL + k * bw + bw / 2} y={H - 5} textAnchor="middle" fontSize={8} fill={C.axis} fontFamily={MONO}>n {b.n}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Running sum of (benchmark squared error − model squared error): rising means the model keeps beating the historical mean. */
export function AdvantageChart({ points }: { points: { date: string; vix_raw: number; vix_calibrated: number; trailing: number }[] }) {
  if (points.length < 2) return <EmptyChart label="Not enough out-of-sample windows" />;
  const data = thin(points, 700);
  const W = 760, H = 260, padL = 52, padR = 14, padT = 12, padB = 22;
  const t0 = ms(data[0].date), t1 = ms(data[data.length - 1].date);
  const all = data.flatMap((p) => [p.vix_raw, p.vix_calibrated, p.trailing, 0]);
  const yMin = Math.min(...all), yMax = Math.max(...all);
  const x = (t: number) => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - padT - padB);
  const line = (key: "vix_raw" | "vix_calibrated" | "trailing") => path(data.map((p) => [x(ms(p.date)), y(p[key])]));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Cumulative out-of-sample advantage over the historical mean volatility forecast">
      {niceTicks(yMin, yMax, 5).map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#3a3a40" : C.grid} />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill={C.axis} fontFamily={MONO}>{t}</text>
        </g>
      ))}
      {yearTicks(t0, t1, x).map((tick) => (
        <text key={tick.label} x={tick.x} y={H - 7} textAnchor="middle" fontSize={9} fill={C.axis} fontFamily={MONO}>{tick.label}</text>
      ))}
      <path d={line("trailing")} fill="none" stroke={C.violet} strokeWidth={1.2} />
      <path d={line("vix_raw")} fill="none" stroke={C.amber} strokeWidth={1.5} />
      <path d={line("vix_calibrated")} fill="none" stroke={C.blue} strokeWidth={1.5} strokeDasharray="5 3" />
      <Legend x={padL + 6} y={padT + 4} items={[{ label: "VIX as quoted", color: C.amber }, { label: "VIX recalibrated", color: C.blue, dash: true }, { label: "trailing vol", color: C.violet }]} />
    </svg>
  );
}
