"use client";

import { useMemo, useState } from "react";
import { Play } from "lucide-react";
import { Panel, Tag } from "@/components/ui/Panel";
import { ScenarioSizingForm } from "@/app/inventory-optimizer/ScenarioSizingForm";
import type { CollateralRun } from "@/lib/collateralOptimizer";
import { BOOK_PROFILES, buildGeneratedBook, type BookProfileId, type NativeSnapshot } from "@/lib/collateralBooks";
import {
  STRESS_FAMILIES,
  applyStress,
  buildCollateralSuite,
  clampStress,
  defaultStress,
  rankCollateralOutcomes,
  type RankedCollateral,
  type StressValues,
} from "@/lib/collateralStress";

const usd = (value: number | null) => (value == null ? "n/a" : `${value < 0 ? "-" : value > 0 ? "+" : ""}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

/**
 * Generated demo books and sized stresses (spec016 COLL-013, COLL-014). Inputs are built here; every solve, verification
 * and saving comes from the pinned service through the validated-upload path, and nothing is labelled SIM.
 */
export function GeneratedBooksPanel({ ready, busy, onShow, quietSolve }: {
  ready: boolean;
  busy: boolean;
  /** Show a snapshot's result in the main result area. `asBaseline` makes it the comparison base. */
  onShow: (snapshot: NativeSnapshot, label: string, asBaseline: boolean) => Promise<void>;
  /** Solve without touching the page's result area (for the suite). Rejects on a validation or service error. */
  quietSolve: (snapshot: NativeSnapshot) => Promise<CollateralRun>;
}) {
  const [profile, setProfile] = useState<BookProfileId>("dealer");
  const [familyId, setFamilyId] = useState(STRESS_FAMILIES[0].id);
  const [sizing, setSizing] = useState<StressValues>(() => defaultStress(STRESS_FAMILIES[0].id, "dealer"));
  const [ranked, setRanked] = useState<RankedCollateral[] | null>(null);
  const [savings, setSavings] = useState<Record<string, number | null>>({});
  const [failures, setFailures] = useState<string[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [suiteBusy, setSuiteBusy] = useState(false);

  const book = useMemo(() => buildGeneratedBook(profile), [profile]);
  const stress = useMemo(() => applyStress(book, familyId, sizing), [book, familyId, sizing]);
  const family = STRESS_FAMILIES.find((item) => item.id === familyId);
  const disabled = !ready || busy || suiteBusy;

  function pickProfile(next: BookProfileId) {
    setProfile(next); setSizing(defaultStress(familyId, next)); setRanked(null); setFailures([]);
  }
  function pickFamily(next: string) {
    setFamilyId(next); setSizing(defaultStress(next, profile));
  }

  async function runSuite() {
    setSuiteBusy(true); setRanked(null); setFailures([]);
    const failed: string[] = [];
    try {
      setProgress("baseline");
      const base = await quietSolve(book);
      const baseCost = base.result.cost?.total_usd;
      if (base.lifecycle_status !== "SUCCEEDED_VERIFIED" || baseCost == null) throw new Error("The generated baseline did not solve verified, so there is nothing to compare against.");
      const outcomes = [];
      const saved: Record<string, number | null> = {};
      for (const [index, scenario] of buildCollateralSuite(book).entries()) {
        setProgress(`${index + 1} of ${STRESS_FAMILIES.length}: ${scenario.label}`);
        try {
          const run = await quietSolve(scenario.snapshot);
          outcomes.push({ family: scenario.family, label: scenario.label, lifecycle: run.lifecycle_status, verified: run.adapter_verification.passed, costUsd: run.result.cost?.total_usd ?? null });
          saved[scenario.family] = run.lifecycle_status === "SUCCEEDED_VERIFIED" ? run.result.cost?.savings_usd ?? null : null;
        } catch (error) {
          failed.push(`${scenario.label}: ${error instanceof Error ? error.message : "failed"}`);
        }
      }
      setSavings(saved);
      setRanked(rankCollateralOutcomes(baseCost, outcomes));
    } catch (error) {
      failed.push(error instanceof Error ? error.message : "Suite failed.");
    } finally {
      setFailures(failed); setProgress(null); setSuiteBusy(false);
    }
  }

  return (
    <Panel title="Generated demo books" code="BOOKS" resizable={false}
      right={<Tag tone="amber">GENERATED · SYNTHETIC · NOT SIM</Tag>}>
      <div className="space-y-3 p-3 text-xs" data-testid="generated-books">
        <p className="text-term-text-dim">
          More realistic synthetic books built in the terminal and submitted through the validated-upload path. The pinned model
          validates, solves and verifies them. Names and agreement terms are fictional and carry no legal authority.
        </p>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-term-text-dim">Book</legend>
          {BOOK_PROFILES.map((item) => (
            <label key={item.id} className={`flex cursor-pointer gap-2 border p-2 ${profile === item.id ? "border-term-amber" : "border-term-border"}`}>
              <input type="radio" name="book-profile" checked={profile === item.id} onChange={() => pickProfile(item.id)} disabled={disabled} />
              <span><strong>{item.label}</strong><span className="block text-term-text-dim">{item.blurb}</span></span>
            </label>
          ))}
        </fieldset>
        <button type="button" disabled={disabled} data-testid="solve-generated-book"
          onClick={() => void onShow(book, `generated:${profile}`, true)}
          className="border border-term-amber px-3 py-1 text-term-amber disabled:opacity-40">
          Solve generated book
        </button>

        <div className="space-y-2 border-t border-term-border pt-3">
          <label className="grid gap-1 text-term-text-dim">Stress
            <select data-testid="stress-family" className="border border-term-border bg-term-panel-2 px-2 py-1 text-term-text" value={familyId} disabled={disabled}
              onChange={(event) => pickFamily(event.target.value)}>
              {STRESS_FAMILIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <ScenarioSizingForm family={family} values={sizing} disabled={disabled} onChange={(next) => setSizing(clampStress(familyId, next))} />
          <p className="text-term-text-mute" data-testid="stress-changes">Changes input: {stress.changed.join(", ") || "none"} · scenario {stress.snapshot.scenario_id}</p>
          <button type="button" disabled={disabled} data-testid="solve-stress"
            onClick={() => void onShow(stress.snapshot, `stress:${familyId}`, false)}
            className="border border-term-blue px-3 py-1 text-term-blue disabled:opacity-40">
            Solve this stress
          </button>
        </div>

        <div className="space-y-2 border-t border-term-border pt-3">
          <button type="button" disabled={disabled} data-testid="run-collateral-suite" onClick={() => void runSuite()}
            className="flex items-center gap-1 border border-term-blue px-3 py-1 text-term-blue disabled:opacity-40">
            <Play size={12} /> {suiteBusy ? `Running ${progress ?? ""}` : "Run ranked stress suite"}
          </button>
          <p className="text-term-text-mute">Solves one default-sized stress per control on this book and ranks them by the rise in verified target cost.</p>
          {failures.length > 0 && <div role="alert" className="border border-term-down/40 bg-term-down/10 px-2 py-1.5 text-term-down">{failures.map((line) => <div key={line}>{line}</div>)}</div>}
          {ranked && (
            <table className="w-full text-left" data-testid="collateral-suite-table">
              <thead className="text-term-text-mute"><tr><th className="py-0.5 pr-2">#</th><th className="pr-2">Stress</th><th className="pr-2 text-right">Δ target cost</th><th className="text-right">Savings</th></tr></thead>
              <tbody>
                {ranked.map((row) => (
                  <tr key={row.family} className="border-t border-term-border">
                    <td className="py-0.5 pr-2 tabular-nums">{row.rank}</td>
                    <td className="pr-2">{row.label}{row.deltaUsd === null && <span className="block text-3xs text-term-down">{row.lifecycle} · no target</span>}</td>
                    <td className={`pr-2 text-right tabular-nums ${(row.deltaUsd ?? 0) > 0 ? "text-term-down" : "text-term-up"}`}>{usd(row.deltaUsd)}</td>
                    <td className="text-right tabular-nums">{row.deltaUsd === null || savings[row.family] == null ? "n/a" : usd(savings[row.family])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Panel>
  );
}
