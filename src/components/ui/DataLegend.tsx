import { useState } from "react";
import { PROVENANCE_META, PROVENANCE_TONE_CLASS, type ProvenanceSource } from "@/lib/provenance";

const DISPLAY_TIERS: { source: ProvenanceSource; upgrade: string }[] = [
  { source: "FRED", upgrade: "Legacy FRED API — configure FRED_API_KEY (offline helpers only)" },
  { source: "LIVE", upgrade: "Live provider (news/social/Polymarket only; Tier B exception)" },
  { source: "DB", upgrade: "Gold DB — configure MACRO_DB_URL for series/market data (primary)" },
  { source: "FILE", upgrade: "Local exported-file cache (legacy, decommissioned)" },
  { source: "ETL", upgrade: "Committed macro_data_etl snapshot (frozen 2026-06-24)" },
  { source: "SNAPSHOT", upgrade: "Committed build-time snapshot (Phase 6: removed from Tier A routes)" },
  { source: "ECON", upgrade: "Deterministic econ model (fallback only)" },
  { source: "SIM", upgrade: "Deterministic simulation (fallback only; enable SIM toggle to use)" },
];

export function DataLegend({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`border border-term-border bg-term-panel ${className ?? ""}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-2xs text-term-text-dim hover:text-term-text"
      >
        <span className="font-semibold uppercase tracking-wide">Data Sources & Provenance</span>
        <span className="text-term-text-mute">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t border-term-border px-3 py-2">
          <table className="w-full text-3xs">
            <thead>
              <tr className="border-b border-term-border-soft text-term-text-mute">
                <th className="pb-1 text-left font-semibold">Badge</th>
                <th className="pb-1 text-left font-semibold">Tier</th>
                <th className="pb-1 text-left font-semibold">Description</th>
              </tr>
            </thead>
            <tbody>
              {DISPLAY_TIERS.map(({ source, upgrade }) => {
                const meta = PROVENANCE_META[source];
                const tone = PROVENANCE_TONE_CLASS[meta.tone];
                return (
                  <tr key={source} className="border-b border-term-border-soft last:border-0">
                    <td className="py-1 pr-2">
                      <span className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-px text-3xs font-semibold uppercase tracking-wide ${tone.pill}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                        {meta.label}
                      </span>
                    </td>
                    <td className="py-1 pr-2 text-term-text-dim">{meta.live ? "Live" : "Offline"}</td>
                    <td className="py-1 text-term-text-mute">{upgrade}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-2 space-y-1 text-3xs text-term-text-mute">
            <p><span className="text-term-amber">Frequency</span> badges (DAILY, WEEKLY, MONTHLY, QUARTERLY) indicate how often the upstream source publishes new data.</p>
            <p>Panels marked <span className="text-term-amber">SIM</span> use deterministic simulations. Configure the relevant API key or pipeline URL to upgrade to live data.</p>
          </div>
        </div>
      )}
    </div>
  );
}
