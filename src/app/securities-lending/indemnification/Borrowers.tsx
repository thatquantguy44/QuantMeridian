import { useMemo, useState } from "react";
import clsx from "clsx";
import { Panel, Tag } from "@/components/ui/Panel";
import { LineChart } from "@/components/charts/LineChart";
import type { IndemnificationResult } from "@/lib/indemnificationApi";
import type { BookSummary } from "@/lib/indemnificationCompose";
import { borrowerRows, fmtBps, fmtMoney, fmtPct, sortBorrowers, type BorrowerSortKey } from "@/lib/indemnificationView";
import type { UiState } from "./state";
import { runStamp } from "./Overview";
import { NumInput, TD, TH } from "./ui";

const COLUMNS: { key: BorrowerSortKey; label: string; align: "left" | "right"; hint?: string }[] = [
  { key: "borrower", label: "Borrower", align: "left" },
  { key: "pd", label: "1y PD", align: "right", hint: "One-year probability of default from the rating table or your spread" },
  { key: "el", label: "EL", align: "right", hint: "Expected loss over the horizon, wrong-way on" },
  { key: "pfe99", label: "PFE 99", align: "right", hint: "Peak potential exposure at 99%, default channel" },
  { key: "euler", label: "Euler ES 99", align: "right", hint: "This borrower's share of program ES at 99%" },
  { key: "estar", label: "E* (Basel)", align: "right", hint: "Basel comprehensive-approach exposure after haircuts: a cross-check, not a capital figure" },
  { key: "fee", label: "Fee", align: "right", hint: "Annual indemnification fee in bp of average loan value" },
  { key: "cost", label: "Econ. cost", align: "right", hint: "Expected loss plus cost of economic capital, in bp" },
  { key: "flag", label: "Flag", align: "left" },
];

export function Borrowers({
  result, book, ui, setUi,
}: { result: IndemnificationResult; book: BookSummary; ui: UiState; setUi: (u: UiState) => void }) {
  const [sortKey, setSortKey] = useState<BorrowerSortKey>("el");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<string | null>(null);
  const names = useMemo(() => Object.fromEntries(book.borrowers.map((b) => [b.id, { name: b.name, rating: b.rating }])), [book]);
  const rows = useMemo(() => sortBorrowers(borrowerRows(result, names), sortKey, direction), [result, names, sortKey, direction]);
  const chosen = result.borrowers.find((b) => b.borrower_id === (selected ?? rows[0]?.id));
  const priced = result.borrowers.some((b) => b.pricing !== null);

  const sortBy = (key: BorrowerSortKey) => {
    if (key === sortKey) setDirection(direction === "desc" ? "asc" : "desc");
    else { setSortKey(key); setDirection(key === "borrower" ? "asc" : "desc"); }
  };
  const setCredit = (id: string, spread: number | null, recovery: number | null) => {
    const credit = { ...ui.credit };
    if (spread === null) delete credit[id];
    else credit[id] = { spread_bps: spread, recovery };
    setUi({ ...ui, credit });
  };

  return (
    <div className="flex flex-col gap-2">
      <Panel title="Borrowers" code="INDEM-5" accent right={<Tag tone="amber">{result.source}</Tag>}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse tnum">
            <thead className="bg-term-panel-2">
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} className={clsx(TH, c.align === "left" ? "text-left" : "text-right")} title={c.hint} aria-sort={sortKey === c.key ? (direction === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" onClick={() => sortBy(c.key)} className="uppercase tracking-wider hover:text-term-amber">
                      {c.label}{sortKey === c.key ? (direction === "asc" ? " ▲" : " ▼") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setSelected(r.id)} className={clsx("cursor-pointer border-b border-term-border-soft hover:bg-term-panel-2", chosen?.borrower_id === r.id && "bg-term-panel-2")}>
                  <td className={`${TD} text-left`}>
                    <span className="font-semibold text-term-amber">{r.name}</span>{" "}
                    <span className="text-3xs text-term-text-mute">{r.rating}{r.creditSource === "USER_SPREAD" ? " · your spread" : ""}</span>
                  </td>
                  <td className={`${TD} text-right text-term-text`}>{fmtPct(r.pd)}</td>
                  <td className={`${TD} text-right text-term-text`}>{fmtMoney(r.el)}</td>
                  <td className={`${TD} text-right text-term-text-dim`}>{fmtMoney(r.pfe99)}</td>
                  <td className={`${TD} text-right text-term-text-dim`}>{fmtMoney(r.euler)}</td>
                  <td className={`${TD} text-right text-term-text-dim`}>{r.eStar === null ? "n/a" : fmtMoney(r.eStar)}</td>
                  <td className={`${TD} text-right text-term-text-dim`}>{r.feeBps === null ? "n/a" : fmtBps(r.feeBps)}</td>
                  <td className={`${TD} text-right text-term-text`}>{r.costBps === null ? "n/a" : fmtBps(r.costBps)}</td>
                  <td className={`${TD} text-left`}>{r.flagged === null ? <span className="text-term-text-mute">n/a</span> : r.flagged ? <Tag tone="down">Reprice</Tag> : <Tag tone="up">OK</Tag>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-term-border px-3 py-1 text-3xs text-term-text-mute">
          {priced ? "Costs are annual and use the economic cost only; the Basel figure is a cross-check." : "Fees, costs and flags are produced only by an annual run over 252 business days."} {runStamp(result)}
        </div>
      </Panel>

      {chosen && (
        <Panel title={`Exposure: ${names[chosen.borrower_id]?.name ?? chosen.borrower_id}`} code="INDEM-6" accent className="max-w-4xl">
          <div className="p-2">
            <LineChart height={180} labels={chosen.exposure_profile.times_days.map((d) => `${d}d`)} yFmt={fmtMoney} series={[
              { name: "Expected exposure", data: chosen.exposure_profile.ee, color: "#4DA3FF", area: true },
              { name: "PFE 95", data: chosen.exposure_profile.pfe95, color: "#FF8C00" },
              { name: "PFE 99", data: chosen.exposure_profile.pfe99, color: "#FF3B3B", dashed: true },
            ]} />
          </div>
          <div className="border-t border-term-border px-3 py-1 text-3xs text-term-text-mute">Hazard {fmtPct(chosen.hazard, 3)} per year · {runStamp(result)}</div>
        </Panel>
      )}

      <Panel title="Credit inputs" code="INDEM-7" accent subtitle="optional: replaces the rating table for a borrower on the next run">
        <table className="w-full border-collapse tnum">
          <thead className="bg-term-panel-2">
            <tr><th className={`${TH} text-left`}>Borrower</th><th className={`${TH} text-right`}>Rating</th><th className={`${TH} w-36 text-right`}>Credit spread (bp)</th><th className={`${TH} w-36 text-right`}>Recovery (0 to &lt;1)</th></tr>
          </thead>
          <tbody>
            {book.borrowers.map((b) => {
              const entry = ui.credit[b.id];
              return (
                <tr key={b.id} className="border-b border-term-border-soft">
                  <td className={`${TD} text-left text-term-text`}>{b.name}</td>
                  <td className={`${TD} text-right text-term-text-mute`}>{b.rating}</td>
                  <td className={TD}><NumInput nullable label={`Credit spread for ${b.name}`} value={entry ? entry.spread_bps : null} onChange={(v) => setCredit(b.id, v, entry?.recovery ?? null)} /></td>
                  <td className={TD}><NumInput nullable label={`Recovery for ${b.name}`} value={entry ? entry.recovery : null} disabled={!entry} onChange={(v) => entry && setCredit(b.id, entry.spread_bps, v)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="border-t border-term-border px-3 py-1 text-3xs text-term-text-mute">Leave a spread empty to use the rating table. Recovery empty uses the model default. Changes apply when you run again.</div>
      </Panel>
    </div>
  );
}
