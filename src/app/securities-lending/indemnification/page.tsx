// INDEM: borrower-default and reinvestment indemnification risk for an agency lender (spec020).
// The model runs in the Python service; this page only chooses settings and shows what comes back.
// Everything is SIM data and every figure carries its seed, path count and standard error.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import type { RunResponse } from "@/lib/indemnificationApi";
import type { BookSummary } from "@/lib/indemnificationCompose";
import { loadBook, loadHealth, runAnalysis, type Health, type Outcome } from "@/lib/indemnificationClient";
import { Borrowers } from "./Borrowers";
import { Controls } from "./Controls";
import { ModelCardTab } from "./ModelCardTab";
import { Overview } from "./Overview";
import { ProfileEditor } from "./ProfileEditor";
import { Reinvestment } from "./Reinvestment";
import { Sensitivities } from "./Sensitivities";
import { Stresses } from "./Stresses";
import { defaultUi, toRunInput, uiIssues, type UiState } from "./state";
import { Notice, TabButton } from "./ui";

type Tab = "OVERVIEW" | "BORROWERS" | "PROFILE" | "SENS" | "STRESS" | "REINV" | "CARD";
const TABS: { key: Tab; label: string; needsResult: boolean }[] = [
  { key: "OVERVIEW", label: "Overview", needsResult: true },
  { key: "BORROWERS", label: "Borrowers", needsResult: false },
  { key: "PROFILE", label: "Close-out profile", needsResult: false },
  { key: "SENS", label: "Sensitivities", needsResult: true },
  { key: "STRESS", label: "Stresses", needsResult: true },
  { key: "REINV", label: "Reinvestment", needsResult: true },
  { key: "CARD", label: "Model card", needsResult: true },
];

type Failure = Extract<Outcome<unknown>, { ok: false }>;

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `run-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function Indemnification() {
  const [book, setBook] = useState<BookSummary | null>(null);
  const [bookFailure, setBookFailure] = useState<Failure | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [ui, setUi] = useState<UiState | null>(null);
  const [tab, setTab] = useState<Tab>("OVERVIEW");
  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<RunResponse | null>(null);
  const [ranWith, setRanWith] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    void loadBook().then((o) => {
      if (!live) return;
      if (o.ok) { setBook(o.data); setUi(defaultUi(o.data)); } else setBookFailure(o);
    });
    void loadHealth().then((o) => { if (live && o.ok) setHealth(o.data); });
    return () => { live = false; abort.current?.abort(); };
  }, []);

  const issues = useMemo(() => (ui ? uiIssues(ui) : []), [ui]);
  const current = useMemo(() => (ui ? JSON.stringify(toRunInput(ui)) : null), [ui]);

  const run = useCallback(async () => {
    if (!ui || uiIssues(ui).length > 0) return;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setFailure(null);
    const input = toRunInput(ui);
    const outcome = await runAnalysis(input, { idempotencyKey: newKey(), signal: controller.signal });
    if (controller.signal.aborted) { setRunning(false); return; }
    if (outcome.ok) { setResponse(outcome.data); setRanWith(JSON.stringify(input)); }
    else setFailure(outcome);
    setRunning(false);
  }, [ui]);

  const cancel = () => { abort.current?.abort(); setRunning(false); };
  const result = response?.result ?? null;
  const stale = result !== null && ranWith !== current;

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader code="INDEM" title="Indemnification Risk" desc="Borrower default · reinvestment loss · wrong-way risk"
        right={
          <>
            <ProvenanceBadge source="SIM" simSelected />
            {health && <Tag tone={health.ready ? "up" : "down"}>{health.ready ? "Service ready" : "Service not ready"}</Tag>}
          </>
        } />

      <div className="flex flex-col gap-2 p-2">
        {bookFailure && (
          <Notice tone="down" title="INDEM cannot start">
            {bookFailure.message}
            {bookFailure.issues.length > 0 && <ul className="mt-1 list-disc pl-4">{bookFailure.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
          </Notice>
        )}
        {!book && !bookFailure && <div className="p-6 text-2xs text-term-text-mute">Loading the simulated book…</div>}

        {book && ui && (
          <>
            <Controls ui={ui} setUi={setUi} issues={issues} running={running} canRun={issues.length === 0} onRun={run} onCancel={cancel} />

            {running && <Notice tone="neutral" title="Running">The model is running in the service. A preview run with sensitivities takes around 20 seconds; a reported annual run can take several minutes.</Notice>}
            {failure && (
              <Notice tone="down" title="The run did not complete">
                {failure.message}
                {failure.issues.length > 0 && <ul className="mt-1 list-disc pl-4">{failure.issues.slice(0, 8).map((i) => <li key={i}>{i}</li>)}</ul>}
              </Notice>
            )}
            {stale && !running && <Notice tone="amber" title="Settings changed">The results below are from the previous settings. Run again to update them.</Notice>}

            <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="INDEM views">
              {TABS.map((t) => <TabButton key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</TabButton>)}
            </div>

            {TABS.find((t) => t.key === tab)!.needsResult && !result ? (
              <Panel title="No results yet" code="INDEM" accent resizable={false}>
                <div className="p-4 text-2xs text-term-text-dim" data-testid="indem-empty">
                  Choose settings above and press Run analysis. Start with a preview run (5,000 paths, about 20 seconds with sensitivities); switch to Reported for the full path count.
                  Every figure is simulated (SIM) on a generated lending book, and carries its seed, path count and standard error.
                </div>
              </Panel>
            ) : (
              <>
                {tab === "OVERVIEW" && result && <Overview result={result} />}
                {tab === "BORROWERS" && (result
                  ? <Borrowers result={result} book={book} ui={ui} setUi={setUi} />
                  : <BorrowerSetup book={book} ui={ui} setUi={setUi} />)}
                {tab === "PROFILE" && <ProfileEditor ui={ui} setUi={setUi} book={book} result={result} />}
                {tab === "SENS" && result && <Sensitivities result={result} />}
                {tab === "STRESS" && result && <Stresses result={result} />}
                {tab === "REINV" && result && <Reinvestment result={result} book={book} />}
                {tab === "CARD" && result && response && <ModelCardTab result={result} runId={response.run.run_id} durationMs={response.run.duration_ms} />}
              </>
            )}
          </>
        )}
      </div>

      <div className="mt-auto border-t border-term-border bg-term-panel px-3 py-1.5 text-3xs text-term-text-mute">
        <span className="text-term-amber">INDEM</span> — Monte Carlo of correlated markets and borrower defaults with a wrong-way link, closed out under an editable profile.
        {" "}Local-only research model on a simulated book (SIM). Not a capital or accounting figure.
      </div>
    </div>
  );
}

/** Before the first run there are no results, but credit inputs can still be set. */
function BorrowerSetup({ book, ui, setUi }: { book: BookSummary; ui: UiState; setUi: (u: UiState) => void }) {
  return (
    <Panel title="Credit inputs" code="INDEM-7" accent subtitle="optional: replaces the rating table for a borrower">
      <table className="w-full border-collapse text-2xs">
        <thead className="bg-term-panel-2"><tr><th className="px-2 py-1 text-left text-3xs uppercase text-term-text-mute">Borrower</th><th className="px-2 py-1 text-right text-3xs uppercase text-term-text-mute">Rating</th><th className="px-2 py-1 text-right text-3xs uppercase text-term-text-mute">Credit spread (bp)</th></tr></thead>
        <tbody>
          {book.borrowers.map((b) => (
            <tr key={b.id} className="border-b border-term-border-soft">
              <td className="px-2 py-1 text-term-text">{b.name}</td>
              <td className="px-2 py-1 text-right text-term-text-mute">{b.rating}</td>
              <td className="px-2 py-1 text-right">
                <input aria-label={`Credit spread for ${b.name}`} className="tnum w-28 border border-term-border bg-term-panel-3 px-1.5 py-0.5 text-right text-2xs text-term-text outline-none focus:border-term-amber"
                  inputMode="decimal" defaultValue={ui.credit[b.id]?.spread_bps ?? ""}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    const credit = { ...ui.credit };
                    if (e.target.value.trim() === "") delete credit[b.id];
                    else if (Number.isFinite(n)) credit[b.id] = { spread_bps: n, recovery: credit[b.id]?.recovery ?? null };
                    setUi({ ...ui, credit });
                  }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-term-border px-3 py-1 text-3xs text-term-text-mute">Leave a spread empty to use the rating table. Results appear here after the first run.</div>
    </Panel>
  );
}
