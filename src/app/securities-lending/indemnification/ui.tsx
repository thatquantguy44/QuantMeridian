// Small shared pieces for the INDEM page (spec020 IND-T14).
import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import type { Metric } from "@/lib/indemnificationApi";
import { fmtMetric, fmtMoney } from "@/lib/indemnificationView";

export const INPUT = "tnum w-full min-w-0 border border-term-border bg-term-panel-3 px-1.5 py-0.5 text-2xs text-term-text outline-none focus:border-term-amber disabled:opacity-50";
export const TH = "border-b border-term-border px-2 py-1 text-3xs font-semibold uppercase tracking-wider text-term-text-mute";
export const TD = "px-2 py-1 text-2xs";

/** A number box that lets you type partial values ("0.", "-") and reports a number only when the text is one. */
export function NumInput({
  value, onChange, nullable = false, step, disabled, label,
}: {
  value: number | null; onChange: (v: number | null) => void; nullable?: boolean; step?: number; disabled?: boolean; label: string;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  useEffect(() => {
    const parsed = draft.trim() === "" ? null : Number(draft);
    if (parsed !== value) setDraft(value === null ? "" : String(value));
  }, [value]);
  return (
    <input
      aria-label={label} className={INPUT} inputMode="decimal" step={step} disabled={disabled} value={draft}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        if (text.trim() === "") { if (nullable) onChange(null); return; }
        const n = Number(text);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-0.5" title={hint}>
      <span className="term-label truncate">{label}</span>
      {children}
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-center gap-1.5 text-2xs text-term-text-dim" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-term-amber" />
      {label}
    </label>
  );
}

export function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button" role="tab" aria-selected={active} onClick={onClick}
      className={clsx("rounded-sm border px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide transition-colors",
        active ? "border-term-amber bg-term-amber text-black" : "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text")}
    >
      {children}
    </button>
  );
}

/** One figure with its standard error, so no number on the page appears without its uncertainty. */
export function MetricText({ m, format = fmtMoney }: { m: Metric; format?: (x: number) => string }) {
  return <span title={fmtMetric(m, format)}>{format(m.value)}{m.std_error !== null && <span className="text-term-text-mute"> ±{format(m.std_error)}</span>}</span>;
}

export function Notice({ tone, title, children }: { tone: "down" | "amber" | "neutral"; title?: string; children: ReactNode }) {
  const color = tone === "down" ? "border-term-down/40 text-term-down" : tone === "amber" ? "border-term-amber/40 text-term-amber" : "border-term-border text-term-text-dim";
  return (
    <div role={tone === "down" ? "alert" : "status"} className={clsx("border bg-term-panel px-3 py-2 text-2xs", color)}>
      {title && <div className="mb-0.5 font-semibold uppercase tracking-wide">{title}</div>}
      <div className="text-term-text-dim">{children}</div>
    </div>
  );
}
