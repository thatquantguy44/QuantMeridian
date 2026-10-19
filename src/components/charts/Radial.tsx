
/** Donut and gauge primitives for utilization / allocation displays. */

export function Donut({
  segments,
  size = 120,
  thickness = 16,
  center,
  centerSub,
}: {
  segments: { value: number; color: string; label?: string }[];
  size?: number;
  thickness?: number;
  center?: string;
  centerSub?: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1A1A1D" strokeWidth={thickness} />
        {segments.map((s, i) => {
          const len = (s.value / total) * c;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
            />
          );
          offset += len;
          return el;
        })}
      </g>
      {center && (
        <text x={size / 2} y={size / 2 - 1} textAnchor="middle" dominantBaseline="middle" fontSize={size / 6} fill="#E6E6E6" fontFamily="var(--font-mono)" fontWeight={700}>
          {center}
        </text>
      )}
      {centerSub && (
        <text x={size / 2} y={size / 2 + size / 8} textAnchor="middle" dominantBaseline="middle" fontSize={size / 12} fill="#9A9AA3" fontFamily="var(--font-mono)">
          {centerSub}
        </text>
      )}
    </svg>
  );
}

/**
 * Gauge color band. By default higher is worse (amber from `warn`, red from `danger`). With
 * `higherIsBetter` (for example liquidity ratios) red is below `danger`, amber below `warn`.
 */
export function gaugeColor(value: number, { danger, warn, higherIsBetter = false }: { danger: number; warn: number; higherIsBetter?: boolean }): string {
  if (higherIsBetter) return value < danger ? "#FF3B3B" : value < warn ? "#FF8C00" : "#2ECC71";
  return value >= danger ? "#FF3B3B" : value >= warn ? "#FF8C00" : "#2ECC71";
}

export function Gauge({ value, max = 100, size = 120, label, danger = 90, warn = 75, higherIsBetter = false }: { value: number; max?: number; size?: number; label?: string; danger?: number; warn?: number; higherIsBetter?: boolean }) {
  const pct = Math.max(0, Math.min(1, value / max));
  const r = size / 2 - 10;
  const cx = size / 2;
  const cy = size / 2 + 6;
  const startA = Math.PI;
  const endA = 0;
  const a = startA + (endA - startA) * pct;
  const arc = (from: number, to: number) => {
    const x1 = cx + r * Math.cos(from);
    const y1 = cy + r * Math.sin(from);
    const x2 = cx + r * Math.cos(to);
    const y2 = cy + r * Math.sin(to);
    const large = Math.abs(to - from) > Math.PI ? 1 : 0;
    return `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2}`;
  };
  const color = gaugeColor(value, { danger, warn, higherIsBetter });
  return (
    <svg width={size} height={size * 0.7} viewBox={`0 0 ${size} ${size * 0.7}`}>
      <path d={arc(startA, endA)} fill="none" stroke="#1A1A1D" strokeWidth={9} strokeLinecap="round" />
      <path d={arc(startA, a)} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" />
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize={size / 6} fill={color} fontFamily="var(--font-mono)" fontWeight={700}>
        {value.toFixed(0)}
        {max === 100 ? "%" : ""}
      </text>
      {label && (
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize={size / 14} fill="#5E5E66" fontFamily="var(--font-mono)">
          {label}
        </text>
      )}
    </svg>
  );
}

export function ProgressBar({ value, max = 100, color = "#FF8C00", height = 6, showPct }: { value: number; max?: number; color?: string; height?: number; showPct?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 bg-term-panel-3" style={{ height }}>
        <div className="absolute inset-y-0 left-0 transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      {showPct && <span className="tnum w-9 text-right text-2xs text-term-text-dim">{pct.toFixed(0)}%</span>}
    </div>
  );
}
