import { useMemo, useState } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { fmtNum, fmtPct, fmtSignedPct } from "@/lib/format";
import { useVixForward } from "@/lib/useVixForward";
import {
  BASIS_OPTIONS, HORIZON_DAYS, NORMAL_BENCHMARK,
  alignForward, buildReadout, computeVixForwardStats, selectObservations,
  type BucketStats, type OlsResult, type PredictiveGrade, type VixBucketScheme, type VixForwardBasis, type VixForwardSampling,
} from "@/lib/vixImpliedForward";
import { buildWalkForwardReadout, MIN_TRAIN_DAILY, MIN_TRAIN_MONTHLY, walkForward, type ModelScore } from "@/lib/vixWalkForward";
import { LatexBlock } from "@/components/math/LatexBlock";
import { VIXR_TEX, VIXR_TEX_FILENAME, parseFormulaSections } from "@/lib/vixrFormulas";
import { bucketsToCsv, csvFilename, forecastsToCsv, windowsToCsv, type CsvMeta } from "@/lib/vixrCsv";
import { AdvantageChart, BucketBars, ConeTimeline, EmptyChart, ImpliedScatter, VolTimeline, ZHistogram } from "./charts";

const PRESETS: { id: string; label: string; start: string; end: string }[] = [
  { id: "all", label: "Full history", start: "", end: "" },
  { id: "2008", label: "Since 2008", start: "2008-01-01", end: "" },
  { id: "10y", label: "Last 10Y", start: "2016-10-01", end: "" },
  { id: "pre2008", label: "Before 2008", start: "", end: "2007-12-31" },
];

function Button({ active, children, onClick, title }: { active: boolean; children: string; onClick: () => void; title?: string }) {
  return (
    <button type="button" title={title} aria-pressed={active} onClick={onClick}
      className={`h-7 rounded-sm border px-2 text-2xs font-semibold uppercase tracking-wide transition-colors ${
        active ? "border-term-amber/60 bg-term-amber/15 text-term-amber" : "border-term-border bg-term-panel-3 text-term-text-dim hover:border-term-amber/40 hover:text-term-text"
      }`}>
      {children}
    </button>
  );
}

/** Save text as a file in the browser. */
function download(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function CsvButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
      className="h-5 rounded-sm border border-term-border bg-term-panel-3 px-1.5 text-3xs font-semibold uppercase tracking-wide text-term-text-dim hover:border-term-amber/40 hover:text-term-text disabled:opacity-40">
      CSV
    </button>
  );
}

/** Copy text to the clipboard, falling back to a hidden textarea where the async API is blocked. */
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const area = document.createElement("textarea");
    area.value = text; area.style.position = "fixed"; area.style.opacity = "0";
    document.body.appendChild(area); area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch { return false; }
}

function FormulaSheet() {
  const sections = useMemo(() => parseFormulaSections(VIXR_TEX), []);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    if (await copyText(text)) { setCopied(key); setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500); }
  };
  if (!sections.length) return <div className="text-xs text-term-text-mute">Formula sheet unavailable.</div>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-2xs text-term-text-dim">
        <span>Every formula the module evaluates. Open a section to see the rendered math; use Copy for its LaTeX, or download the full file (compiles with pdflatex).</span>
        <span className="ml-auto flex gap-1">
          <button type="button" onClick={() => void copy("all", VIXR_TEX)} className="h-6 rounded-sm border border-term-border bg-term-panel-3 px-2 text-3xs font-semibold uppercase tracking-wide text-term-text-dim hover:border-term-amber/40 hover:text-term-text">{copied === "all" ? "Copied" : "Copy all LaTeX"}</button>
          <button type="button" onClick={() => download(VIXR_TEX_FILENAME, VIXR_TEX, "application/x-tex;charset=utf-8")} className="h-6 rounded-sm border border-term-border bg-term-panel-3 px-2 text-3xs font-semibold uppercase tracking-wide text-term-text-dim hover:border-term-amber/40 hover:text-term-text">Download .tex</button>
        </span>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {sections.map((section) => (
          <details key={section.title} className="border border-term-border bg-term-panel-2">
            <summary className="flex cursor-pointer items-center justify-between gap-2 px-2 py-1.5 text-xs font-semibold text-term-text">
              <span>{section.title}</span>
              <button type="button" aria-label={`Copy LaTeX: ${section.title}`} onClick={(event) => { event.preventDefault(); void copy(section.title, section.latex); }}
                className="rounded-sm border border-term-border bg-term-panel-3 px-1.5 text-3xs font-semibold uppercase tracking-wide text-term-text-dim hover:border-term-amber/40 hover:text-term-text">
                {copied === section.title ? "Copied" : "Copy"}
              </button>
            </summary>
            <div className="max-h-[520px] overflow-auto border-t border-term-border p-3"><LatexBlock latex={section.latex} /></div>
            <details className="border-t border-term-border">
              <summary className="cursor-pointer px-2 py-1 text-3xs uppercase tracking-wide text-term-text-mute">LaTeX source</summary>
              <pre className="max-h-[260px] overflow-auto p-2 font-mono text-[10px] leading-snug text-term-text-dim"><code>{section.latex}</code></pre>
            </details>
          </details>
        ))}
      </div>
    </div>
  );
}

const gradeTone = (grade: PredictiveGrade): "up" | "amber" | "neutral" | "down" =>
  grade === "strong" ? "up" : grade === "moderate" ? "amber" : grade === "weak" ? "neutral" : "down";

const t = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;

function RegressionRow({ label, fit, note }: { label: string; fit: OlsResult | null; note?: string }) {
  return (
    <tr className="border-t border-term-border">
      <td className="py-1 pr-2 text-term-text">{label}{note && <div className="text-[9px] text-term-text-mute">{note}</div>}</td>
      {fit ? <>
        <td className="tnum text-right">{fit.alpha.toFixed(2)}</td>
        <td className="tnum text-right">{fit.beta.toFixed(3)}</td>
        <td className={`tnum text-right ${Math.abs(fit.tBeta) >= 2 ? "text-term-up" : "text-term-text-dim"}`}>{t(fit.tBeta)}</td>
        <td className="tnum text-right">{fmtPct(fit.r2 * 100, 1)}</td>
        <td className="tnum text-right">{fmtNum(fit.n, 0)}</td>
      </> : <td colSpan={5} className="text-right text-term-text-mute">not enough variation</td>}
    </tr>
  );
}

export default function VixImpliedForward() {
  const [basis, setBasis] = useState<VixForwardBasis>("spy_price");
  const [sampling, setSampling] = useState<VixForwardSampling>("monthly");
  const [scheme, setScheme] = useState<VixBucketScheme>("regime");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const { data, source, error } = useVixForward(basis);

  const aligned = useMemo(() => (data ? alignForward(data.vix, data.price) : null), [data]);
  const observations = useMemo(() => (aligned ? selectObservations(aligned.observations, { start: start || undefined, end: end || undefined, sampling }) : []), [aligned, start, end, sampling]);
  const stats = useMemo(() => computeVixForwardStats(observations, { sampling, scheme }), [observations, sampling, scheme]);
  const readout = useMemo(() => (stats ? buildReadout(stats) : null), [stats]);
  const current = aligned?.current ?? null;
  const minTrain = sampling === "daily" ? MIN_TRAIN_DAILY : MIN_TRAIN_MONTHLY;
  const wf = useMemo(() => walkForward(observations, { minTrain, lag: stats?.lag ?? (sampling === "daily" ? 21 : 3) }), [observations, minTrain, stats?.lag, sampling]);
  const wfReadout = useMemo(() => (wf ? buildWalkForwardReadout(wf) : null), [wf]);
  const calibrated = wf?.vol.find((m) => m.id === "vix_calibrated") ?? null;
  const csvMeta = (title: string): CsvMeta => ({
    title,
    lines: [
      ["Module", "VIXR VIX Implied vs Forward Returns"],
      ["Source", `Gold VIXCLS and ${data?.inputs.priceSeriesId ?? basisOption.short}`],
      ["Basis", basisOption.label],
      ["Sampling", sampling === "daily" ? "daily overlapping windows" : "non-overlapping 30-day windows"],
      ["Range", `${start || "start of data"} to ${end || "latest"}`],
      ["Data as of", asOf ?? "unknown"],
      ["Horizon", `${HORIZON_DAYS} calendar days; implied 1 sigma = VIX * sqrt(30/365)`],
    ],
  });
  const range = [start || undefined, end || undefined] as const;
  const loading = source === "LOADING";
  const asOf = data?.inputs.vixLast ?? null;
  const basisOption = BASIS_OPTIONS.find((option) => option.id === basis)!;
  const mz = stats?.magnitude.realizedOnVix ?? null;
  const dir = stats?.direction.returnOnVix ?? null;
  const bench = stats?.magnitude.benchmark ?? null;

  const bucketCols: Column<BucketStats>[] = [
    { key: "bucket", header: "VIX bucket", render: (b) => b.label, sortVal: (b) => b.lo ?? -1 },
    { key: "n", header: "n", align: "right", render: (b) => fmtNum(b.n, 0), sortVal: (b) => b.n },
    { key: "vix", header: "Avg VIX", align: "right", render: (b) => fmtNum(b.meanVix, 1), sortVal: (b) => b.meanVix },
    { key: "implied", header: "Implied ±1σ", align: "right", render: (b) => fmtPct(b.meanImpliedMovePct, 2), sortVal: (b) => b.meanImpliedMovePct },
    { key: "mean", header: "Mean fwd", align: "right", render: (b) => <span className={b.meanForwardReturnPct >= 0 ? "text-term-up" : "text-term-down"}>{fmtSignedPct(b.meanForwardReturnPct, 2)}</span>, sortVal: (b) => b.meanForwardReturnPct },
    { key: "pos", header: "% up", align: "right", render: (b) => fmtPct(b.pctPositive, 0), sortVal: (b) => b.pctPositive },
    { key: "ratio", header: "Realized ÷ implied", align: "right", render: (b) => <span className={b.realizedToImplied < 1 ? "text-term-blue" : "text-term-amber"}>{b.realizedToImplied.toFixed(2)}</span>, sortVal: (b) => b.realizedToImplied },
    { key: "in1", header: "Inside ±1σ", align: "right", render: (b) => fmtPct(b.within1Pct, 0), sortVal: (b) => b.within1Pct },
    { key: "median", header: "Median fwd", align: "right", render: (b) => fmtSignedPct(b.medianForwardReturnPct, 2), sortVal: (b) => b.medianForwardReturnPct },
    { key: "abs", header: "Mean |move|", align: "right", render: (b) => fmtPct(b.meanAbsReturnPct, 2), sortVal: (b) => b.meanAbsReturnPct },
    { key: "worst", header: "Worst", align: "right", render: (b) => <span className="text-term-down">{fmtSignedPct(b.worstReturnPct, 1)}</span>, sortVal: (b) => b.worstReturnPct },
    { key: "best", header: "Best", align: "right", render: (b) => <span className="text-term-up">{fmtSignedPct(b.bestReturnPct, 1)}</span>, sortVal: (b) => b.bestReturnPct },
  ];

  const presetId = PRESETS.find((p) => p.start === start && p.end === end)?.id;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        code="VIXR"
        title="VIX Implied vs Forward Returns"
        desc="VIX-implied 30-day move against what the S&P 500 then did"
        asOf={asOf}
        showStreaming={false}
        right={<>
          <ProvenanceBadge source={source === "DB" ? "DB" : source === "LOADING" ? "LOADING" : "ERR"} asOf={asOf} />
          <Tag tone="blue">{basisOption.short}</Tag>
          <Tag tone={sampling === "monthly" ? "up" : "violet"}>{sampling === "monthly" ? "non-overlapping" : "daily overlapping"}</Tag>
        </>}
      />

      <KpiStrip>
        <Stat label="Latest VIX" value={current ? fmtNum(current.vix, 2) : "-"} sub={current ? `±${current.impliedMovePct.toFixed(1)}% 1σ to ${current.horizonEnd}` : "awaiting Gold"} tone="amber" />
        <Stat label="Inside ±1σ" value={stats ? fmtPct(stats.calibration.within1.pct, 1) : "-"} sub={stats ? `normal ${NORMAL_BENCHMARK.within1}% · CI ${stats.calibration.within1.ciLow.toFixed(0)}–${stats.calibration.within1.ciHigh.toFixed(0)}%` : "-"} tone={stats && stats.calibration.within1.ciLow > NORMAL_BENCHMARK.within1 ? "up" : "neutral"} />
        <Stat label="Beyond −2σ" value={stats ? fmtPct(stats.calibration.beyondMinus2.pct, 2) : "-"} sub={`normal ${NORMAL_BENCHMARK.beyondMinus2}%`} tone={stats && stats.calibration.beyondMinus2.pct > NORMAL_BENCHMARK.beyondMinus2 ? "down" : "neutral"} />
        <Stat label="Realized ÷ Implied" value={stats ? stats.vol.ratio.toFixed(2) : "-"} sub={stats ? `premium ${stats.vol.meanPremiumPts >= 0 ? "+" : ""}${stats.vol.meanPremiumPts.toFixed(1)} vol pts` : "-"} tone={stats && stats.vol.ratio < 1 ? "up" : "amber"} />
        <Stat label="Magnitude R²" value={mz ? fmtPct(mz.r2 * 100, 0) : "-"} sub={bench ? `trailing vol ${fmtPct(bench.trailingR2 * 100, 0)}` : "next-30d realized vol"} />
        <Stat label="Direction" value={dir ? `${t(dir.beta)}%/pt` : "-"} sub={dir ? `t ${t(dir.tBeta)} · R² ${fmtPct(dir.r2 * 100, 1)}` : "-"} tone={dir && Math.abs(dir.tBeta) >= 2 ? (dir.beta > 0 ? "up" : "down") : "neutral"} />
        <Stat label="Out-of-sample skill" value={calibrated ? fmtPct(calibrated.oosR2 * 100, 0) : "-"} sub={wf ? `recalibrated VIX vs hist. mean · ${fmtNum(wf.n, 0)} tests` : `needs ${minTrain}+ prior windows`} tone={calibrated ? (calibrated.oosR2 > 0 ? "up" : "down") : "neutral"} />
        <Stat label="Sample" value={stats ? fmtNum(stats.n, 0) : "-"} sub={stats ? `≈${fmtNum(stats.effectiveN, 0)} independent · ${stats.start.slice(0, 4)}–${stats.end.slice(0, 4)}` : "-"} />
      </KpiStrip>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        <Panel title="Controls" code="CTRL" bodyClassName="p-2" resizable={false}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Underlying">
              {BASIS_OPTIONS.map((option) => <Button key={option.id} active={basis === option.id} onClick={() => setBasis(option.id)} title={option.desc}>{option.label}</Button>)}
            </div>
            <div className="h-5 w-px bg-term-border" />
            <div className="flex items-center gap-1" role="group" aria-label="Sampling">
              <Button active={sampling === "monthly"} onClick={() => setSampling("monthly")} title="Back-to-back 30-day windows that never overlap: each window is an independent observation">Non-overlapping</Button>
              <Button active={sampling === "daily"} onClick={() => setSampling("daily")} title="One window per trading day; neighbouring windows share up to 21 returns">Daily</Button>
            </div>
            <div className="h-5 w-px bg-term-border" />
            <div className="flex items-center gap-1" role="group" aria-label="Buckets">
              <Button active={scheme === "regime"} onClick={() => setScheme("regime")}>VIX levels</Button>
              <Button active={scheme === "quintile"} onClick={() => setScheme("quintile")}>Quintiles</Button>
            </div>
            <div className="h-5 w-px bg-term-border" />
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="History">
              {PRESETS.map((p) => <Button key={p.id} active={presetId === p.id} onClick={() => { setStart(p.start); setEnd(p.end); }}>{p.label}</Button>)}
            </div>
            <label className="ml-auto flex items-center gap-1 text-2xs uppercase tracking-wide text-term-text-mute">
              From
              <input type="date" aria-label="From date" value={start} onChange={(e) => setStart(e.target.value)} className="h-7 rounded-sm border border-term-border bg-term-panel-3 px-2 text-xs text-term-text" />
            </label>
            <label className="flex items-center gap-1 text-2xs uppercase tracking-wide text-term-text-mute">
              To
              <input type="date" aria-label="To date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-7 rounded-sm border border-term-border bg-term-panel-3 px-2 text-xs text-term-text" />
            </label>
          </div>
          <p className="mt-2 text-2xs text-term-text-mute">
            On each date the VIX implies a one-standard-deviation {HORIZON_DAYS}-day move of VIX × √(30/365). Each observation compares that with the {basisOption.short} return over the next {HORIZON_DAYS} calendar days. Research context, not a trading signal.
          </p>
        </Panel>

        {source === "ERR" && (
          <Panel title="Data unavailable" code="ERR" bodyClassName="p-3" resizable={false}>
            <div role="alert" className="text-xs text-term-text-dim">{error ?? "VIX forward history unavailable."} This module reads Gold only and never substitutes simulated data.</div>
          </Panel>
        )}

        <div className="grid min-h-0 grid-cols-1 gap-2 xl:grid-cols-12">
          <Panel title="Readout" code="EDGE" className="xl:col-span-5" bodyClassName="p-3">
            {readout && stats ? <>
              <div className="flex flex-wrap items-center gap-1.5">
                <Tag tone={gradeTone(readout.magnitudeGrade)}>{readout.magnitudeGrade} magnitude signal</Tag>
                <Tag tone={readout.directionSignificant ? "amber" : "neutral"}>{readout.directionSignificant ? "directional tilt" : "no directional edge"}</Tag>
                <Tag tone={stats.vol.ratio < 1 ? "blue" : "amber"}>{stats.vol.ratio < 1 ? "VIX overstates" : "VIX understates"}</Tag>
              </div>
              <dl className="mt-3 space-y-2 text-xs leading-relaxed text-term-text-dim">
                <div><dt className="text-2xs font-semibold uppercase tracking-wide text-term-text-mute">Magnitude</dt><dd>{readout.magnitude}</dd></div>
                <div><dt className="text-2xs font-semibold uppercase tracking-wide text-term-text-mute">Calibration</dt><dd>{readout.calibration}</dd></div>
                <div><dt className="text-2xs font-semibold uppercase tracking-wide text-term-text-mute">Tails</dt><dd>{readout.tails}</dd></div>
                <div><dt className="text-2xs font-semibold uppercase tracking-wide text-term-text-mute">Direction</dt><dd>{readout.direction}</dd></div>
              </dl>
              <ul className="mt-3 space-y-1 text-2xs text-term-text-mute">
                {readout.notes.map((note) => <li key={note} className="border border-term-border bg-term-panel-2 px-2 py-1">{note}</li>)}
              </ul>
            </> : <div className="text-xs text-term-text-mute">{loading ? "Loading Gold history…" : "Not enough observations in this range. Widen the dates."}</div>}
          </Panel>

          <Panel title="Implied move vs realized 30-day return" code="SCAT" className="xl:col-span-7" subtitle="each dot is one window"
            right={<CsvButton label="Download windows as CSV" disabled={!observations.length} onClick={() => download(csvFilename("windows", basis, ...range), windowsToCsv(observations, csvMeta("VIX forward windows")))} />}>
            {loading && !observations.length ? <EmptyChart label="Loading Gold history" height={320} /> : <ImpliedScatter observations={observations} />}
          </Panel>

          <Panel title="Implied ±1σ band vs outcome over time" code="CONE" className="xl:col-span-7">
            <ConeTimeline observations={observations} />
          </Panel>

          <Panel title="Standardized move distribution" code="DIST" className="xl:col-span-5" subtitle="log move ÷ implied 1σ">
            <ZHistogram observations={observations} />
            {stats && <div className="border-t border-term-border px-2 py-1.5 text-2xs text-term-text-mute">
              Std dev {stats.calibration.zStd.toFixed(2)} (1.00 if the VIX were exact) · mean {t(stats.calibration.zMean)} · excess kurtosis {stats.calibration.zExcessKurtosis.toFixed(1)} · inside ±2σ {fmtPct(stats.calibration.within2.pct, 1)} (normal {NORMAL_BENCHMARK.within2}%)
            </div>}
          </Panel>

          <Panel title="VIX vs subsequent realized volatility" code="VRP" className="xl:col-span-7" subtitle="vol points">
            <VolTimeline observations={observations} />
            {stats && <div className="border-t border-term-border px-2 py-1.5 text-2xs text-term-text-mute">
              VIX exceeded the volatility that followed in {fmtPct(stats.vol.pctVixAboveRealized, 0)} of windows · mean premium {stats.vol.meanPremiumPts.toFixed(1)} vol pts · median realized ÷ implied {stats.vol.medianRatio.toFixed(2)}
            </div>}
          </Panel>

          <Panel title="Regressions" code="REG" className="xl:col-span-5" bodyClassName="p-2" subtitle={stats ? `Newey–West, ${stats.lag} lags` : undefined}>
            {stats ? <table className="w-full text-2xs">
              <thead><tr className="text-left text-term-text-mute"><th scope="col">Model</th><th scope="col" className="text-right">α</th><th scope="col" className="text-right">β</th><th scope="col" className="text-right">t(β)</th><th scope="col" className="text-right">R²</th><th scope="col" className="text-right">n</th></tr></thead>
              <tbody>
                <RegressionRow label="Realized vol ~ VIX" fit={mz} note={mz ? `unbiased if α = 0, β = 1 · t(β = 1) ${t((mz.beta - 1) / (mz.seBeta || 1))}` : undefined} />
                <RegressionRow label="Realized vol ~ trailing 30d vol" fit={bench?.trailing ?? null} note={bench ? `benchmark · VIX R² on the same ${fmtNum(bench.n, 0)} dates ${fmtPct(bench.vixR2 * 100, 1)}` : undefined} />
                <RegressionRow label="|Return| ~ implied move" fit={stats.magnitude.absReturnOnImplied} note={stats.magnitude.spearmanVixAbsReturn === null ? undefined : `Spearman ρ(VIX, |return|) ${stats.magnitude.spearmanVixAbsReturn.toFixed(2)}`} />
                <RegressionRow label="Return ~ VIX" fit={dir} note="direction: % return per VIX point" />
              </tbody>
            </table> : <div className="text-xs text-term-text-mute">-</div>}
          </Panel>

          <Panel title="Forward returns by VIX bucket" code="BKT" className="xl:col-span-8" scroll
            right={<CsvButton label="Download buckets as CSV" disabled={!stats} onClick={() => stats && download(csvFilename("buckets", basis, ...range), bucketsToCsv(stats.buckets, csvMeta("VIX forward returns by VIX bucket")))} />}>
            {stats ? <>
              <DataGrid columns={bucketCols} rows={stats.buckets} rowKey={(b) => b.id} maxHeight="320px" initialSort={{ key: "bucket", dir: "asc" }} zebra />
              <div className="border-t border-term-border px-2 py-1.5 text-2xs text-term-text-mute">Buckets use the VIX on the window's start date. Realized ÷ implied below 1 means the VIX overstated the volatility that followed.</div>
            </> : <EmptyChart label={loading ? "Loading" : "No observations"} height={180} />}
          </Panel>

          <Panel title="Mean 30-day return by bucket" code="BAR" className="xl:col-span-4">
            <BucketBars buckets={stats?.buckets ?? []} />
          </Panel>

          <Panel title="Out-of-sample test" code="OOS" className="xl:col-span-12" bodyClassName="p-3" subtitle="expanding window · no look-ahead"
            right={<CsvButton label="Download forecasts as CSV" disabled={!wf} onClick={() => wf && download(csvFilename("forecasts", basis, ...range), forecastsToCsv(wf, csvMeta("VIX out-of-sample forecasts")))} />}>
            {wf && wfReadout ? (
              <div className="grid gap-3 xl:grid-cols-12">
                <div className="space-y-2 xl:col-span-5">
                  <dl className="space-y-2 text-xs leading-relaxed text-term-text-dim">
                    <div><dt className="text-2xs font-semibold uppercase tracking-wide text-term-text-mute">Volatility forecasts</dt><dd>{wfReadout.volatility}</dd></div>
                    <div><dt className="text-2xs font-semibold uppercase tracking-wide text-term-text-mute">Versus trailing volatility</dt><dd>{wfReadout.versusTrailing}</dd></div>
                    <div><dt className="text-2xs font-semibold uppercase tracking-wide text-term-text-mute">Return forecasts</dt><dd>{wfReadout.returns}</dd></div>
                  </dl>
                  <ul className="space-y-1 text-2xs text-term-text-mute">
                    {wfReadout.notes.map((note) => <li key={note} className="border border-term-border bg-term-panel-2 px-2 py-1">{note}</li>)}
                  </ul>
                </div>
                <div className="space-y-3 xl:col-span-7">
                  <AdvantageChart points={wf.advantage} />
                  <div className="text-2xs text-term-text-mute">Running sum of squared-error saved against the historical-mean forecast, in vol points². Rising means the model keeps adding information; falling means it is worse than the average.</div>
                  <table className="w-full text-2xs">
                    <thead><tr className="text-left text-term-text-mute"><th scope="col">Forecast</th><th scope="col" className="text-right">RMSE</th><th scope="col" className="text-right">MAE</th><th scope="col" className="text-right">Bias</th><th scope="col" className="text-right">Skill vs mean</th><th scope="col" className="text-right">DM t vs mean</th><th scope="col" className="text-right">DM t vs trailing</th></tr></thead>
                    <tbody>
                      {[...wf.vol, ...wf.returns].map((m: ModelScore, i) => (
                        <tr key={m.id} className={`border-t border-term-border ${i === wf.vol.length ? "border-t-2" : ""}`}>
                          <td className="py-1 pr-2 text-term-text">{m.label}<div className="text-[9px] text-term-text-mute">{i < wf.vol.length ? "next-30d realized vol, vol points" : "next-30d return, %"}</div></td>
                          <td className="tnum text-right">{m.rmse.toFixed(2)}</td>
                          <td className="tnum text-right">{m.mae.toFixed(2)}</td>
                          <td className="tnum text-right">{m.bias >= 0 ? "+" : ""}{m.bias.toFixed(2)}</td>
                          <td className={`tnum text-right ${m.dmVsBenchmark === null ? "text-term-text-mute" : m.oosR2 > 0 ? "text-term-up" : "text-term-down"}`}>{m.dmVsBenchmark === null ? "benchmark" : fmtPct(m.oosR2 * 100, 1)}</td>
                          <td className={`tnum text-right ${m.dmVsBenchmark !== null && Math.abs(m.dmVsBenchmark) >= 2 ? "text-term-up" : "text-term-text-dim"}`}>{m.dmVsBenchmark === null ? "-" : t(m.dmVsBenchmark)}</td>
                          <td className={`tnum text-right ${m.dmVsTrailing !== null && Math.abs(m.dmVsTrailing) >= 2 ? "text-term-up" : "text-term-text-dim"}`}>{m.dmVsTrailing === null ? "-" : t(m.dmVsTrailing)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="text-2xs text-term-text-mute">{fmtNum(wf.n, 0)} test windows, {wf.firstTest} to {wf.lastTest}; training grew from {fmtNum(wf.trainAtFirstTest, 0)} to {fmtNum(wf.trainAtLastTest, 0)} windows. Diebold–Mariano t below −2 means a significantly smaller squared error than the comparison forecast.</div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-term-text-mute">{loading ? "Loading Gold history…" : `Not enough history for an out-of-sample test in this range: it needs ${minTrain} prior ${sampling === "daily" ? "daily" : "non-overlapping"} windows before testing starts, plus at least 10 test windows. Widen the dates.`}</div>
            )}
          </Panel>

          <Panel title="Formulas" code="FORM" className="xl:col-span-12" bodyClassName="p-3" subtitle="LaTeX · how each number is calculated" resizable={false}>
            <FormulaSheet />
          </Panel>

          <Panel title="Data and method" code="SRC" className="xl:col-span-12" bodyClassName="p-3" resizable={false}>
            <div className="grid gap-3 text-2xs text-term-text-dim md:grid-cols-3">
              <div className="space-y-1">
                <div className="font-semibold uppercase tracking-wide text-term-text-mute">Inputs</div>
                <div>VIXCLS {data?.inputs.vixFirst ?? "-"} → {data?.inputs.vixLast ?? "-"} · {fmtNum(aligned?.diagnostics.vixRows ?? 0, 0)} rows</div>
                <div>{data?.inputs.priceSeriesId ?? basisOption.short} {data?.inputs.priceFirst ?? "-"} → {data?.inputs.priceLast ?? "-"} · {fmtNum(aligned?.diagnostics.priceRows ?? 0, 0)} rows</div>
                <div>Windows built {fmtNum(aligned?.observations.length ?? 0, 0)} · index dates without VIX {fmtNum(aligned?.diagnostics.priceDatesWithoutVix ?? 0, 0)} · still open {fmtNum(aligned?.diagnostics.incompleteWindows ?? 0, 0)} · data gaps {fmtNum(aligned?.diagnostics.endpointGaps ?? 0, 0)} · invalid rows {fmtNum(aligned?.diagnostics.invalidRows ?? 0, 0)}</div>
                {(data?.warnings ?? []).map((w) => <div key={w} className="border border-term-amber/30 bg-term-amber/10 p-1.5 text-term-amber">{w}</div>)}
              </div>
              <div className="space-y-1">
                <div className="font-semibold uppercase tracking-wide text-term-text-mute">Method</div>
                <div>Window: close on the date to the last close on or before date + 30 calendar days. Implied 1σ = VIX × √(30/365). z = 30-day log return ÷ implied 1σ.</div>
                <div>Realized vol = √(252 × mean squared daily log return) inside the window. Trailing vol uses the 30 days before the date.</div>
                <div>Rates use Wilson intervals on the effective sample; regressions use Newey–West errors ({sampling === "daily" ? "21" : "3"} lags).</div>
              </div>
              <div className="space-y-1">
                <div className="font-semibold uppercase tracking-wide text-term-text-mute">Sources</div>
                {(data?.citations ?? []).map((c) => (
                  <a key={c.seriesId} href={c.url} target="_blank" rel="noreferrer" className="block border border-term-border bg-term-panel-2 p-1.5 hover:border-term-amber/50">
                    <span className="font-semibold text-term-text">{c.seriesId}</span> · {c.title} · {c.source}{c.note && <div className="text-term-text-mute">{c.note}</div>}
                  </a>
                ))}
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
