
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { Sparkline } from "@/components/charts/Sparkline";
import { fmtSigned, pnlClass } from "@/lib/format";
import {
  getSqueezeBoard,
  mergeShortInterest,
  getSqueezeCandidates,
  getRerateCandidates,
  getSpecialsWatch,
  getSectorHeat,
  getHeatAlerts,
  getSqueezeSummary,
  type SqueezeRow,
  type Classification,
} from "@/data/squeeze";
import type { YahooShortInterestRow } from "@/lib/server/yahooShortInterest";

type View = "BOARD" | "QUAD" | "SQUEEZE" | "RERATE" | "SPECIALS" | "SECTOR" | "ALERTS";
const VIEWS: { key: View; label: string }[] = [
  { key: "BOARD", label: "Heat Board" },
  { key: "QUAD", label: "Fee × Util" },
  { key: "SQUEEZE", label: "Squeeze" },
  { key: "RERATE", label: "Re-rate" },
  { key: "SPECIALS", label: "Specials" },
  { key: "SECTOR", label: "Sector Heat" },
  { key: "ALERTS", label: "Alerts" },
];

const CLS_TONE: Record<Classification, "up" | "down" | "amber" | "neutral" | "blue" | "violet"> = {
  GC: "neutral", WARM: "amber", SPECIAL: "violet", HTB: "down",
};
const CLS_COLOR: Record<Classification, string> = { GC: "#5E5E66", WARM: "#FF8C00", SPECIAL: "#A78BFA", HTB: "#FF3B3B" };

function heatColor(h: number): string {
  return h >= 75 ? "#FF3B3B" : h >= 50 ? "#FF8C00" : "#2ECC71";
}
function HeatBar({ v }: { v: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-12 overflow-hidden rounded-sm bg-term-panel-3">
        <span className="block h-full rounded-sm" style={{ width: `${v}%`, background: heatColor(v) }} />
      </span>
      <span className="tnum w-6 text-right text-3xs font-bold" style={{ color: heatColor(v) }}>{v}</span>
    </span>
  );
}

/** Fee × utilization quadrant — color by classification, guide lines at the special/HTB thresholds. */
function Quadrant({ rows }: { rows: SqueezeRow[] }) {
  const W = 640, H = 360, padL = 44, padR = 14, padT = 14, padB = 30;
  const capFee = Math.min(800, Math.max(...rows.map((r) => r.feeBps)) * 1.05);
  const x = (u: number) => padL + (u / 100) * (W - padL - padR);
  const y = (f: number) => padT + (1 - Math.min(f, capFee) / capFee) * (H - padT - padB);
  const top = [...rows].sort((a, b) => b.heat - a.heat).slice(0, 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H }}>
      {/* guide lines: util 80, fee 150 */}
      <line x1={x(80)} x2={x(80)} y1={padT} y2={H - padB} stroke="#26262B" strokeDasharray="3 3" />
      <line x1={padL} x2={W - padR} y1={y(150)} y2={y(150)} stroke="#26262B" strokeDasharray="3 3" />
      <text x={W - padR - 2} y={y(150) - 3} textAnchor="end" fontSize={8} fill="#5E5E66" fontFamily="var(--font-mono)">special threshold</text>
      <text x={W - padR} y={H - padB - 4} textAnchor="end" fontSize={9} fill="#5E5E66" fontFamily="var(--font-mono)">High util / low fee → re-rate</text>
      {/* axes labels */}
      <text x={(padL + W - padR) / 2} y={H - 6} textAnchor="middle" fontSize={9} fill="#8A8A92" fontFamily="var(--font-mono)">Utilization %</text>
      <text x={12} y={(padT + H - padB) / 2} textAnchor="middle" fontSize={9} fill="#8A8A92" fontFamily="var(--font-mono)" transform={`rotate(-90 12 ${(padT + H - padB) / 2})`}>Fee (bps)</text>
      {[0, 200, 400, 600].filter((f) => f <= capFee).map((f) => (
        <text key={f} x={padL - 5} y={y(f) + 3} textAnchor="end" fontSize={8} fill="#5E5E66" fontFamily="var(--font-mono)">{f}</text>
      ))}
      {rows.map((r) => (
        <circle key={r.ticker} cx={x(r.utilization)} cy={y(r.feeBps)} r={3} fill={CLS_COLOR[r.classification]} opacity={0.8} />
      ))}
      {top.map((r) => (
        <text key={`l-${r.ticker}`} x={x(r.utilization) + 4} y={y(r.feeBps) - 3} fontSize={8} fill="#E6E6E6" fontFamily="var(--font-mono)">{r.ticker}</text>
      ))}
    </svg>
  );
}

export default function SqueezeRadar() {
  const [view, setView] = useState<View>("BOARD");
  const [yahooRows, setYahooRows] = useState<YahooShortInterestRow[]>([]);
  const [yahooStatus, setYahooStatus] = useState<"LOADING" | "YAHOO" | "ERR">("LOADING");
  useEffect(() => {
    let active = true;
    fetch("/api/securities-finance/squeeze/short-interest")
      .then((response) => {
        if (!response.ok) throw new Error("Yahoo SI route unavailable");
        return response.json() as Promise<{ source: "YAHOO" | "ERR"; rows: YahooShortInterestRow[] }>;
      })
      .then((result) => {
        if (!active) return;
        if (result.source === "YAHOO" && Array.isArray(result.rows)) {
          setYahooRows(result.rows);
          setYahooStatus("YAHOO");
        } else {
          setYahooStatus("ERR");
        }
      })
      .catch(() => { if (active) setYahooStatus("ERR"); });
    return () => { active = false; };
  }, []);
  const baseBoard = useMemo(() => getSqueezeBoard(), []);
  const board = useMemo(() => mergeShortInterest(baseBoard, yahooRows), [baseBoard, yahooRows]);
  const yahooCount = board.filter((row) => row.shortInterestSource === "YAHOO").length;
  const squeeze = useMemo(() => getSqueezeCandidates(board), [board]);
  const rerate = useMemo(() => getRerateCandidates(board), [board]);
  const specials = useMemo(() => getSpecialsWatch(board), [board]);
  const sectors = useMemo(() => getSectorHeat(board), [board]);
  const alerts = useMemo(() => getHeatAlerts(board), [board]);
  const summary = useMemo(() => getSqueezeSummary(board), [board]);
  const maxSectorHeat = Math.max(...sectors.map((s) => s.heat), 1);
  const btn = "rounded-sm border px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide transition-colors";

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader code="SQZ" title="Borrow-Demand / Squeeze Radar" desc="Heat score · fee momentum · squeeze risk" right={<span className="flex items-center gap-2"><ProvenanceBadge source="SIM" simSelected /><span className="text-3xs text-term-text-mute">{yahooStatus === "LOADING" ? "Yahoo SI loading" : yahooCount ? "Yahoo SI " + yahooCount + "/" + board.length : "Yahoo SI unavailable"}</span></span>} />

      <KpiStrip>
        <Stat label="Hottest Name" value={summary.hottest} sub="by heat score" tone="amber" />
        <Stat label="Heating" value={summary.heatingCount} sub="fees accelerating" tone="down" />
        <Stat label="Specials / HTB" value={summary.specials} sub="of book" tone="amber" />
        <Stat label="Avg Utilization" value={`${summary.avgUtil}%`} sub="lendable" />
        <Stat label="Top Squeeze" value={summary.topSqueeze} sub="SI × DTC × fee" tone="down" />
        <Stat label="Heat Alerts" value={summary.alerts} sub="threshold breaches" tone="amber" />
      </KpiStrip>

      <div className="flex flex-wrap items-center gap-1 border-b border-term-border bg-term-panel px-3 py-1.5">
        {VIEWS.map((v) => (
          <button key={v.key} onClick={() => setView(v.key)} className={clsx(btn, view === v.key ? "border-term-amber bg-term-amber text-black" : "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text")}>{v.label}</button>
        ))}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-2">
        {/* Heat Board */}
        {view === "BOARD" && (
          <Panel title="Heat Board" code="SQZ-1" accent right={<span className="text-3xs text-term-text-mute">{board.length} names · ranked by heat</span>}>
            <div className="max-h-[64vh] overflow-auto">
              <table className="w-full border-collapse tnum">
                <thead className="sticky top-0 bg-term-panel-2">
                  <tr>
                    {["Ticker", "Sector", "Class", "Util", "Fee", "Fee Δ20d", "SI %", "DTC", "Dir", "Heat"].map((c, i) => (
                      <th key={c} className={clsx("border-b border-term-border px-2 py-1 text-3xs font-semibold uppercase tracking-wider text-term-text-mute", i === 0 || i === 1 || i === 2 ? "text-left" : i === 8 ? "text-center" : "text-right")}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {board.map((r) => (
                    <tr key={r.ticker} className="border-b border-term-border-soft hover:bg-term-panel-2">
                      <td className="px-2 py-1 text-left text-2xs font-semibold text-term-amber">{r.ticker}</td>
                      <td className="px-2 py-1 text-left text-3xs text-term-text-mute">{r.sector}</td>
                      <td className="px-2 py-1 text-left"><Tag tone={CLS_TONE[r.classification]}>{r.classification}</Tag></td>
                      <td className="px-2 py-1 text-right text-2xs text-term-text">{r.utilization}%</td>
                      <td className="px-2 py-1 text-right text-2xs text-term-text">{r.feeBps}</td>
                      <td className={clsx("px-2 py-1 text-right text-2xs", pnlClass(r.feeMom20))}>{fmtSigned(r.feeMom20, 0)}%</td>
                      <td className="px-2 py-1 text-right text-2xs text-term-text-dim" title={r.shortInterestSource === "YAHOO" ? "Yahoo Finance · reported " + r.shortInterestAsOf : "Simulated"}>{r.shortInterestPct}{r.shortInterestSource === "YAHOO" && <span className="ml-1 text-term-blue">Y</span>}</td>
                      <td className="px-2 py-1 text-right text-2xs text-term-text-dim" title={r.shortInterestSource === "YAHOO" ? "Yahoo Finance · reported " + r.shortInterestAsOf : "Simulated"}>{r.daysToCover}</td>
                      <td className={clsx("px-2 py-1 text-center text-3xs font-semibold", r.direction === "HEATING" ? "text-term-down" : r.direction === "COOLING" ? "text-term-up" : "text-term-text-mute")}>{r.direction === "HEATING" ? "▲" : r.direction === "COOLING" ? "▼" : "—"}</td>
                      <td className="px-2 py-1 text-right"><span className="inline-flex justify-end"><HeatBar v={r.heat} /></span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {/* Quadrant */}
        {view === "QUAD" && (
          <Panel title="Fee × Utilization Quadrant" code="SQZ-2" accent right={<span className="text-3xs text-term-text-mute">top-right = special · bottom-right = re-rate</span>}>
            <div className="p-2"><Quadrant rows={board} /></div>
            <div className="flex flex-wrap gap-3 border-t border-term-border px-3 py-1.5 text-3xs">
              {(["GC", "WARM", "SPECIAL", "HTB"] as Classification[]).map((c) => (
                <span key={c} className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: CLS_COLOR[c] }} /><span className="text-term-text-mute">{c}</span></span>
              ))}
              <span className="ml-auto text-term-text-mute">High utilization with a low fee = the clearest re-rate opportunity.</span>
            </div>
          </Panel>
        )}

        {/* Squeeze Candidates */}
        {view === "SQUEEZE" && (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {squeeze.map((r) => (
              <Panel key={r.ticker} title={`${r.ticker} — ${r.name}`} code="SQZ-3" accent={r.squeezeScore >= 70} right={<Tag tone={CLS_TONE[r.classification]}>{r.classification}</Tag>}>
                <div className="grid grid-cols-4 divide-x divide-term-border border-b border-term-border">
                  <Cell label="Squeeze" value={`${r.squeezeScore}`} tone={r.squeezeScore >= 70 ? "down" : "amber"} />
                  <Cell label={r.shortInterestSource === "YAHOO" ? "Short Int · Yahoo" : "Short Int · SIM"} value={`${r.shortInterestPct}%`} />
                  <Cell label="Days Cover" value={`${r.daysToCover}`} />
                  <Cell label="5d Px" value={`${fmtSigned(r.priceChg5, 1)}%`} tone={r.priceChg5 >= 0 ? "up" : "down"} />
                </div>
                <div className="flex items-center gap-3 px-3 py-2 text-3xs">
                  <span className="text-term-text-mute">Fee <span className="tnum text-term-text">{r.feeBps}bps</span></span>
                  <span className={pnlClass(r.feeMom5)}>5d {fmtSigned(r.feeMom5, 0)}%</span>
                  <span className="text-term-text-mute">P/C <span className="tnum text-term-text-dim">{r.putCall}</span></span>
                  <span className="ml-auto inline-flex"><Sparkline data={r.feeHist} width={70} height={16} /></span>
                </div>
              </Panel>
            ))}
            {squeeze.length === 0 && <div className="p-6 text-2xs text-term-text-mute">No squeeze candidates clear the thresholds right now.</div>}
          </div>
        )}

        {/* Re-rate */}
        {view === "RERATE" && (
          <Panel title="Re-rate Candidates" code="SQZ-2b" accent right={<span className="text-3xs text-term-text-mute">high utilization · fee below special — agency money view</span>}>
            <table className="w-full border-collapse tnum">
              <thead className="bg-term-panel-2">
                <tr>{["Ticker", "Sector", "Util", "Fee", "Fee Δ20d", "SI %", "Heat"].map((c, i) => <th key={c} className={clsx("border-b border-term-border px-3 py-1 text-3xs font-semibold uppercase tracking-wider text-term-text-mute", i < 2 ? "text-left" : "text-right")}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {rerate.map((r) => (
                  <tr key={r.ticker} className="border-b border-term-border-soft hover:bg-term-panel-2">
                    <td className="px-3 py-1 text-left text-2xs font-semibold text-term-amber">{r.ticker}</td>
                    <td className="px-3 py-1 text-left text-3xs text-term-text-mute">{r.sector}</td>
                    <td className="px-3 py-1 text-right text-2xs text-term-text">{r.utilization}%</td>
                    <td className="px-3 py-1 text-right text-2xs text-term-text">{r.feeBps}</td>
                    <td className={clsx("px-3 py-1 text-right text-2xs", pnlClass(r.feeMom20))}>{fmtSigned(r.feeMom20, 0)}%</td>
                    <td className="px-3 py-1 text-right text-2xs text-term-text-dim">{r.shortInterestPct}</td>
                    <td className="px-3 py-1 text-right"><span className="inline-flex justify-end"><HeatBar v={r.heat} /></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-term-border px-3 py-1 text-3xs text-term-text-mute">Names with demand (high utilization) priced below their special threshold — strongest re-rate-to-market candidates.</div>
          </Panel>
        )}

        {/* Specials Watch */}
        {view === "SPECIALS" && (
          <Panel title="Specials Watch" code="SQZ-4" accent right={<span className="text-3xs text-term-text-mute">fee path · recall risk</span>}>
            <div className="divide-y divide-term-border-soft">
              {specials.map((r) => (
                <div key={r.ticker} className="flex items-center gap-2 px-3 py-1.5 text-2xs">
                  <span className="w-14 shrink-0 font-semibold text-term-amber">{r.ticker}</span>
                  <span className="w-16 shrink-0"><Tag tone={CLS_TONE[r.classification]}>{r.classification}</Tag></span>
                  <span className="hidden w-28 shrink-0 truncate text-3xs text-term-text-mute md:inline">{r.sector}</span>
                  <span className="tnum w-16 shrink-0 text-right text-term-text">{r.feeBps}bps</span>
                  <span className={clsx("tnum w-14 shrink-0 text-right text-3xs", pnlClass(r.feeMom20))}>{fmtSigned(r.feeMom20, 0)}%</span>
                  <span className="inline-flex flex-1 justify-end"><Sparkline data={r.feeHist} width={90} height={16} /></span>
                  <span className="w-20 shrink-0 text-right">{r.utilization >= 90 ? <Tag tone="down">RECALL RISK</Tag> : <span className="tnum text-3xs text-term-text-mute">{r.utilization}% util</span>}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* Sector Heat */}
        {view === "SECTOR" && (
          <Panel title="Sector Heat" code="SQZ-5" accent>
            <div className="grid grid-cols-1 gap-px bg-term-border sm:grid-cols-2">
              {sectors.map((s) => (
                <div key={s.sector} className="flex items-center gap-3 bg-term-panel px-3 py-2 text-2xs">
                  <span className="w-32 shrink-0 truncate font-semibold text-term-text">{s.sector}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-sm bg-term-panel-3"><span className="block h-full rounded-sm" style={{ width: `${(s.heat / maxSectorHeat) * 100}%`, background: heatColor(s.heat) }} /></span>
                  <span className="tnum w-8 text-right font-bold" style={{ color: heatColor(s.heat) }}>{s.heat}</span>
                  <span className="tnum w-16 text-right text-3xs text-term-text-mute">{s.avgUtil}% · {s.count}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* Alerts */}
        {view === "ALERTS" && (
          <Panel title="Heat-Up Alerts" code="SQZ-6" accent right={<span className="text-3xs text-term-text-mute">would stream into ALRT</span>}>
            <div className="divide-y divide-term-border-soft">
              {alerts.map((a, i) => (
                <div key={`${a.ticker}-${i}`} className="flex items-center gap-3 px-3 py-1.5 text-2xs">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: heatColor(a.heat) }} />
                  <span className="w-14 shrink-0 font-semibold text-term-amber">{a.ticker}</span>
                  <span className="w-44 shrink-0 text-term-text">{a.trigger}</span>
                  <span className="min-w-0 flex-1 truncate text-3xs text-term-text-mute">{a.detail}</span>
                  <span className="inline-flex shrink-0"><HeatBar v={a.heat} /></span>
                </div>
              ))}
              {alerts.length === 0 && <div className="p-6 text-2xs text-term-text-mute">No threshold breaches right now.</div>}
            </div>
          </Panel>
        )}
      </div>

      <div className="border-t border-term-border bg-term-panel px-3 py-1.5 text-3xs text-term-text-mute">
        <span className="text-term-amber">SQZ</span> — borrow-demand radar built on the lending book: heat score, fee momentum, the fee×utilization re-rate view, and squeeze risk.
        {" "}Short interest and days-to-cover: {yahooCount} Yahoo reported, {board.length - yahooCount} SIM. Yahoo observations carry their report date in row tooltips; fee, utilization, options, price action and other book signals remain SIM.
      </div>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" | "amber" }) {
  const c = tone === "up" ? "text-term-up" : tone === "down" ? "text-term-down" : tone === "amber" ? "text-term-amber" : "text-term-text";
  return (
    <div className="px-3 py-1.5">
      <div className="text-3xs uppercase tracking-wider text-term-text-mute">{label}</div>
      <div className={clsx("tnum text-sm font-semibold", c)}>{value}</div>
    </div>
  );
}
