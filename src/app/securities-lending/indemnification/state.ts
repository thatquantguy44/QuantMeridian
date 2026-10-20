// The INDEM page's state and the rules around it (spec020 IND-T14). Pure, so it is tested without a browser.
import type { BookSummary, UiRunInput } from "@/lib/indemnificationCompose";
import type { CloseoutProfile, CloseoutSettings, StepSize } from "@/lib/indemnificationContract";
import { profileIssues } from "@/lib/indemnificationProfiles";

export type Mode = "desk" | "annual";
export const PREVIEW_PATHS = 5000;
export const MODE_DEFAULTS: Record<Mode, { horizonDays: number; step: StepSize }> = {
  desk: { horizonDays: 21, step: "daily" },
  annual: { horizonDays: 252, step: "weekly" },
};

export interface CreditEntry { spread_bps: number; recovery: number | null }

export interface UiState {
  mode: Mode;
  /** A preview run uses 5,000 paths and is labelled as such; otherwise `paths` is used. */
  preview: boolean;
  paths: number;
  seed: number;
  horizonDays: number;
  step: StepSize;
  rhoD: number;
  rhoW: number;
  studentT: boolean;
  studentNu: number;
  costOfCapital: number;
  flagThreshold: number;
  sweeps: boolean;
  sweepPaths: number;
  stresses: boolean;
  stressOverrides: Partial<CloseoutSettings>;
  profile: CloseoutProfile;
  credit: Record<string, CreditEntry>;
}

export function defaultUi(book: BookSummary): UiState {
  const d = book.defaults;
  return {
    mode: "desk", preview: true, paths: d.run.paths, seed: d.run.seed,
    horizonDays: MODE_DEFAULTS.desk.horizonDays, step: MODE_DEFAULTS.desk.step,
    rhoD: d.model.rho_d, rhoW: d.model.rho_w, studentT: d.model.student_t_enabled, studentNu: d.model.student_t_nu,
    costOfCapital: d.pricing.cost_of_capital, flagThreshold: d.pricing.flag_threshold,
    sweeps: true, sweepPaths: d.options.sensitivity_paths ?? 5000, stresses: d.options.stresses,
    stressOverrides: {}, profile: JSON.parse(JSON.stringify(d.profile)), credit: {},
  };
}

/** Switching mode moves the horizon and step to that mode's defaults. */
export function withMode(state: UiState, mode: Mode): UiState {
  return { ...state, mode, ...MODE_DEFAULTS[mode] };
}

export function effectivePaths(state: UiState): number {
  return state.preview ? Math.min(PREVIEW_PATHS, state.paths) : state.paths;
}

/** Everything wrong with the current choices, in plain language; empty when the run can be sent. */
export function uiIssues(state: UiState): string[] {
  const issues: string[] = [];
  const whole = (v: number) => Number.isInteger(v);
  if (!whole(state.paths) || state.paths < 1000 || state.paths > 500000) issues.push("Paths must be a whole number from 1,000 to 500,000.");
  if (!whole(state.seed) || state.seed < 0) issues.push("Seed must be a whole number from 0.");
  if (!whole(state.horizonDays) || state.horizonDays < 21 || state.horizonDays > 1260) issues.push("Horizon must be from 21 to 1,260 business days.");
  if (!(state.rhoD >= 0 && state.rhoD < 1)) issues.push("Borrower correlation must be from 0 to below 1.");
  if (!(state.rhoW >= 0 && state.rhoW < 1)) issues.push("Wrong-way correlation must be from 0 to below 1.");
  else if (state.rhoW ** 2 > state.rhoD) issues.push(`Wrong-way correlation squared (${(state.rhoW ** 2).toFixed(3)}) cannot exceed borrower correlation (${state.rhoD}).`);
  if (!whole(state.studentNu) || state.studentNu < 3) issues.push("Student-t degrees of freedom must be a whole number of at least 3.");
  if (!(state.costOfCapital >= 0 && state.costOfCapital <= 1)) issues.push("Cost of capital must be from 0 to 100%.");
  if (!(state.flagThreshold >= 0)) issues.push("Flag threshold cannot be negative.");
  if (state.sweeps && (!whole(state.sweepPaths) || state.sweepPaths < 1000)) issues.push("Paths per sweep point must be a whole number of at least 1,000.");
  for (const [id, entry] of Object.entries(state.credit)) {
    if (!(entry.spread_bps > 0)) issues.push(`Credit spread for ${id} must be above 0 bp.`);
    if (entry.recovery !== null && !(entry.recovery >= 0 && entry.recovery < 1)) issues.push(`Recovery for ${id} must be from 0 to below 100%.`);
  }
  issues.push(...profileIssues(state.profile).map((p) => `Close-out profile: ${p}`));
  return issues;
}

/** The request body for POST /api/indemnification/runs. Only choices; the server supplies the book. */
export function toRunInput(state: UiState): UiRunInput {
  const stressOverrides = Object.keys(state.stressOverrides).length ? state.stressOverrides : null;
  return {
    run: {
      mode: state.mode, seed: state.seed, paths: effectivePaths(state), preview: state.preview,
      horizon_days: state.horizonDays, step: state.step,
    },
    model: { rho_d: state.rhoD, rho_w: state.rhoW, student_t_enabled: state.studentT, student_t_nu: state.studentNu },
    pricing: { cost_of_capital: state.costOfCapital, flag_threshold: state.flagThreshold },
    profile: state.profile,
    borrower_credit: Object.keys(state.credit).length ? state.credit : undefined,
    options: { sensitivity_paths: state.sweeps ? state.sweepPaths : null, stresses: state.stresses, stress_profile_overrides: stressOverrides },
  };
}

/** A one-line description of what a run will do, shown next to the Run button. */
export function describeRun(state: UiState): string {
  const view = state.mode === "desk" ? "Desk view" : "Annual view";
  const kind = state.preview ? "preview" : "reported";
  return `${view} · ${state.horizonDays} business days, ${state.step} steps · ${effectivePaths(state).toLocaleString("en-US")} paths (${kind}) · seed ${state.seed}`;
}

/** Pricing is produced only for an annual run over 252 business days. */
export function willBePriced(state: UiState): boolean {
  return state.mode === "annual" && state.horizonDays === 252;
}
