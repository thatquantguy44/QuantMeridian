import { useState } from "react";
import { KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { LineChart } from "@/components/charts/LineChart";
import type { IndemnificationResult, Metric } from "@/lib/indemnificationApi";
import {
  CHANNELS, METRIC_COLUMNS, VARIANTS, channelsFor, fmtMoney, fmtPct, peakOf, tailIsEmpty, wrongWayUplift, type VariantKey,
} from "@/lib/indemnificationView";
import { MetricText, Notice, TD, TH } from "./ui";

/** The label every figure carries: data label, seed and path count (spec020 AC-008). */
export function runStamp(r: IndemnificationResult): string {
  const run = r.run;
  return `${r.source} · seed ${run.seed} · ${run.paths.toLocaleString("en-US")} paths${run.preview ? " (preview)" : ""}`;
}

function Kpi({ label, m, result, tone }: { label: string; m: Metric; result: IndemnificationResult; tone?: "amber" | "down" }) {
  return (
    <Stat label={label} value={fmtMoney(m.value)} tone={tone}
      sub={<><span data-testid="kpi-se">{m.std_error === null ? "SE n/a" : `SE ${fmtMoney(m.std_error)}`}</span><br /><span className="text-3xs text-term-text-mute">{runStamp(result)}</span></>} />
  );
}

export function Overview({ result }: { result: IndemnificationResult }) {
  const [variant, setVariant] = useState<VariantKey>("with_wrong_way");
  const gaussian = result.program.gaussian.with_wrong_way;
  const shown = channelsFor(result.program, variant);
  const uplift = wrongWayUplift(result.program);
  const profile = result.exposure_profile;
  const labels = profile.times_days.map((d) => `${d}d`);
  const empty = tailIsEmpty(gaussian);

  return (
    <div className="flex flex-col gap-2">
      <KpiStrip>
        <Kpi label="Expected loss" m={gaussian.total.el} result={result} tone="amber" />
        <Kpi label="Default shortfall EL" m={gaussian.default_shortfall.el} result={result} />
        <Kpi label="Reinvestment EL" m={gaussian.reinvestment.el} result={result} />
        <Kpi label="VaR 99.9" m={gaussian.total.var999} result={result} tone="down" />
        <Kpi label="ES 99.9" m={gaussian.total.es999} result={result} tone="down" />
        <Stat label="Wrong-way effect" value={uplift === null ? "n/a" : `${uplift >= 0 ? "+" : ""}${fmtPct(uplift, 1)}`} tone="amber"
          sub={<>on total expected loss<br /><span className="text-3xs text-term-text-mute">{runStamp(result)}</span></>} />
      </KpiStrip>

      {empty && (
        <Notice tone="amber" title="No defaults in the sampled tail">
          None of the sampled paths had a borrower default large enough to reach the 99% and 99.9% tails, so VaR and ES read $0. Expected loss uses exact default probabilities and is still valid. Use more paths to populate the tail.
        </Notice>
      )}

      <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
        <Panel title="Exposure over the horizon" code="INDEM-1" accent right={<Tag tone="amber">{result.source}</Tag>}>
          <div className="p-2">
            <LineChart height={220} labels={labels} yFmt={fmtMoney} series={[
              { name: "Expected exposure", data: profile.ee, color: "#4DA3FF", area: true },
              { name: "PFE 95", data: profile.pfe95, color: "#FF8C00" },
              { name: "PFE 99", data: profile.pfe99, color: "#FF3B3B", dashed: true },
            ]} />
          </div>
          <div className="flex flex-wrap gap-3 border-t border-term-border px-3 py-1.5 text-3xs text-term-text-mute">
            <span>Peak EE <span className="tnum text-term-text">{fmtMoney(peakOf(profile.ee))}</span></span>
            <span>Peak PFE 95 <span className="tnum text-term-text">{fmtMoney(peakOf(profile.pfe95))}</span></span>
            <span>Peak PFE 99 <span className="tnum text-term-text">{fmtMoney(peakOf(profile.pfe99))}</span></span>
            <span className="ml-auto">{runStamp(result)}</span>
          </div>
        </Panel>

        <Panel title="Wrong-way effect" code="INDEM-2" accent subtitle="same draws, link on and off">
          <table className="w-full border-collapse tnum">
            <thead className="bg-term-panel-2">
              <tr><th className={`${TH} text-left`}>Measure</th><th className={`${TH} text-right`}>Wrong-way on</th><th className={`${TH} text-right`}>Wrong-way off</th></tr>
            </thead>
            <tbody>
              {(["el", "var999", "es999"] as const).map((k) => (
                <tr key={k} className="border-b border-term-border-soft">
                  <td className={`${TD} text-left text-term-text-dim`}>{METRIC_COLUMNS.find((c) => c.key === k)!.label}</td>
                  <td className={`${TD} text-right text-term-text`}><MetricText m={result.program.gaussian.with_wrong_way.total[k]} /></td>
                  <td className={`${TD} text-right text-term-text`}><MetricText m={result.program.gaussian.without_wrong_way.total[k]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-term-border px-3 py-1.5 text-3xs text-term-text-mute">
            With the link on, borrowers tend to default when equities fall, which is when equity collateral is worth least.
            {uplift !== null && <> Here it adds {fmtPct(uplift, 1)} to expected loss.</>}
          </div>
        </Panel>
      </div>

      <Panel title="Loss measures by channel" code="INDEM-3" accent
        toolbar={
          <div className="flex flex-wrap gap-1" role="group" aria-label="Model variant">
            {VARIANTS.map((v) => {
              const available = channelsFor(result.program, v.key) !== null;
              return (
                <button key={v.key} type="button" disabled={!available} onClick={() => setVariant(v.key)} aria-pressed={variant === v.key}
                  className={`border px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide disabled:opacity-40 ${variant === v.key ? "border-term-amber bg-term-amber text-black" : "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text"}`}>
                  {v.label}
                </button>
              );
            })}
          </div>
        }>
        {shown ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse tnum">
              <thead className="bg-term-panel-2">
                <tr>
                  <th className={`${TH} text-left`}>Channel</th>
                  {METRIC_COLUMNS.map((c) => <th key={c.key} className={`${TH} text-right`} title={c.hint}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {CHANNELS.map((ch) => (
                  <tr key={ch.key} className="border-b border-term-border-soft hover:bg-term-panel-2">
                    <td className={`${TD} text-left font-semibold text-term-amber`}>{ch.label}</td>
                    {METRIC_COLUMNS.map((c) => <td key={c.key} className={`${TD} text-right text-term-text`}><MetricText m={shown[ch.key][c.key]} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="p-3 text-2xs text-term-text-mute">The Student-t variant was not requested for this run.</div>}
        <div className="border-t border-term-border px-3 py-1 text-3xs text-term-text-mute">Each figure is shown with its standard error (±). EL uses exact default probabilities; VaR, ES and PFE come from sampled paths. {runStamp(result)}</div>
      </Panel>

      <Panel title="By owner" code="INDEM-4" accent>
        <table className="w-full border-collapse tnum">
          <thead className="bg-term-panel-2">
            <tr><th className={`${TH} text-left`}>Owner</th><th className={`${TH} text-right`}>Expected loss</th><th className={`${TH} text-right`}>Default shortfall</th><th className={`${TH} text-right`}>Reinvestment</th></tr>
          </thead>
          <tbody>
            {result.owners.map((o) => (
              <tr key={o.owner_id} className="border-b border-term-border-soft hover:bg-term-panel-2">
                <td className={`${TD} text-left font-semibold text-term-amber`}>{o.owner_id}</td>
                <td className={`${TD} text-right text-term-text`}><MetricText m={o.el.total} /></td>
                <td className={`${TD} text-right text-term-text-dim`}><MetricText m={o.el.default_shortfall} /></td>
                <td className={`${TD} text-right text-term-text-dim`}><MetricText m={o.el.reinvestment} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
