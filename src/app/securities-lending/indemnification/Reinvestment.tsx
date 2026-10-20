import { KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat } from "@/components/ui/Panel";
import type { IndemnificationResult } from "@/lib/indemnificationApi";
import type { BookSummary } from "@/lib/indemnificationCompose";
import { fmtMoney, fmtPct } from "@/lib/indemnificationView";
import { runStamp } from "./Overview";
import { MetricText, TD, TH } from "./ui";

export function Reinvestment({ result, book }: { result: IndemnificationResult; book: BookSummary }) {
  const r = result.program.gaussian.with_wrong_way.reinvestment;
  const total = result.program.gaussian.with_wrong_way.total.el.value;
  const share = total > 0 ? r.el.value / total : null;
  const cash = book.pool_positions.reduce((a, p) => a + p.allocation, 0);
  const stamp = runStamp(result);
  const kpi = (label: string, m: typeof r.el, tone?: "amber" | "down") => (
    <Stat label={label} value={fmtMoney(m.value)} tone={tone} sub={<>{m.std_error === null ? "SE n/a" : `SE ${fmtMoney(m.std_error)}`}<br /><span className="text-3xs text-term-text-mute">{stamp}</span></>} />
  );
  const run = result.stresses.find((s) => s.id === "reinvestment_run");
  return (
    <div className="flex flex-col gap-2">
      <KpiStrip>
        {kpi("Reinvestment EL", r.el, "amber")}
        {kpi("VaR 99.9", r.var999, "down")}
        {kpi("ES 99.9", r.es999, "down")}
        {kpi("VaR 99", r.var99)}
        <Stat label="Share of total EL" value={share === null ? "n/a" : fmtPct(share, 1)} sub={<>of expected loss<br /><span className="text-3xs text-term-text-mute">{stamp}</span></>} />
        <Stat label="Cash collateral" value={fmtMoney(book.cash_collateral)} sub={<>pool {fmtMoney(cash)}<br /><span className="text-3xs text-term-text-mute">{result.source}</span></>} />
      </KpiStrip>

      <Panel title="Reinvestment pool" code="INDEM-17" accent subtitle="where the cash collateral is invested">
        <table className="w-full border-collapse tnum">
          <thead className="bg-term-panel-2">
            <tr><th className={`${TH} text-left`}>Position</th><th className={`${TH} text-left`}>Instrument</th><th className={`${TH} text-left`}>Liquidity</th><th className={`${TH} text-left`}>Credit</th><th className={`${TH} text-right`}>Allocation</th></tr>
          </thead>
          <tbody>
            {book.pool_positions.map((p) => (
              <tr key={p.id} className="border-b border-term-border-soft hover:bg-term-panel-2">
                <td className={`${TD} text-left font-semibold text-term-amber`}>{p.id}</td>
                <td className={`${TD} text-left text-term-text`}>{p.instrument}</td>
                <td className={`${TD} text-left text-term-text-mute`}>{p.liquidity_bucket}</td>
                <td className={`${TD} text-left text-term-text-mute`}>{p.credit_bucket}</td>
                <td className={`${TD} text-right text-term-text`}>{fmtMoney(p.allocation)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-term-border px-3 py-1 text-3xs text-term-text-mute">Loss is the peak rise in cash owed minus pool value. The pool sells most-liquid first, with forced-sale discounts, to return cash when a borrower defaults or returns collateral. Pool close-out uses the profile's forced-sale period.</div>
      </Panel>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <Panel title="Reinvestment loss by owner" code="INDEM-18" accent>
          <table className="w-full border-collapse tnum">
            <thead className="bg-term-panel-2"><tr><th className={`${TH} text-left`}>Owner</th><th className={`${TH} text-right`}>Expected loss</th></tr></thead>
            <tbody>
              {result.owners.map((o) => (
                <tr key={o.owner_id} className="border-b border-term-border-soft">
                  <td className={`${TD} text-left text-term-text`}>{o.owner_id}</td>
                  <td className={`${TD} text-right text-term-text`}><MetricText m={o.el.reinvestment} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Reinvestment run stress" code="INDEM-19" accent>
          {run ? (
            <div className="p-3 text-2xs text-term-text-dim">
              <div className="mb-1 text-term-text">{run.label}</div>
              <div className="tnum">Loss: <span className="font-semibold text-term-down">{fmtMoney(run.by_borrower.reduce((a, b) => a + b.reinvestment, 0))}</span></div>
              <div className="mt-1 text-3xs text-term-text-mute">Deterministic: no seed and no standard error.</div>
            </div>
          ) : <div className="p-3 text-3xs text-term-text-mute">Stresses were not run.</div>}
        </Panel>
      </div>
    </div>
  );
}
