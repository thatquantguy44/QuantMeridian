
import { useId } from "react";

export interface Series {
  name: string;
  data: number[];
  color: string;
  area?: boolean;
  dashed?: boolean;
}

interface LineChartProps {
  series: Series[];
  height?: number;
  labels?: string[];
  yFmt?: (n: number) => string;
  grid?: boolean;
  className?: string;
}

/** Multi-series time-series line/area chart with grid + axis labels. */
export function LineChart({ series, height = 200, labels, yFmt, grid = true, className }: LineChartProps) {
  const id = useId();
  const W = 600;
  const H = height;
  const padL = 48;
  const padB = 18;
  const padT = 8;
  const padR = 8;
  const all = series.flatMap((s) => s.data).filter(Number.isFinite);

  // No plottable points (a failed or empty source): say so instead of drawing NaN axis ticks.
  if (all.length === 0) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className={className} preserveAspectRatio="none" style={{ width: "100%", minWidth: 420, height }} role="img" aria-label="No data">
        <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={11} fill="#5E5E66" fontFamily="var(--font-mono)">
          No data available
        </text>
      </svg>
    );
  }

  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const n = Math.max(...series.map((s) => s.data.length));
  // A single point has no span to spread over; centre-left it instead of dividing by zero.
  const x = (i: number) => (n > 1 ? padL + (i / (n - 1)) * (W - padL - padR) : padL);
  const y = (v: number) => padT + (1 - (v - min) / range) * (H - padT - padB);

  const yticks = 4;
  const lines = Array.from({ length: yticks + 1 }, (_, i) => min + (range * i) / yticks);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} preserveAspectRatio="none" style={{ width: "100%", minWidth: 420, height }}>
      {grid &&
        lines.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#1F1F23" strokeWidth={1} />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#5E5E66" fontFamily="var(--font-mono)">
              {yFmt ? yFmt(v) : v.toFixed(1)}
            </text>
          </g>
        ))}
      {labels &&
        labels.map((l, i) =>
          i % Math.ceil(labels.length / 6) === 0 ? (
            <text key={i} x={x(i)} y={H - 4} textAnchor="middle" fontSize={9} fill="#5E5E66" fontFamily="var(--font-mono)">
              {l}
            </text>
          ) : null
        )}
      {series.map((s, si) => {
        // Non-finite points break the line rather than poisoning the whole path with NaN.
        let pen = "M";
        const d = s.data
          .map((v, i) => {
            if (!Number.isFinite(v)) {
              pen = "M";
              return "";
            }
            const seg = `${pen}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
            pen = "L";
            return seg;
          })
          .filter(Boolean)
          .join(" ");
        const areaD = `${d} L${x(s.data.length - 1)},${y(min)} L${x(0)},${y(min)} Z`;
        return (
          <g key={si}>
            {s.area && (
              <>
                <defs>
                  <linearGradient id={`${id}-g${si}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <path d={areaD} fill={`url(#${id}-g${si})`} />
              </>
            )}
            <path d={d} fill="none" stroke={s.color} strokeWidth={1.5} strokeDasharray={s.dashed ? "4 3" : undefined} strokeLinejoin="round" />
          </g>
        );
      })}
    </svg>
  );
}
