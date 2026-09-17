
import { useEffect, useRef, useState } from "react";
import { fmtAbbr } from "@/lib/format";

export interface WaterfallStep {
  label: string;
  value: number; // signed; positive = up, negative = down
  total?: boolean; // render as absolute bar from 0 (start/end)
}

interface WaterfallProps {
  steps: WaterfallStep[];
  height?: number;
  fmt?: (n: number) => string;
  className?: string;
}

/**
 * Revenue / P&L waterfall (bridge) chart.
 *
 * The viewBox width tracks the container's actual rendered pixel width (via
 * ResizeObserver) so the SVG is never non-uniformly stretched — a fixed
 * viewBox stretched with preserveAspectRatio="none" scales text/strokes
 * horizontally more than vertically, which reads as blurry.
 */
export function Waterfall({ steps, height = 220, fmt = (n) => fmtAbbr(n), className }: WaterfallProps) {
  const containerRef = useRef<HTMLDivElement>(null);
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

  const W = width;
  const H = height;
  const padB = 26;
  const padT = 20;
  // compute running cumulative
  let run = 0;
  const bars = steps.map((s) => {
    if (s.total) {
      const base = 0;
      const top = s.value;
      run = s.value;
      return { base, top, value: s.value, label: s.label, isTotal: true };
    }
    const base = run;
    run += s.value;
    return { base, top: run, value: s.value, label: s.label, isTotal: false };
  });
  const allVals = bars.flatMap((b) => [b.base, b.top, 0]);
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 1;
  const y = (v: number) => padT + (1 - (v - min) / range) * (H - padT - padB);
  const step = W / steps.length;
  const bw = Math.min(step * 0.6, 120);

  return (
    <div ref={containerRef} style={{ width: "100%", height }}>
      <svg viewBox={`0 0 ${W} ${H}`} className={className} style={{ width: "100%", height }}>
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="#26262B" strokeWidth={1} />
        {bars.map((b, i) => {
          const x = i * step + (step - bw) / 2;
          const yTop = y(Math.max(b.base, b.top));
          const h = Math.abs(y(b.base) - y(b.top)) || 1;
          const fill = b.isTotal ? "#FF8C00" : b.value >= 0 ? "#2ECC71" : "#FF3B3B";
          return (
            <g key={i}>
              <rect x={x} y={yTop} width={bw} height={h} fill={fill} opacity={0.88} />
              <text x={x + bw / 2} y={yTop - 6} textAnchor="middle" fontSize={10} fill="#9A9AA3" fontFamily="var(--font-mono)">
                {b.value >= 0 && !b.isTotal ? "+" : ""}
                {fmt(b.value)}
              </text>
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={9.5} fill="#8A8A92" fontFamily="var(--font-mono)">
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
