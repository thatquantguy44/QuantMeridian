"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Play } from "lucide-react";
import { Panel, Tag } from "@/components/ui/Panel";
import {
  IbalRequestError,
  runIbalScenarioStress,
  type DatasetEnvelope,
  type IbalResult,
  type RunConfig,
} from "@/lib/inventoryOptimizer";
import { SCENARIO_FAMILIES, buildStressSuite, rankStressOutcomes, type RankedOutcome } from "@/lib/ibalScenarioSizing";

const familyLabel = (id: string) => SCENARIO_FAMILIES.find((family) => family.id === id)?.label ?? id.replaceAll("_", " ");
const usd = (value: number | null) => (value == null ? "n/a" : `${value < 0 ? "-" : value > 0 ? "+" : ""}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

/** Runs one default-sized scenario per supported family against the verified base run, then ranks them. */
export function StressSuitePanel({ dataset, runConfig, result, disabled, runToken = 0, onRanked }: {
  dataset: DatasetEnvelope | null;
  runConfig: RunConfig;
  result: IbalResult | null;
  disabled?: boolean;
  /** Increment to start a run from outside (the guided demo). */
  runToken?: number;
  /** Called with the number of ranked outcomes when a run finishes, and 0 when the results are cleared. */
  onRanked?: (count: number) => void;
}) {
  const [ranked, setRanked] = useState<RankedOutcome[] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const suite = useMemo(() => buildStressSuite(dataset, result), [dataset, result]);
  const ready = Boolean(dataset?.validation.valid && result && suite.length);
  const lastToken = useRef(runToken);

  // New dataset or base run: earlier ranks no longer describe it.
  useEffect(() => { setRanked(null); setFailures([]); onRanked?.(0); }, [dataset?.request_hash, result?.run_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (runToken === lastToken.current) return;
    lastToken.current = runToken;
    if (ready && !busy && !disabled) void run();
  }); // eslint-disable-line react-hooks/exhaustive-deps

  async function run() {
    if (!dataset || !result) return;
    setBusy(true); setRanked(null); setFailures([]);
    const groups: { family: string; outcomes: RankedOutcome["outcome"][] }[] = [];
    const failed: string[] = [];
    for (const [index, item] of suite.entries()) {
      setProgress(`${index + 1} of ${suite.length}: ${item.label}`);
      try {
        const response = await runIbalScenarioStress(dataset, runConfig, result, item.family, item.parameters);
        groups.push({ family: item.family, outcomes: response.stress_report.outcomes });
      } catch (error) {
        const detail = error instanceof IbalRequestError && error.issues.length ? error.issues[0].message : error instanceof Error ? error.message : "failed";
        failed.push(`${item.label}: ${detail}`);
      }
    }
    const next = rankStressOutcomes(groups);
    setRanked(next);
    setFailures(failed);
    onRanked?.(next.length);
    setProgress(null);
    setBusy(false);
  }

  const worst = ranked?.[0];
  return (
    <Panel
      title="Ranked Stress Suite"
      code="SUITE"
      resizable={false}
      right={<Tag tone={busy ? "amber" : ranked ? "up" : "neutral"}>{busy ? "RUNNING" : ranked ? `${ranked.length} OUTCOMES` : "IDLE"}</Tag>}
    >
      <div className="grid gap-2 p-2 text-2xs">
        <div className="border border-term-border bg-term-panel-2 px-2 py-1.5 text-term-text-mute">
          Runs one default-sized scenario for each family this dataset supports ({suite.map((item) => item.label).join(", ") || "none yet"}),
          sized against the base run, and ranks them by impact on the objective. Tune any single scenario in the Scenario Studio above.
        </div>
        <button
          className="term-btn justify-center border-term-blue text-term-blue disabled:border-term-border disabled:text-term-text-mute"
          disabled={disabled || busy || !ready}
          title={!result ? "Run and verify a base case first." : undefined}
          onClick={run}
        >
          <Play size={13} /> {busy ? `Running ${progress ?? ""}` : "Run ranked stress suite"}
        </button>
        {failures.length > 0 && (
          <div className="border border-term-down/40 bg-term-down/10 px-2 py-1.5 text-term-down">
            {failures.map((line) => <div key={line}>{line}</div>)}
          </div>
        )}
        {ranked && ranked.length > 0 && (
          <>
            {worst && <div className="text-term-text">Worst case: <strong>{familyLabel(worst.family)}</strong> ({worst.outcome.scenario_name}) moves the objective by {usd(worst.outcome.objective_delta_usd)}.</div>}
            <table className="w-full text-left" data-testid="stress-suite-table">
              <thead className="text-term-text-mute">
                <tr><th className="py-0.5 pr-2">#</th><th className="pr-2">Scenario</th><th className="pr-2 text-right">Δ objective</th><th className="pr-2">Status</th><th>Verified</th></tr>
              </thead>
              <tbody>
                {ranked.map((row) => (
                  <tr key={`${row.family}-${row.outcome.scenario_id}`} className="border-t border-term-border">
                    <td className="py-0.5 pr-2 tabular-nums">{row.rank}</td>
                    <td className="pr-2">{familyLabel(row.family)}<span className="block text-3xs text-term-text-mute">{row.outcome.scenario_name}</span></td>
                    <td className={`pr-2 text-right tabular-nums ${(row.outcome.objective_delta_usd ?? 0) < 0 ? "text-term-down" : "text-term-up"}`}>{usd(row.outcome.objective_delta_usd)}</td>
                    <td className="pr-2">{row.outcome.status}</td>
                    <td>{row.outcome.verification_passed ? "yes" : "NO"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </Panel>
  );
}
