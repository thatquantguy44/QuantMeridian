import { useState } from "react";
import clsx from "clsx";
import { Panel, Tag } from "@/components/ui/Panel";
import type { IndemnificationResult } from "@/lib/indemnificationApi";
import { fmtMoney, stressTotals } from "@/lib/indemnificationView";
import { Notice, TD, TH } from "./ui";

export function Stresses({ result }: { result: IndemnificationResult }) {
  const [id, setId] = useState<string | null>(null);
  if (result.stresses.length === 0) {
    return <Notice tone="neutral" title="No stresses in this run">Turn on Stresses in the run settings and run again.</Notice>;
  }
  const totals = stressTotals(result.stresses);
  const active = result.stresses.find((s) => s.id === (id ?? totals[0].id))!;
  return (
    <div className="flex flex-col gap-2">
      <Panel title="Deterministic stresses" code="INDEM-14" accent right={<Tag tone="amber">{result.source}</Tag>}>
        <table className="w-full border-collapse tnum">
          <thead className="bg-term-panel-2">
            <tr><th className={`${TH} text-left`}>Scenario</th><th className={`${TH} text-right`}>Default shortfall</th><th className={`${TH} text-right`}>Reinvestment</th><th className={`${TH} text-right`}>Total</th><th className={`${TH} text-left`}>Worst borrower</th></tr>
          </thead>
          <tbody>
            {totals.map((t) => (
              <tr key={t.id} onClick={() => setId(t.id)} className={clsx("cursor-pointer border-b border-term-border-soft hover:bg-term-panel-2", active.id === t.id && "bg-term-panel-2")}>
                <td className={`${TD} text-left`}><div className="font-semibold text-term-amber">{t.id.replace(/_/g, " ")}</div><div className="max-w-xl whitespace-normal text-3xs text-term-text-mute">{t.label}</div></td>
                <td className={`${TD} text-right text-term-text`}>{fmtMoney(t.defaultShortfall)}</td>
                <td className={`${TD} text-right text-term-text`}>{fmtMoney(t.reinvestment)}</td>
                <td className={`${TD} text-right font-semibold text-term-text`}>{fmtMoney(t.defaultShortfall + t.reinvestment)}</td>
                <td className={`${TD} text-left text-term-text-dim`}>{t.worstBorrower ? `${t.worstBorrower.id} · ${fmtMoney(t.worstBorrower.loss)}` : <span className="text-term-text-mute">no loss</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-term-border px-3 py-1 text-3xs text-term-text-mute">Each stress is one hand-built price path with no randomness: no seed, no standard error. The borrower defaults first and the shock lands one day later, inside the close-out period. Rates and FX rows are each borrower's own default, not a joint event. Select a row for detail.</div>
      </Panel>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <Panel title={`By borrower: ${active.id.replace(/_/g, " ")}`} code="INDEM-15" accent>
          <table className="w-full border-collapse tnum">
            <thead className="bg-term-panel-2"><tr><th className={`${TH} text-left`}>Borrower</th><th className={`${TH} text-right`}>Default shortfall</th><th className={`${TH} text-right`}>Reinvestment</th></tr></thead>
            <tbody>
              {active.by_borrower.map((r) => (
                <tr key={r.borrower_id} className="border-b border-term-border-soft">
                  <td className={`${TD} text-left text-term-text`}>{r.borrower_id}</td>
                  <td className={`${TD} text-right ${r.default_shortfall > 0 ? "text-term-down" : "text-term-text-mute"}`}>{fmtMoney(r.default_shortfall)}</td>
                  <td className={`${TD} text-right ${r.reinvestment > 0 ? "text-term-down" : "text-term-text-mute"}`}>{fmtMoney(r.reinvestment)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="By owner" code="INDEM-16" accent>
          <table className="w-full border-collapse tnum">
            <thead className="bg-term-panel-2"><tr><th className={`${TH} text-left`}>Owner</th><th className={`${TH} text-right`}>Default shortfall</th><th className={`${TH} text-right`}>Reinvestment</th></tr></thead>
            <tbody>
              {active.by_owner.map((r) => (
                <tr key={r.owner_id} className="border-b border-term-border-soft">
                  <td className={`${TD} text-left text-term-text`}>{r.owner_id}</td>
                  <td className={`${TD} text-right text-term-text`}>{fmtMoney(r.default_shortfall)}</td>
                  <td className={`${TD} text-right text-term-text`}>{fmtMoney(r.reinvestment)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
