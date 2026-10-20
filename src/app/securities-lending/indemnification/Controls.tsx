import type { StepSize } from "@/lib/indemnificationContract";
import { Panel } from "@/components/ui/Panel";
import { PREVIEW_PATHS, describeRun, effectivePaths, willBePriced, withMode, type UiState } from "./state";
import { Field, INPUT, NumInput, Toggle } from "./ui";

const STEPS: StepSize[] = ["daily", "weekly", "monthly"];

export function Controls({
  ui, setUi, issues, running, canRun, onRun, onCancel,
}: {
  ui: UiState; setUi: (next: UiState) => void; issues: string[]; running: boolean; canRun: boolean;
  onRun: () => void; onCancel: () => void;
}) {
  const set = <K extends keyof UiState>(key: K, value: UiState[K]) => setUi({ ...ui, [key]: value });
  const seg = (active: boolean) =>
    `border px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide ${active ? "border-term-amber bg-term-amber text-black" : "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text"}`;
  return (
    <Panel title="Run settings" code="INDEM-0" accent resizable={false}
      right={
        <>
          {running && <button type="button" className="term-btn" onClick={onCancel}>Cancel</button>}
          <button type="button" className="term-btn term-btn-active" onClick={onRun} disabled={!canRun || running} data-testid="indem-run">
            {running ? "Running…" : "Run analysis"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2 p-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div className="flex" role="group" aria-label="View">
            <button type="button" className={seg(ui.mode === "desk")} onClick={() => setUi(withMode(ui, "desk"))}>Desk view</button>
            <button type="button" className={seg(ui.mode === "annual")} onClick={() => setUi(withMode(ui, "annual"))}>Annual view</button>
          </div>
          <div className="flex" role="group" aria-label="Run size">
            <button type="button" className={seg(ui.preview)} onClick={() => set("preview", true)} title={`Capped at ${PREVIEW_PATHS.toLocaleString("en-US")} paths and labelled as a preview`}>Preview</button>
            <button type="button" className={seg(!ui.preview)} onClick={() => set("preview", false)}>Reported</button>
          </div>
          <span className="text-3xs text-term-text-mute" data-testid="indem-describe">{describeRun(ui)}</span>
          {!willBePriced(ui) && <span className="text-3xs text-term-text-mute">Pricing needs an annual run over 252 days.</span>}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          <Field label="Paths" hint="Monte Carlo paths for a reported run">
            <NumInput label="Paths" value={ui.paths} onChange={(v) => set("paths", v ?? 0)} />
          </Field>
          <Field label="Seed" hint="Same seed, same book, same settings: same result">
            <NumInput label="Seed" value={ui.seed} onChange={(v) => set("seed", v ?? 0)} />
          </Field>
          <Field label="Horizon (business days)">
            <NumInput label="Horizon" value={ui.horizonDays} onChange={(v) => set("horizonDays", v ?? 0)} />
          </Field>
          <Field label="Step">
            <select aria-label="Step" className={INPUT} value={ui.step} onChange={(e) => set("step", e.target.value as StepSize)}>
              {STEPS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Borrower correlation" hint="Share of default risk that borrowers have in common">
            <NumInput label="Borrower correlation" value={ui.rhoD} onChange={(v) => set("rhoD", v ?? 0)} />
          </Field>
          <Field label="Wrong-way correlation" hint="Link between borrower defaults and the equity market. ρ_W² cannot exceed ρ_D">
            <NumInput label="Wrong-way correlation" value={ui.rhoW} onChange={(v) => set("rhoW", v ?? 0)} />
          </Field>
          <Field label="Cost of capital" hint="Used to price economic capital">
            <NumInput label="Cost of capital" value={ui.costOfCapital} onChange={(v) => set("costOfCapital", v ?? 0)} />
          </Field>
          <Field label="Flag threshold (bp)" hint="Borrowers whose economic cost exceeds this are flagged">
            <NumInput label="Flag threshold" value={ui.flagThreshold} onChange={(v) => set("flagThreshold", v ?? 0)} />
          </Field>
          <Field label="Student-t degrees of freedom">
            <NumInput label="Student-t degrees of freedom" value={ui.studentNu} onChange={(v) => set("studentNu", v ?? 0)} disabled={!ui.studentT} />
          </Field>
          <Field label="Paths per sweep point">
            <NumInput label="Paths per sweep point" value={ui.sweepPaths} onChange={(v) => set("sweepPaths", v ?? 0)} disabled={!ui.sweeps} />
          </Field>
          <div className="col-span-2 flex flex-wrap items-end gap-x-4 gap-y-1 pb-0.5">
            <Toggle label="Student-t variant" checked={ui.studentT} onChange={(v) => set("studentT", v)} hint="Also report the heavy-tailed variant on the same draws" />
            <Toggle label="Sensitivities" checked={ui.sweeps} onChange={(v) => set("sweeps", v)} />
            <Toggle label="Stresses" checked={ui.stresses} onChange={(v) => set("stresses", v)} />
          </div>
        </div>

        {ui.preview && ui.paths > PREVIEW_PATHS && (
          <div className="text-3xs text-term-text-mute">Preview runs use {effectivePaths(ui).toLocaleString("en-US")} of the {ui.paths.toLocaleString("en-US")} paths. Switch to Reported for the full count.</div>
        )}
        {issues.length > 0 && (
          <ul className="list-disc pl-4 text-3xs text-term-down" data-testid="indem-issues">
            {issues.map((i) => <li key={i}>{i}</li>)}
          </ul>
        )}
      </div>
    </Panel>
  );
}
