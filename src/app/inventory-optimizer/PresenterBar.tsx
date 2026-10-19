"use client";

import { useEffect } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2, Play, X } from "lucide-react";
import { stepStatus, type PresenterStep, type StepState } from "@/lib/ibalPresenter";

export interface PresenterStepView extends PresenterStep, StepState { run: () => void }

/** Guided-demo bar: what to say, one button to do it, and where the story stands. */
export function PresenterBar({ steps, index, onIndex, warm, onExit }: {
  steps: PresenterStepView[];
  index: number;
  onIndex: (next: number) => void;
  warm: string;
  onExit: () => void;
}) {
  const step = steps[index];
  const status = stepStatus(step);
  const go = (next: number) => onIndex(Math.min(steps.length - 1, Math.max(0, next)));

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (event.key === "ArrowRight") go(index + 1);
      else if (event.key === "ArrowLeft") go(index - 1);
      else if (event.key === "Escape") onExit();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <section aria-label="Guided demo" data-testid="presenter-bar" className="border-b border-term-amber/40 bg-term-panel px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="term-label text-term-amber">Guided demo</span>
        <ol className="flex flex-wrap items-center gap-1" aria-label="Steps">
          {steps.map((item, position) => {
            const s = stepStatus(item);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => go(position)}
                  aria-current={position === index ? "step" : undefined}
                  className={`flex items-center gap-1 border px-1.5 py-0.5 text-2xs ${position === index ? "border-term-amber text-term-amber" : "border-term-border text-term-text-dim"}`}
                >
                  {s === "done" ? <Check size={11} className="text-term-up" /> : s === "busy" ? <Loader2 size={11} className="animate-spin" /> : <span className="tabular-nums">{position + 1}</span>}
                  {item.title}
                </button>
              </li>
            );
          })}
        </ol>
        <span className="ml-auto text-3xs text-term-text-mute" data-testid="presenter-warm">{warm}</span>
        <button type="button" className="term-btn px-1.5 py-0 text-3xs" onClick={onExit} title="Leave guided demo (Esc)"><X size={11} /> Exit</button>
      </div>
      <div className="mt-2 flex flex-wrap items-start gap-3">
        <p className="min-w-[16rem] flex-1 text-xs text-term-text" data-testid="presenter-say">{step.say}</p>
        <div className="flex items-center gap-1">
          <button type="button" className="term-btn px-1.5 py-1" disabled={index === 0} onClick={() => go(index - 1)} aria-label="Previous step"><ChevronLeft size={13} /></button>
          <button
            type="button"
            className="term-btn border-term-blue px-3 py-1 text-term-blue disabled:border-term-border disabled:text-term-text-mute"
            disabled={status === "busy" || status === "blocked"}
            title={step.disabledReason}
            onClick={step.run}
            data-testid="presenter-run"
          >
            <Play size={13} /> {status === "busy" ? "Working…" : status === "done" ? "Run again" : `Run: ${step.title}`}
          </button>
          <button type="button" className="term-btn px-1.5 py-1" disabled={index === steps.length - 1} onClick={() => go(index + 1)} aria-label="Next step"><ChevronRight size={13} /></button>
        </div>
      </div>
      {step.disabledReason && status === "blocked" && <p className="mt-1 text-2xs text-term-amber">{step.disabledReason}</p>}
    </section>
  );
}
