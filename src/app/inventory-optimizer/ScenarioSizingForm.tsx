"use client";

import type { SizingField, SizingValues } from "@/lib/ibalScenarioSizing";

/** Anything that can be sized: an IBAL stress family or a collateral stress family. */
export interface SizableFamily { id: string; label: string; story: string; fields: SizingField[] }

function clampTo(fields: SizingField[], values: SizingValues): SizingValues {
  const out: SizingValues = {};
  for (const field of fields) {
    const raw = values[field.key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) { out[field.key] = field.default; continue; }
    const value = field.step >= 1 ? Math.round(raw) : raw;
    out[field.key] = Math.min(field.max, Math.max(field.min, value));
  }
  return out;
}

/**
 * Presentable controls for an engine stress scenario. Edits are clamped to each field's range, then the
 * parent regenerates the explicit engine parameters from them.
 */
export function ScenarioSizingForm({ family, values, disabled, onChange }: {
  family: SizableFamily | undefined;
  values: SizingValues;
  disabled?: boolean;
  onChange: (next: SizingValues) => void;
}) {
  if (!family) return null;
  const familyId = family.id;
  const set = (key: string, raw: number) => onChange(clampTo(family.fields, { ...values, [key]: raw }));
  return (
    <div className="grid gap-2 border border-term-border bg-term-panel-2 p-2" data-testid="scenario-sizing">
      <div className="text-term-text">{family.story}</div>
      {family.fields.map((field) => {
        const id = `sizing-${familyId}-${field.key}`;
        const value = values[field.key] ?? field.default;
        return (
          <div key={field.key} className="grid gap-0.5">
            <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-term-text-dim">
              <span>{field.label}</span>
              <span className="tabular-nums text-term-text">{value}{field.unit && ` ${field.unit}`}</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                id={id}
                type="range"
                className="min-w-0 flex-1 accent-term-blue"
                min={field.min}
                max={field.max}
                step={field.step}
                value={value}
                disabled={disabled}
                onChange={(event) => set(field.key, Number(event.target.value))}
              />
              <input
                aria-label={field.key === "breadth" ? `${family.label}: how many` : `${field.label} value`}
                type="number"
                className="w-16 border border-term-border bg-term-panel px-1 py-0.5 text-right text-term-text"
                min={field.min}
                max={field.max}
                step={field.step}
                value={value}
                disabled={disabled}
                onChange={(event) => set(field.key, event.target.valueAsNumber)}
              />
            </div>
            {field.hint && <div className="text-3xs text-term-text-mute">{field.hint}</div>}
          </div>
        );
      })}
    </div>
  );
}
