import { useMemo, useState } from "react";
import { Panel, Tag } from "@/components/ui/Panel";
import type { IndemnificationResult } from "@/lib/indemnificationApi";
import type { BookSummary } from "@/lib/indemnificationCompose";
import type { CloseoutProfile, CloseoutSettings } from "@/lib/indemnificationContract";
import {
  deleteProfile, exportProfile, listProfiles, parseProfile, profileIssues, saveProfile, type SavedProfile,
} from "@/lib/indemnificationProfiles";
import { OVERRIDE_LEVELS, SETTING_SPECS, diffProfiles, validateSetting, type OverrideLevel, type SettingSpec } from "@/lib/indemnificationView";
import type { UiState } from "./state";
import { Field, INPUT, NumInput, TD, TH } from "./ui";

type Value = number | boolean | string | null;

function SettingValue({ spec, value, onChange }: { spec: SettingSpec; value: Value; onChange: (v: Value) => void }) {
  if (spec.kind === "boolean") {
    return <input type="checkbox" aria-label={spec.label} className="accent-term-amber" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (spec.kind === "enum") {
    return (
      <select aria-label={spec.label} className={INPUT} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {spec.options!.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return <NumInput label={spec.label} nullable={spec.nullable} value={value as number | null} onChange={onChange} />;
}

const defaultFor = (spec: SettingSpec, base: CloseoutSettings): Value => base[spec.key] as Value;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export function ProfileEditor({
  ui, setUi, book, result,
}: { ui: UiState; setUi: (u: UiState) => void; book: BookSummary; result: IndemnificationResult | null }) {
  const profile = ui.profile;
  const base = book.defaults.profile;
  const [saved, setSaved] = useState<SavedProfile[]>(() => listProfiles());
  const [message, setMessage] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [level, setLevel] = useState<OverrideLevel>("asset_class_overrides");
  const [target, setTarget] = useState("");
  const [setting, setSetting] = useState<string>(SETTING_SPECS[0].key);
  const changes = useMemo(() => diffProfiles(profile, base), [profile, base]);
  const issues = useMemo(() => profileIssues(profile), [profile]);

  const update = (next: CloseoutProfile) => setUi({ ...ui, profile: next });
  const setDefault = (spec: SettingSpec, v: Value) => update({ ...profile, defaults: { ...profile.defaults, [spec.key]: v } as CloseoutSettings });
  const overridesAt = (l: OverrideLevel) => profile[l] as Record<string, Record<string, Value>>;
  const setOverride = (l: OverrideLevel, t: string, key: string, v: Value | undefined) => {
    const level = { ...overridesAt(l) };
    const entry = { ...(level[t] ?? {}) };
    if (v === undefined) delete entry[key]; else entry[key] = v;
    if (Object.keys(entry).length === 0) delete level[t]; else level[t] = entry;
    update({ ...profile, [l]: level } as CloseoutProfile);
  };

  const suggestions: Record<OverrideLevel, string[]> = {
    asset_class_overrides: [...new Set(book.securities.map((s) => s.asset_class))],
    pool_bucket_overrides: [...new Set(book.pool_positions.map((p) => p.liquidity_bucket))],
    borrower_overrides: book.borrowers.map((b) => b.id),
    position_overrides: [...book.loans.map((l) => l.id), ...book.pool_positions.map((p) => p.id)],
  };
  const settingChoices = level === "position_overrides" ? [...SETTING_SPECS.map((s) => s.key), "adv_units", "daily_vol"] : SETTING_SPECS.map((s) => s.key as string);

  const addOverride = () => {
    const t = target.trim();
    if (!t) { setMessage("Choose what the override applies to."); return; }
    const spec = SETTING_SPECS.find((s) => s.key === setting);
    const initial: Value = spec ? defaultFor(spec, profile.defaults) : 1;
    setOverride(level, t, setting, initial === null ? 1 : initial);
    setTarget(""); setMessage(null);
  };

  const refresh = () => setSaved(listProfiles());
  const doSave = () => {
    if (issues.length) { setMessage(`Fix first: ${issues[0]}`); return; }
    setMessage(saveProfile(profile) ? `Saved "${profile.name}" in this browser.` : "Could not save: browser storage is blocked or full.");
    refresh();
  };
  const doImport = (text: string) => {
    const parsed = parseProfile(text);
    if (!parsed.ok) { setMessage(`Not imported: ${parsed.issues.slice(0, 3).join("; ")}`); return; }
    update(parsed.profile); setImportText(""); setMessage(`Loaded "${parsed.profile.name}".`);
  };

  const effective = result?.effective_settings ?? [];

  return (
    <div className="flex flex-col gap-2">
      <Panel title="Close-out profile" code="INDEM-8" accent
        right={
          <>
            <button type="button" className="term-btn" onClick={() => { update(JSON.parse(JSON.stringify(base))); setMessage("Reset to the shipped default."); }}>Reset to default</button>
            <button type="button" className="term-btn" onClick={() => download(`${profile.name.replace(/[^\w.-]+/g, "_") || "profile"}.json`, exportProfile(profile))}>Export</button>
          </>
        }>
        <div className="flex flex-col gap-2 p-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Profile name">
              <input aria-label="Profile name" className={INPUT} value={profile.name} onChange={(e) => update({ ...profile, name: e.target.value })} />
            </Field>
            <Field label="Version">
              <NumInput label="Profile version" value={profile.profile_version} onChange={(v) => update({ ...profile, profile_version: v ?? 0 })} />
            </Field>
            <div className="col-span-2 flex items-end gap-2 text-3xs text-term-text-mute">
              {changes.length === 0 ? <Tag tone="neutral">Matches shipped default</Tag> : <Tag tone="amber">{changes.length} change{changes.length === 1 ? "" : "s"} from default</Tag>}
              {issues.length > 0 && <Tag tone="down">{issues.length} problem{issues.length === 1 ? "" : "s"}</Tag>}
            </div>
          </div>
          <div className="text-3xs text-term-text-mute">These settings apply to every position unless an override below changes them. Every run records the full profile it used.</div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {SETTING_SPECS.map((spec) => {
              const v = profile.defaults[spec.key] as Value;
              const problem = validateSetting(spec, v);
              return (
                <Field key={spec.key} label={spec.label} hint={spec.hint}>
                  <SettingValue spec={spec} value={v} onChange={(x) => setDefault(spec, x)} />
                  {problem && <span className="text-3xs text-term-down">{problem}</span>}
                </Field>
              );
            })}
          </div>
        </div>
      </Panel>

      <Panel title="Overrides" code="INDEM-9" accent subtitle="narrower levels win: asset class, then pool bucket, borrower, position">
        <div className="flex flex-col gap-2 p-2">
          {OVERRIDE_LEVELS.map(({ key, label }) => {
            const entries = Object.entries(overridesAt(key));
            return entries.length === 0 ? null : (
              <div key={key}>
                <div className="term-label mb-1">{label}</div>
                <table className="w-full border-collapse">
                  <tbody>
                    {entries.flatMap(([t, settings]) => Object.entries(settings).map(([k, v]) => {
                      const spec = SETTING_SPECS.find((s) => s.key === k);
                      const problem = spec ? validateSetting(spec, v) : null;
                      return (
                        <tr key={`${key}-${t}-${k}`} className="border-b border-term-border-soft">
                          <td className={`${TD} w-40 text-left font-semibold text-term-amber`}>{t}</td>
                          <td className={`${TD} text-left text-term-text-dim`}>{spec?.label ?? k}</td>
                          <td className={`${TD} w-44`}>
                            {spec
                              ? <SettingValue spec={spec} value={v} onChange={(x) => setOverride(key, t, k, x)} />
                              : <NumInput label={k} value={v as number} onChange={(x) => setOverride(key, t, k, x ?? undefined)} />}
                            {problem && <span className="text-3xs text-term-down">{problem}</span>}
                          </td>
                          <td className={`${TD} w-16 text-right`}><button type="button" className="text-3xs text-term-text-mute hover:text-term-down" onClick={() => setOverride(key, t, k, undefined)}>Remove</button></td>
                        </tr>
                      );
                    }))}
                  </tbody>
                </table>
              </div>
            );
          })}
          {OVERRIDE_LEVELS.every(({ key }) => Object.keys(overridesAt(key)).length === 0) && <div className="text-3xs text-term-text-mute">No overrides. Add one below.</div>}
          <div className="grid grid-cols-2 items-end gap-2 border-t border-term-border pt-2 sm:grid-cols-5">
            <Field label="Applies to">
              <select aria-label="Override level" className={INPUT} value={level} onChange={(e) => { setLevel(e.target.value as OverrideLevel); setTarget(""); setSetting(SETTING_SPECS[0].key); }}>
                {OVERRIDE_LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
              </select>
            </Field>
            <Field label="Which one">
              <input aria-label="Override target" className={INPUT} list="indem-targets" value={target} onChange={(e) => setTarget(e.target.value)} />
              <datalist id="indem-targets">{suggestions[level].map((s) => <option key={s} value={s} />)}</datalist>
            </Field>
            <Field label="Setting">
              <select aria-label="Override setting" className={INPUT} value={setting} onChange={(e) => setSetting(e.target.value)}>
                {settingChoices.map((k) => <option key={k} value={k}>{SETTING_SPECS.find((s) => s.key === k)?.label ?? k}</option>)}
              </select>
            </Field>
            <button type="button" className="term-btn justify-center" onClick={addOverride}>Add override</button>
          </div>
        </div>
      </Panel>

      <Panel title="Saved profiles" code="INDEM-10" accent subtitle="kept in this browser only">
        <div className="flex flex-col gap-2 p-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="term-btn" onClick={doSave}>Save current profile</button>
          </div>
          {saved.length === 0 ? <div className="text-3xs text-term-text-mute">Nothing saved yet.</div> : (
            <table className="w-full border-collapse">
              <thead><tr><th className={`${TH} text-left`}>Name</th><th className={`${TH} text-left`}>Saved</th><th className={TH} /></tr></thead>
              <tbody>
                {saved.map((s) => (
                  <tr key={s.name} className="border-b border-term-border-soft">
                    <td className={`${TD} text-term-text`}>{s.name}</td>
                    <td className={`${TD} text-term-text-mute`}>{s.saved_at.slice(0, 16).replace("T", " ")}</td>
                    <td className={`${TD} text-right`}>
                      <button type="button" className="mr-3 text-3xs text-term-amber" onClick={() => { update(s.profile); setMessage(`Loaded "${s.name}".`); }}>Load</button>
                      <button type="button" className="text-3xs text-term-text-mute hover:text-term-down" onClick={() => { deleteProfile(s.name); refresh(); }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Field label="Import a profile (paste JSON or choose a file)">
            <textarea aria-label="Profile JSON" rows={3} className={`${INPUT} font-mono`} value={importText} onChange={(e) => setImportText(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="term-btn" disabled={!importText.trim()} onClick={() => doImport(importText)}>Import pasted JSON</button>
            <input type="file" accept="application/json,.json" aria-label="Profile file" className="text-3xs text-term-text-mute"
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) doImport(await f.text()); e.target.value = ""; }} />
          </div>
          {message && <div role="status" className="text-3xs text-term-amber">{message}</div>}
        </div>
      </Panel>

      <Panel title="Changes from the shipped default" code="INDEM-11" accent>
        {changes.length === 0 ? <div className="p-3 text-3xs text-term-text-mute">No changes.</div> : (
          <table className="w-full border-collapse tnum">
            <thead className="bg-term-panel-2"><tr><th className={`${TH} text-left`}>Level</th><th className={`${TH} text-left`}>Setting</th><th className={`${TH} text-right`}>Default</th><th className={`${TH} text-right`}>Now</th></tr></thead>
            <tbody>
              {changes.map((c, i) => (
                <tr key={i} className="border-b border-term-border-soft">
                  <td className={`${TD} text-left text-term-text-dim`}>{c.level === "defaults" ? "Defaults" : `${OVERRIDE_LEVELS.find((l) => l.key === c.level)!.label}: ${c.target}`}</td>
                  <td className={`${TD} text-left text-term-text`}>{SETTING_SPECS.find((s) => s.key === c.setting)?.label ?? c.setting}</td>
                  <td className={`${TD} text-right text-term-text-mute`}>{String(c.from)}</td>
                  <td className={`${TD} text-right text-term-amber`}>{String(c.to)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {effective.length > 0 && (
        <Panel title="Settings used in the last run" code="INDEM-12" accent subtitle="which level set each close-out period">
          <div className="max-h-[40vh] overflow-auto">
            <table className="w-full border-collapse tnum">
              <thead className="sticky top-0 bg-term-panel-2"><tr><th className={`${TH} text-left`}>Position</th><th className={`${TH} text-left`}>Kind</th><th className={`${TH} text-right`}>Close-out days</th><th className={`${TH} text-left`}>Set by</th></tr></thead>
              <tbody>
                {effective.map((e) => (
                  <tr key={e.position_id} className="border-b border-term-border-soft">
                    <td className={`${TD} text-left text-term-text`}>{e.position_id}</td>
                    <td className={`${TD} text-left text-term-text-mute`}>{e.kind.replace("_", " ")}</td>
                    <td className={`${TD} text-right text-term-text`}>{e.mpor_days}</td>
                    <td className={`${TD} text-left text-3xs text-term-text-mute`}>{[...new Set(Object.values(e.source_levels))].join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
