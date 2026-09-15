
import { useEffect, useMemo, useState } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { fmtNum, fmtSigned } from "@/lib/format";

interface HorizonPercentiles {
  horizonDays: number;
  byTenor: Record<string, { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number }>;
}

interface Var1Fit {
  coefficients: number[][];
  rSquared: number[];
  lastFactors: [number, number, number];
  avgLambda: number;
  fitObservations: number;
  fitStartDate: string;
  fitEndDate: string;
}

interface McsResult {
  fit: Var1Fit;
  config: { numPaths: number; horizonDays: number; checkpoints: number[]; tenors: number[] };
  horizons: HorizonPercentiles[];
  currentCurve: Record<string, number>;
}

interface McsResponse {
  source: string;
  ok: boolean;
  error?: string;
  asOf?: string;
  result: McsResult | null;
}

const TENOR_LABELS: Record<string, string> = { "2": "2Y", "5": "5Y", "10": "10Y", "30": "30Y" };
const HORIZON_LABELS: Record<number, string> = { 21: "1M", 63: "3M", 126: "6M", 252: "12M" };
const FACTOR_LABELS = ["β0 (level)", "β1 (slope)", "β2 (curvature)"];

function useMcs(fitYears: number, paths: number) {
  const [data, setData] = useState<McsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/simulations/mcs?fitYears=${fitYears}&paths=${paths}`)
      .then((r) => r.json())
      .then((j) => { if (alive) { setData(j); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [fitYears, paths]);

  return { data, loading };
}

/** Percentile-band fan chart: p5-p95 outer band, p25-p75 inner band, median line, current-yield anchor. */
function FanChart({ horizons, tenor, current }: { horizons: HorizonPercentiles[]; tenor: string; current: number }) {
  const W = 600;
  const H = 220;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 24;

  const points = horizons.map((h) => h.byTenor[tenor]).filter(Boolean);
  if (points.length === 0) return <div className="p-3 text-2xs text-term-text-dim">No simulation data for this tenor.</div>;

  const allVals = [current, ...points.flatMap((p) => [p.p5, p.p95])];
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const pad = (maxV - minV) * 0.1 || 0.25;
  const lo = minV - pad;
  const hi = maxV + pad;
  const range = hi - lo || 1;

  const xStops = [0, ...horizons.map((h) => h.horizonDays)];
  const xMax = Math.max(...xStops);
  const x = (d: number) => padL + (d / xMax) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / range) * (H - padT - padB);

  const band = (getTop: (p: (typeof points)[0]) => number, getBot: (p: (typeof points)[0]) => number) => {
    const top = [`M${x(0).toFixed(1)},${y(current).toFixed(1)}`, ...points.map((p, i) => `L${x(horizons[i].horizonDays).toFixed(1)},${y(getTop(p)).toFixed(1)}`)];
    const bottom = [...points.map((p, i) => `L${x(horizons[points.length - 1 - i].horizonDays).toFixed(1)},${y(getBot(points[points.length - 1 - i])).toFixed(1)}`), `L${x(0).toFixed(1)},${y(current).toFixed(1)}`];
    return [...top, ...bottom, "Z"].join(" ");
  };

  const yticks = 4;
  const ticks = Array.from({ length: yticks + 1 }, (_, i) => lo + (range * i) / yticks);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }} preserveAspectRatio="none">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} stroke="var(--term-border, #232329)" strokeWidth={1} strokeDasharray="2,3" />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill="#9A9AA3" fontFamily="var(--font-mono)">{t.toFixed(2)}</text>
        </g>
      ))}
      <path d={band((p) => p.p95, (p) => p.p5)} fill="rgba(59,157,255,0.10)" />
      <path d={band((p) => p.p75, (p) => p.p25)} fill="rgba(59,157,255,0.22)" />
      <polyline
        points={[`${x(0)},${y(current)}`, ...points.map((p, i) => `${x(horizons[i].horizonDays)},${y(p.p50)}`)].join(" ")}
        fill="none" stroke="#3B9DFF" strokeWidth={1.75}
      />
      <circle cx={x(0)} cy={y(current)} r={3.5} fill="#FF8C00" />
      {points.map((p, i) => (
        <circle key={i} cx={x(horizons[i].horizonDays)} cy={y(p.p50)} r={2.5} fill="#3B9DFF" />
      ))}
      {[0, ...horizons.map((h) => h.horizonDays)].map((d, i) => (
        <text key={i} x={x(d)} y={H - 6} textAnchor="middle" fontSize={9} fill="#9A9AA3" fontFamily="var(--font-mono)">
          {d === 0 ? "now" : HORIZON_LABELS[d] ?? `${d}d`}
        </text>
      ))}
      <text x={4} y={10} fontSize={8} fill="#9A9AA3" fontFamily="var(--font-mono)">Yield %</text>
    </svg>
  );
}

export default function McsPage() {
  const [fitYears, setFitYears] = useState(10);
  const [tenor, setTenor] = useState("10");
  const { data, loading } = useMcs(fitYears, 2000);

  const result = data?.result ?? null;
  const source = data?.ok ? "DB" : "ERR";

  const h12m = useMemo(() => result?.horizons.find((h) => h.horizonDays === 252) ?? null, [result]);
  const currentTenorYield = result?.currentCurve[tenor] ?? 0;

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="MCS"
        title="Monte Carlo Curve Simulation"
        desc="VAR(1) factor bootstrap over the Gold Nelson-Siegel curve — forward yield distributions by tenor and horizon"
        asOf={data?.asOf ?? null}
        showStreaming={false}
        right={<ProvenanceBadge source={source} />}
      />

      <div className="flex flex-wrap items-center gap-3 border-b border-term-border bg-term-panel-2 px-3 py-1.5 text-2xs">
        <label className="flex items-center gap-1.5 text-term-text-dim">
          Fit window
          <select
            className="rounded-sm border border-term-border bg-term-panel px-1.5 py-0.5 text-term-text"
            value={fitYears}
            onChange={(e) => setFitYears(Number(e.target.value))}
          >
            {[5, 10, 15, 20].map((y) => <option key={y} value={y}>{y}y</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-term-text-dim">
          Tenor
          <select
            className="rounded-sm border border-term-border bg-term-panel px-1.5 py-0.5 text-term-text"
            value={tenor}
            onChange={(e) => setTenor(e.target.value)}
          >
            {Object.entries(TENOR_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {result && (
          <span className="ml-auto text-3xs text-term-text-mute">
            {result.config.numPaths.toLocaleString()} paths · fit {result.fit.fitStartDate} → {result.fit.fitEndDate} ({result.fit.fitObservations.toLocaleString()} obs)
          </span>
        )}
      </div>

      {!data?.ok && !loading && (
        <div className="p-3 text-2xs text-term-down">
          {data?.error ?? "Unable to load simulation."}
        </div>
      )}

      {loading && <div className="p-3 text-2xs text-term-text-dim">Fitting VAR(1) and simulating paths…</div>}

      {result && (
        <>
          <KpiStrip>
            <Stat label={`Current ${TENOR_LABELS[tenor]}`} value={`${fmtNum(currentTenorYield, 2)}%`} />
            <Stat
              label="12M median"
              value={h12m ? `${fmtNum(h12m.byTenor[tenor].p50, 2)}%` : "—"}
              sub={h12m ? fmtSigned(h12m.byTenor[tenor].p50 - currentTenorYield, 2) + "pp" : undefined}
              tone={h12m && h12m.byTenor[tenor].p50 > currentTenorYield ? "up" : "down"}
            />
            <Stat
              label="12M 90% range"
              value={h12m ? `${fmtNum(h12m.byTenor[tenor].p5, 2)} – ${fmtNum(h12m.byTenor[tenor].p95, 2)}%` : "—"}
            />
            <Stat label="Fit R² (level)" value={fmtNum(result.fit.rSquared[0], 3)} />
            <Stat label="Fit R² (slope)" value={fmtNum(result.fit.rSquared[1], 3)} />
            <Stat label="Avg λ (decay)" value={fmtNum(result.fit.avgLambda, 2)} />
          </KpiStrip>

          <div className="grid flex-1 grid-cols-1 gap-2 p-2 lg:grid-cols-[2fr_1fr]">
            <Panel title={`Forward curve distribution — ${TENOR_LABELS[tenor]}`} code="FAN" subtitle="p5–p95 shaded, median line, current yield anchor">
              <div className="p-2">
                <FanChart horizons={result.horizons} tenor={tenor} current={currentTenorYield} />
              </div>
              <div className="flex flex-wrap gap-3 border-t border-term-border-soft px-3 py-1.5 text-3xs text-term-text-mute">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: "rgba(59,157,255,0.22)" }} />P25–P75</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: "rgba(59,157,255,0.10)" }} />P5–P95</span>
                <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-[#3B9DFF]" />Median path</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-term-amber" />Current</span>
              </div>
            </Panel>

            <Panel title="Percentile table" code="PCT" subtitle={TENOR_LABELS[tenor]}>
              <table className="w-full text-2xs">
                <thead>
                  <tr className="border-b border-term-border text-term-text-mute">
                    <th className="p-1.5 text-left">Horizon</th>
                    <th className="p-1.5 text-right">P5</th>
                    <th className="p-1.5 text-right">P50</th>
                    <th className="p-1.5 text-right">P95</th>
                  </tr>
                </thead>
                <tbody>
                  {result.horizons.map((h) => (
                    <tr key={h.horizonDays} className="border-b border-term-border-soft">
                      <td className="p-1.5 font-mono">{HORIZON_LABELS[h.horizonDays] ?? `${h.horizonDays}d`}</td>
                      <td className="tnum p-1.5 text-right">{fmtNum(h.byTenor[tenor].p5, 2)}</td>
                      <td className="tnum p-1.5 text-right font-semibold">{fmtNum(h.byTenor[tenor].p50, 2)}</td>
                      <td className="tnum p-1.5 text-right">{fmtNum(h.byTenor[tenor].p95, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <Panel title="VAR(1) diagnostics" code="VAR" className="lg:col-span-2">
              <table className="w-full text-2xs">
                <thead>
                  <tr className="border-b border-term-border text-term-text-mute">
                    <th className="p-1.5 text-left">Equation</th>
                    <th className="p-1.5 text-right">Intercept</th>
                    <th className="p-1.5 text-right">β0(t-1)</th>
                    <th className="p-1.5 text-right">β1(t-1)</th>
                    <th className="p-1.5 text-right">β2(t-1)</th>
                    <th className="p-1.5 text-right">R²</th>
                  </tr>
                </thead>
                <tbody>
                  {result.fit.coefficients.map((row, i) => (
                    <tr key={i} className="border-b border-term-border-soft">
                      <td className="p-1.5 font-mono">{FACTOR_LABELS[i]}</td>
                      {row.map((c, j) => <td key={j} className="tnum p-1.5 text-right">{fmtNum(c, 4)}</td>)}
                      <td className="tnum p-1.5 text-right">{fmtNum(result.fit.rSquared[i], 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </div>

          <div className="border-t border-term-border bg-term-panel px-3 py-1.5 text-3xs text-term-text-mute">
            <span className="text-term-amber">MCS</span> — VAR(1) fit on {result.fit.fitObservations.toLocaleString()} daily
            observations of the Gold NS factors ({fitYears}y trailing window); forward paths drawn by joint residual
            bootstrap ({result.config.numPaths.toLocaleString()} paths), not an assumed Gaussian. Tail percentiles
            reflect one historical sample — regimes that occurred rarely (or once) in the fit window will be
            under-represented in the p5/p95 bands. <Tag tone="amber" className="ml-1">Model output, not a forecast</Tag>
          </div>
        </>
      )}
    </div>
  );
}
