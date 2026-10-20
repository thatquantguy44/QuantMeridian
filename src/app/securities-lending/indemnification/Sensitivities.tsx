import { Panel } from "@/components/ui/Panel";
import { LineChart } from "@/components/charts/LineChart";
import type { IndemnificationResult, Sensitivity } from "@/lib/indemnificationApi";
import { fmtMoney } from "@/lib/indemnificationView";
import { runStamp } from "./Overview";
import { MetricText, Notice, TD, TH } from "./ui";

const TITLES: Record<string, { title: string; unit: string; note: string }> = {
  margin_pct: { title: "Margin", unit: "%", note: "Collateral and the reinvestment pool are resized with the margin. Default shortfall falls as margin rises; reinvestment loss rises because more cash is reinvested." },
  mpor_days: { title: "Close-out period", unit: " days", note: "One close-out period for every position, replacing the profile's four periods." },
  rho_w: { title: "Wrong-way correlation", unit: "", note: "Higher values tie borrower defaults more tightly to falling equities." },
  collateral_substitution: { title: "Government collateral substitution", unit: "", note: "Share of the largest security-collateral borrower's collateral swapped into the most liquid government security." },
};
const describe = (s: Sensitivity) =>
  TITLES[s.parameter] ?? { title: s.parameter.startsWith("profile:") ? `Profile: ${s.parameter.slice(8)}` : s.parameter, unit: "", note: "" };

export function Sensitivities({ result }: { result: IndemnificationResult }) {
  if (result.sensitivities.length === 0) {
    return <Notice tone="neutral" title="No sensitivities in this run">Turn on Sensitivities in the run settings and run again. Each sweep re-runs the model on the same random draws, so differences between points come from the parameter and not from noise.</Notice>;
  }
  return (
    <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
      {result.sensitivities.map((s) => {
        const d = describe(s);
        return (
          <Panel key={s.parameter} title={d.title} code="INDEM-13" accent subtitle="one parameter, common random numbers">
            <div className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2">
              {[
                { title: "Default shortfall EL", data: s.el_default_shortfall, color: "#FF8C00" },
                { title: "Reinvestment EL", data: s.el_reinvestment, color: "#4DA3FF" },
              ].map((c) => (
                <div key={c.title}>
                  <div className="term-label mb-0.5">{c.title}</div>
                  <LineChart height={120} labels={s.values.map((v) => `${v}${d.unit}`)} yFmt={fmtMoney} series={[{ name: c.title, data: c.data.map((m) => m.value), color: c.color }]} />
                </div>
              ))}
            </div>
            <table className="w-full border-collapse tnum">
              <thead className="bg-term-panel-2">
                <tr>
                  <th className={`${TH} text-left`}>Value</th><th className={`${TH} text-right`}>Total EL</th>
                  <th className={`${TH} text-right`}>Default</th><th className={`${TH} text-right`}>Reinvestment</th><th className={`${TH} text-right`}>PFE 99</th>
                </tr>
              </thead>
              <tbody>
                {s.values.map((v, i) => (
                  <tr key={v} className="border-b border-term-border-soft hover:bg-term-panel-2">
                    <td className={`${TD} text-left font-semibold text-term-amber`}>{v}{d.unit}</td>
                    <td className={`${TD} text-right text-term-text`}><MetricText m={s.el[i]} /></td>
                    <td className={`${TD} text-right text-term-text-dim`}><MetricText m={s.el_default_shortfall[i]} /></td>
                    <td className={`${TD} text-right text-term-text-dim`}><MetricText m={s.el_reinvestment[i]} /></td>
                    <td className={`${TD} text-right text-term-text-dim`}><MetricText m={s.pfe99[i]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-term-border px-3 py-1 text-3xs text-term-text-mute">{d.note} Sweeps use the sweep path count, not the main run's. Main run: {runStamp(result)}.</div>
          </Panel>
        );
      })}
    </div>
  );
}
