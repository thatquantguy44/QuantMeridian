// Saved close-out profiles, kept in the browser (spec020 decision 7): the shipped default is a file in the
// repo; yours live in local storage with JSON export and import. Every run stores the full profile it used,
// so no result depends on this storage. Nothing here throws: storage can be blocked or full.
import type { CloseoutProfile } from "./indemnificationContract";
import { OVERRIDE_LEVELS, SETTING_SPECS, validateSetting } from "./indemnificationView";

export const STORAGE_KEY = "quantmeridian.indem.profiles.v1";
export interface SavedProfile { name: string; saved_at: string; profile: CloseoutProfile }

const SETTING_KEYS = new Set<string>(SETTING_SPECS.map((s) => s.key));
const POSITION_ONLY = new Set(["adv_units", "daily_vol"]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Every reason a profile is not acceptable; empty when it would pass the service's schema. */
export function profileIssues(value: unknown): string[] {
  if (!isObject(value)) return ["a profile must be a JSON object"];
  const issues: string[] = [];
  if (value.profile_schema_version !== "1.0") issues.push("profile_schema_version must be 1.0");
  if (typeof value.name !== "string" || value.name.trim() === "" || value.name.length > 80) issues.push("name must be 1 to 80 characters");
  if (!Number.isInteger(value.profile_version) || (value.profile_version as number) < 1) issues.push("profile_version must be a whole number from 1");
  if (!isObject(value.defaults)) { issues.push("defaults must be an object"); }
  else {
    for (const spec of SETTING_SPECS) {
      if (!(spec.key in value.defaults)) { issues.push(`defaults.${spec.key} is missing`); continue; }
      const problem = validateSetting(spec, value.defaults[spec.key]);
      if (problem) issues.push(`defaults: ${problem}`);
    }
    for (const key of Object.keys(value.defaults)) if (!SETTING_KEYS.has(key)) issues.push(`defaults.${key} is not a setting`);
  }
  for (const { key } of OVERRIDE_LEVELS) {
    const level = value[key];
    if (!isObject(level)) { issues.push(`${key} must be an object`); continue; }
    for (const [target, settings] of Object.entries(level)) {
      if (!isObject(settings) || Object.keys(settings).length === 0) { issues.push(`${key}.${target} must set at least one setting`); continue; }
      for (const [setting, v] of Object.entries(settings)) {
        const spec = SETTING_SPECS.find((s) => s.key === setting);
        if (spec) { const problem = validateSetting(spec, v); if (problem) issues.push(`${key}.${target}: ${problem}`); }
        else if (POSITION_ONLY.has(setting) && key === "position_overrides") {
          if (typeof v !== "number" || !(v > 0)) issues.push(`${key}.${target}.${setting} must be a positive number`);
        } else issues.push(`${key}.${target}.${setting} is not a setting`);
      }
    }
  }
  const known = new Set(["profile_schema_version", "name", "profile_version", "defaults", ...OVERRIDE_LEVELS.map((l) => l.key)]);
  for (const key of Object.keys(value)) if (!known.has(key)) issues.push(`${key} is not a profile field`);
  return issues;
}

export function exportProfile(profile: CloseoutProfile): string {
  return JSON.stringify(profile, null, 2) + "\n";
}

export function parseProfile(text: string): { ok: true; profile: CloseoutProfile } | { ok: false; issues: string[] } {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, issues: ["that is not valid JSON"] }; }
  const issues = profileIssues(value);
  return issues.length ? { ok: false, issues } : { ok: true, profile: value as CloseoutProfile };
}

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function listProfiles(store: Storage | null = storage()): SavedProfile[] {
  if (!store) return [];
  try {
    const raw = JSON.parse(store.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is SavedProfile => isObject(x) && typeof x.name === "string" && typeof x.saved_at === "string" && profileIssues(x.profile).length === 0);
  } catch { return []; }
}

/** Saves under the profile's own name, replacing one of the same name. False when storage refused. */
export function saveProfile(profile: CloseoutProfile, now: () => string = () => new Date().toISOString(), store: Storage | null = storage()): boolean {
  if (!store || profileIssues(profile).length) return false;
  try {
    const others = listProfiles(store).filter((p) => p.name !== profile.name);
    store.setItem(STORAGE_KEY, JSON.stringify([...others, { name: profile.name, saved_at: now(), profile }]));
    return true;
  } catch { return false; }
}

export function deleteProfile(name: string, store: Storage | null = storage()): boolean {
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(listProfiles(store).filter((p) => p.name !== name)));
    return true;
  } catch { return false; }
}
