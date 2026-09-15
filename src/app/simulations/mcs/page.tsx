
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
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

interface FomcAnchorDiagnostics {
  anchorTenor: number;
  taperYears: number;
  byHorizon: Record<string, { fomcImpliedRate: number; preAnchorMedian: number; shiftBps: number; monthsOut: number; reliable: boolean }>;
}

interface McsResult {
  fit: Var1Fit;
  config: { numPaths: number; horizonDays: number; checkpoints: number[]; tenors: number[]; regimeFilter?: string };
  horizons: HorizonPercentiles[];
  currentCurve: Record<string, number>;
  shockPoolSize: number;
  sparseRegime: boolean;
  fomcAnchor?: FomcAnchorDiagnostics;
}

interface McsResponse {
  source: string;
  ok: boolean;
  error?: string;
  asOf?: string;
  regimeFilter: string | null;
  currentRegime: string | null;
  regimeCounts: Record<string, number>;
  fomcAnchorApplied: boolean;
  fomcAnchorSkippedReason: string | null;
  result: McsResult | null;
}

const TENOR_LABELS: Record<string, string> = { "0.25": "3M", "2": "2Y", "5": "5Y", "10": "10Y", "30": "30Y" };
const HORIZON_LABELS: Record<number, string> = { 21: "1M", 63: "3M", 126: "6M", 252: "12M" };
const FACTOR_LABELS = ["β0 (level)", "β1 (slope)", "β2 (curvature)"];
/** Fixed display order — matches the desk's regime vocabulary (macro_regime_daily.regime_name). */
const REGIME_ORDER = ["Neutral", "Goldilocks", "Reflation", "Growth-Scare", "Policy-Easing", "Liquidity-Squeeze", "Stagflation"];
/** Mirrors mcsEngine.MIN_REGIME_SHOCKS — the server rejects a regime bootstrap below this, so grey it out here instead of surfacing a runtime error. */
const MIN_REGIME_SHOCKS = 20;
/** Mirrors mcsEngine.FOMC_RELIABLE_HORIZON_MONTHS — see the "Confidence" column note in the FOMC panel below. */
const FOMC_RELIABLE_HORIZON_MONTHS = 6;

function useMcs(fitYears: number, paths: number, regime: string, fomcAnchor: boolean) {
  const [data, setData] = useState<McsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const regimeQs = regime ? `&regime=${encodeURIComponent(regime)}` : "";
    fetch(`/api/simulations/mcs?fitYears=${fitYears}&paths=${paths}${regimeQs}&fomcAnchor=${fomcAnchor ? 1 : 0}`)
      .then((r) => r.json())
      .then((j) => { if (alive) { setData(j); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [fitYears, paths, regime, fomcAnchor]);

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
  const [regime, setRegime] = useState(""); // "" = unconditional (all regimes pooled)
  const [fomcAnchor, setFomcAnchor] = useState(true);
  const { data, loading } = useMcs(fitYears, 2000, regime, fomcAnchor);

  const result = data?.result ?? null;
  const source = data?.ok ? "DB" : "ERR";

  // Regime options in fixed desk order, annotated with obs count in the current fit window.
  const regimeOptions = useMemo(() => {
    const counts = data?.regimeCounts ?? {};
    return REGIME_ORDER.filter((r) => r in counts).map((r) => ({ name: r, count: counts[r] }));
  }, [data?.regimeCounts]);

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
        <label className="flex items-center gap-1.5 text-term-text-dim">
          Regime
          <select
            className="rounded-sm border border-term-border bg-term-panel px-1.5 py-0.5 text-term-text"
            value={regime}
            onChange={(e) => setRegime(e.target.value)}
          >
            <option value="">Unconditional (all regimes)</option>
            <option value="current">Current{data?.currentRegime ? ` (${data.currentRegime})` : ""}</option>
            {regimeOptions.map((r) => (
              <option key={r.name} value={r.name} disabled={r.count < MIN_REGIME_SHOCKS}>
                {r.name} ({r.count}{r.count < MIN_REGIME_SHOCKS ? " — too few" : ""})
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-term-text-dim" title="Re-centers each horizon's distribution toward gold.fomc_meeting_path — a rate bootstrapped from the Treasury curve, chained meeting-to-meeting, NOT a CME FedWatch / Fed-funds-futures probability. Tapers from the 3M point out to the long end; dispersion is untouched.">
          <input type="checkbox" checked={fomcAnchor} onChange={(e) => setFomcAnchor(e.target.checked)} className="accent-term-amber" />
          FOMC-anchor front end
        </label>
        {fomcAnchor && data?.ok && !data.fomcAnchorApplied && (
          <span title={data.fomcAnchorSkippedReason ?? undefined}>
            <Tag tone="neutral">
              Anchor unavailable{data.fomcAnchorSkippedReason ? ` — ${data.fomcAnchorSkippedReason}` : ""}
            </Tag>
          </span>
        )}
        {result?.sparseRegime && (
          <span title="Fewer than 100 shocks in this regime within the fit window — tails likely reflect one historical episode, not a distribution.">
            <Tag tone="amber">Sparse regime · {result.shockPoolSize} obs</Tag>
          </span>
        )}
        {result && (
          <span className="ml-auto text-3xs text-term-text-mute">
            {result.config.numPaths.toLocaleString()} paths from {result.shockPoolSize.toLocaleString()} shock{result.shockPoolSize === 1 ? "" : "s"}
            {" "}· fit {result.fit.fitStartDate} → {result.fit.fitEndDate} ({result.fit.fitObservations.toLocaleString()} obs)
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

            {result.fomcAnchor && (
              <Panel title="FOMC anchor" code="FOMC" subtitle={`3M anchor · taper ${result.fomcAnchor.taperYears}y · curve-bootstrapped, not futures-implied`} className="lg:col-span-2">
                <table className="w-full text-2xs">
                  <thead>
                    <tr className="border-b border-term-border text-term-text-mute">
                      <th className="p-1.5 text-left">Horizon</th>
                      <th className="p-1.5 text-right">Curve-implied rate</th>
                      <th className="p-1.5 text-right">Unconditional 3M median</th>
                      <th className="p-1.5 text-right">Shift @3M</th>
                      <th className="p-1.5 text-right">Shift @{TENOR_LABELS[tenor] ?? tenor}</th>
                      <th className="p-1.5 text-right">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.horizons.map((h) => {
                      const diag = result.fomcAnchor!.byHorizon[h.horizonDays];
                      if (!diag) return null;
                      const taper = Math.max(0, Math.min(1, Math.exp(-(Number(tenor) - result.fomcAnchor!.anchorTenor) / result.fomcAnchor!.taperYears)));
                      return (
                        <tr key={h.horizonDays} className={clsx("border-b border-term-border-soft", !diag.reliable && "bg-term-amber/5")}>
                          <td className="p-1.5 font-mono">{HORIZON_LABELS[h.horizonDays] ?? `${h.horizonDays}d`}</td>
                          <td className="tnum p-1.5 text-right">{fmtNum(diag.fomcImpliedRate, 2)}%</td>
                          <td className="tnum p-1.5 text-right">{fmtNum(diag.preAnchorMedian, 2)}%</td>
                          <td className="tnum p-1.5 text-right font-semibold">{fmtSigned(diag.shiftBps, 0)}bp</td>
                          <td className="tnum p-1.5 text-right">{fmtSigned(diag.shiftBps * taper, 0)}bp</td>
                          <td className="p-1.5 text-right">
                            {diag.reliable
                              ? <Tag tone="up">Reliable</Tag>
                              : <span title={`${diag.monthsOut}mo out — the upstream curve only has real tenor points to 12mo (1M/3M/6M/1Y), so 6–12mo meetings are coarsely interpolated between just two points, and anything past 12mo is flat-extrapolated at the 1Y rate with no meeting-to-meeting differentiation.`}>
                                  <Tag tone="amber">Coarse · {diag.monthsOut}mo out</Tag>
                                </span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="border-t border-term-border-soft px-3 py-1.5 text-3xs text-term-text-mute">
                  Median re-centered on a rate bootstrapped from the Treasury curve (1M/3M/6M/1Y) and chained meeting-to-meeting —
                  <b className="text-term-text"> not</b> a CME FedWatch / Fed-funds-futures probability, since no futures feed is
                  in the pipeline. Longer tenors receive a tapered fraction of the same shift (exp decay, {result.fomcAnchor.taperYears}y
                  half-scale). Dispersion (P5–P95 width) is untouched — only the distribution's location moves. Horizons flagged
                  "Coarse" beyond {FOMC_RELIABLE_HORIZON_MONTHS} months sit past the curve's closely-spaced tenors — treat their shift
                  as a rough lean, not a differentiated meeting-by-meeting view.
                </div>
              </Panel>
            )}

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
            observations of the Gold NS factors ({fitYears}y trailing window); the fitted dynamics are always
            unconditional. {data?.regimeFilter ? (
              <>Shocks are bootstrapped only from days regime-tagged <b className="text-term-text">{data.regimeFilter}</b> ({result.shockPoolSize.toLocaleString()} of {result.fit.fitObservations.toLocaleString()} in-window)
              {result.sparseRegime ? " — that pool is thin enough that the tails likely reflect one historical episode rather than a genuine distribution." : "."}</>
            ) : (
              <>Shocks are bootstrapped jointly across all regimes pooled, not per-factor and not assumed Gaussian.</>
            )} Tail percentiles reflect one historical sample either way — regimes that occurred rarely (or once, e.g.
            1970s stagflation) will be under-represented unless explicitly selected above. {result.fomcAnchor ? (
              <>The front end is re-centered on a curve-bootstrapped, meeting-chained rate (see FOMC panel below — this is
              <i> not</i> a Fed-funds-futures probability) rather than the bootstrap's own unconditional drift; horizons past
              {" "}{FOMC_RELIABLE_HORIZON_MONTHS} months are flagged there as coarse.</>
            ) : data?.fomcAnchorSkippedReason ? (
              <>FOMC anchor requested but unavailable ({data.fomcAnchorSkippedReason}); showing the unconditional statistical path.</>
            ) : (
              <>FOMC anchor is off — this is the raw statistical bootstrap with no curve-implied Fed path blended in.</>
            )}{" "}
            <Tag tone="amber" className="ml-1">Model output, not a forecast</Tag>
          </div>
        </>
      )}
    </div>
  );
}
