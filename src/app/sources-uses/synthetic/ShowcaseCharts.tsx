import { CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import {
  FAMILY_META, TIER_LABELS,
  type FeasibleResult, type Scenario, type SimResult, type SourceFamily, type VerificationCheck,
} from "@/data/sourcesUsesSynthetic";
import { bps, mm, num, pct } from "./format";

/** Capacity track with used fill per source, binding flag and shadow price. */
export function SourceUtilization({ result }: { result: FeasibleResult }) {
  const max = Math.max(...result.problem.sources.map((s) => s.amount), 1);
  return (
    <ul className="space-y-2" aria-label="Source utilisation">
      {result.problem.sources.map((s) => {
        const used = result.sourceUsed[s.id];
        const binding = s.amount > 0 && s.amount - used < 1e-6 * Math.max(1, s.amount);
        const dual = result.capacityDualBps[s.id];
        return (
          <li key={s.id} className="grid grid-cols-[112px_minmax(0,1fr)_64px] items-center gap-2" title={`${s.label}: ${mm(used)} of ${mm(s.amount)} used; shadow price ${bps(dual, 1)}`}>
            <span className="truncate text-[11px] text-term-text">{s.short}</span>
            <div className="relative h-[14px]">
              <div className="absolute inset-y-0 left-0 rounded-[3px] bg-term-panel-3" style={{ width: `${(s.amount / max) * 80}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-[3px]" style={{ width: `${(used / max) * 80}%`, background: FAMILY_META[s.family].color }} />
              <span className="absolute inset-y-0 flex items-center pl-1.5 font-mono text-[9px] text-term-text" style={{ left: `${(Math.max(used, s.amount) / max) * 80}%` }}>
                {pct(s.amount > 0 ? used / s.amount : 0, 0)}
              </span>
            </div>
            <span className="flex items-center justify-end gap-1 font-mono text-[10px]">
              {binding && <span className="rounded-sm bg-term-gold/15 px-1 text-[8px] font-semibold text-term-gold">BIND</span>}
              <span className={dual > 0 ? "text-term-amber" : "text-term-text-mute"}>{num(dual, 0)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Coverage per use grouped by tier: covered fill + hatched shortfall. */
export function UseCoverage({ result }: { result: FeasibleResult }) {
  const tiers = [...new Set(result.problem.uses.map((u) => u.tier))].sort((a, b) => a - b);
  const max = Math.max(...result.problem.uses.map((u) => u.amount), 1);
  return (
    <div className="space-y-3">
      {tiers.map((tier) => (
        <div key={tier}>
          <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-term-text-mute">{TIER_LABELS[tier] ?? `Tier ${tier}`}</div>
          <ul className="space-y-1.5">
            {result.problem.uses.filter((u) => u.tier === tier).map((u) => {
              const short = result.shortfall[u.id];
              const covered = u.amount - short;
              return (
                <li key={u.id} className="grid grid-cols-[112px_minmax(0,1fr)_64px] items-center gap-2" title={`${u.label}: covered ${mm(covered)} of ${mm(u.amount)}`}>
                  <span className="flex min-w-0 items-center gap-1 text-[11px] text-term-text">
                    <span className="truncate">{u.short}</span>
                    {u.policy === "hard" && <span className="shrink-0 text-[8px] text-term-text-mute" aria-label="hard obligation">◆</span>}
                  </span>
                  <div className="relative flex h-[12px]">
                    <div className="h-full rounded-l-[3px] bg-term-text/80" style={{ width: `${(covered / max) * 100}%`, borderRadius: short > 1e-6 ? undefined : 3 }} />
                    {short > 1e-6 && (
                      <div className="ml-[2px] h-full rounded-r-[3px] bg-[repeating-linear-gradient(45deg,rgba(255,59,59,0.85)_0_2px,rgba(255,59,59,0.18)_2px_5px)]" style={{ width: `${(short / max) * 100}%` }} />
                    )}
                  </div>
                  <span className={`text-right font-mono text-[10px] ${short > 1e-6 ? "text-term-down" : "text-term-text-mute"}`}>
                    {short > 1e-6 ? `−${num(short, 0)}` : pct(1, 0)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="flex items-center gap-3 border-t border-term-border pt-2 text-[9px] text-term-text-mute">
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-term-text/80" /> covered</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-[repeating-linear-gradient(45deg,rgba(255,59,59,0.85)_0_2px,rgba(255,59,59,0.18)_2px_5px)]" /> shortfall ($mm)</span>
        <span>◆ hard</span>
      </div>
    </div>
  );
}

/** Lexicographic solve sequence: one pill per tier stage, then economics. */
export function TierLadder({ result }: { result: FeasibleResult }) {
  return (
    <ol className="flex flex-wrap items-stretch gap-1.5" aria-label="Lexicographic solve sequence">
      {result.stages.map((stage, index) => (
        <li key={stage.tier} className={`min-w-[96px] flex-1 rounded-md border px-2 py-1.5 ${stage.shortfall > 1e-6 ? "border-term-down/40 bg-term-down/5" : "border-term-border bg-term-panel-2"}`}>
          <div className="text-[9px] uppercase tracking-[0.12em] text-term-text-mute">Stage {index + 1} · T{stage.tier}</div>
          <div className={`font-mono text-[12px] font-semibold ${stage.shortfall > 1e-6 ? "text-term-down" : "text-term-up"}`}>{stage.shortfall > 1e-6 ? `−${mm(stage.shortfall, 0)}` : "whole"}</div>
          <div className="text-[9px] text-term-text-mute">min Σ pⱼsⱼ, then fixed</div>
        </li>
      ))}
      <li className="min-w-[96px] flex-1 rounded-md border border-term-amber/40 bg-term-amber/5 px-2 py-1.5">
        <div className="text-[9px] uppercase tracking-[0.12em] text-term-amber">Final · economics</div>
        <div className="font-mono text-[12px] font-semibold text-term-text">{mm(result.totals.annualCostMm, 2)}/yr</div>
        <div className="text-[9px] text-term-text-mute">min Σ (cᵢ+fᵢⱼ)xᵢⱼ</div>
      </li>
    </ol>
  );
}

/** Funding mix by source family as one stacked bar (text values alongside). */
export function FamilyMix({ result }: { result: FeasibleResult }) {
  const total = Math.max(result.totals.nominal, 1e-9);
  const families = Object.keys(FAMILY_META) as SourceFamily[];
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-[3px]" role="img" aria-label={families.map((f) => `${FAMILY_META[f].label} ${pct(result.totals.byFamily[f] / total)}`).join(", ")}>
        {families.map((f) => result.totals.byFamily[f] > 1e-6 && (
          <div key={f} style={{ width: `${(result.totals.byFamily[f] / total) * 100}%`, background: FAMILY_META[f].color }} />
        ))}
      </div>
      <ul className="mt-2 grid grid-cols-3 gap-2">
        {families.map((f) => (
          <li key={f} className="min-w-0">
            <div className="flex items-center gap-1 text-[9px] text-term-text-mute"><span className="h-2 w-2 rounded-sm" style={{ background: FAMILY_META[f].color }} /><span className="truncate">{FAMILY_META[f].label}</span></div>
            <div className="font-mono text-[11px] text-term-text">{mm(result.totals.byFamily[f], 0)}</div>
            <div className="font-mono text-[9px] text-term-text-mute">{pct(result.totals.byFamily[f] / total)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Cross-scenario comparison on two separate scales (cost, coverage). */
export function ScenarioComparison({ scenarios, results, activeId, onSelect }: {
  scenarios: Scenario[];
  results: Record<string, SimResult>;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const feasible = scenarios.map((s) => results[s.id]).filter((r): r is FeasibleResult => r.status === "optimal");
  const maxCost = Math.max(...feasible.map((r) => r.totals.annualCostMm), 1);
  return (
    <table className="w-full text-[11px]">
      <caption className="sr-only">Scenario comparison of annual carry and coverage</caption>
      <thead>
        <tr className="text-[9px] uppercase tracking-[0.12em] text-term-text-mute">
          <th scope="col" className="pb-1.5 text-left font-semibold">Scenario</th>
          <th scope="col" className="pb-1.5 text-left font-semibold">Annual carry ($mm)</th>
          <th scope="col" className="pb-1.5 text-left font-semibold">Coverage</th>
          <th scope="col" className="pb-1.5 text-right font-semibold">Shortfall</th>
        </tr>
      </thead>
      <tbody>
        {scenarios.map((s) => {
          const r = results[s.id];
          const active = s.id === activeId;
          return (
            <tr key={s.id} className={`border-t border-term-border transition ${active ? "bg-term-amber/5" : "hover:bg-term-panel-2"}`}>
              <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                <button type="button" onClick={() => onSelect(s.id)} className={`text-left ${active ? "font-semibold text-term-amber" : "text-term-text"}`}>{s.title}</button>
              </th>
              {r.status === "optimal" ? (
                <>
                  <td className="w-[34%] py-1.5 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="h-[8px] flex-1"><div className="h-full rounded-r-[3px] bg-term-amber" style={{ width: `${(r.totals.annualCostMm / maxCost) * 100}%`, opacity: active ? 1 : 0.55 }} /></div>
                      <span className="w-10 text-right font-mono text-[10px] text-term-text-dim">{num(r.totals.annualCostMm, 1)}</span>
                    </div>
                  </td>
                  <td className="w-[26%] py-1.5 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="h-[8px] flex-1"><div className="h-full rounded-r-[3px] bg-term-text/70" style={{ width: `${r.totals.coveragePct * 100}%` }} /></div>
                      <span className="w-10 text-right font-mono text-[10px] text-term-text-dim">{pct(r.totals.coveragePct, 0)}</span>
                    </div>
                  </td>
                  <td className={`py-1.5 text-right font-mono text-[10px] ${r.totals.shortfall > 1e-6 ? "text-term-down" : "text-term-text-mute"}`}>{r.totals.shortfall > 1e-6 ? num(r.totals.shortfall, 0) : "—"}</td>
                </>
              ) : (
                <td colSpan={3} className="py-1.5 text-[10px] text-term-down">
                  <span className="inline-flex items-center gap-1"><CircleAlert size={11} /> Infeasible · hard gap {mm(r.totalGap, 0)}</span>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function VerificationList({ checks }: { checks: VerificationCheck[] }) {
  return (
    <ul className="space-y-1.5">
      {checks.map((c) => (
        <li key={c.id} className="flex gap-2">
          {c.passed ? <CheckCircle2 size={13} className="mt-px shrink-0 text-term-up" aria-label="passed" /> : <XCircle size={13} className="mt-px shrink-0 text-term-down" aria-label="failed" />}
          <div className="min-w-0">
            <div className="text-[11px] text-term-text">{c.label}</div>
            <div className="truncate font-mono text-[9px] text-term-text-mute" title={c.detail}>{c.detail}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
