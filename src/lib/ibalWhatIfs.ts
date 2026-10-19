/**
 * IBAL What If presets. Each preset re-generates the synthetic book with ONE change on top of the live
 * Dataset Intake settings and the SAME seed, so a comparison against the Base Case isolates that change.
 * (Earlier presets also shifted the seed, which mixed every shock with a different random book.)
 */
import type { RunConfig, SyntheticConfig } from "@/lib/inventoryOptimizer";

export type WhatIfScenarioId = string;

export interface WhatIfScenario {
  id: WhatIfScenarioId;
  label: string;
  desc: string;
  synthetic?: Partial<SyntheticConfig>;
  runConfig?: Partial<RunConfig>;
  /** A saved custom shock: a full snapshot of the form, including its own seed. */
  isCustom?: boolean;
}

export const WHAT_IF_SCENARIOS: WhatIfScenario[] = [
  { id: "base", label: "Base Case", desc: "Current synthetic settings and run config." },
  { id: "scarce", label: "Scarce Supply", desc: "Higher utilization and tighter lendable supply.", synthetic: { profile: "scarce" } },
  { id: "specials", label: "Specials Squeeze", desc: "Higher fee dispersion and special-borrow demand.", synthetic: { profile: "specials" } },
  { id: "concentration", label: "Borrower Concentration", desc: "Demand concentrated into fewer parent groups.", synthetic: { profile: "concentrated" } },
  { id: "capacity", label: "More Balance Sheet", desc: "Looser utilization cap and smaller reserve buffer.", synthetic: { utilization_cap: 0.98, reserve_fraction: 0.02 } },
];

export const DEFAULT_WHAT_IF_IDS: WhatIfScenarioId[] = ["base", "scarce", "specials", "concentration"];

/** The synthetic config a scenario solves: presets keep the live seed; a custom shock replays its own. */
export function scenarioSyntheticConfig(live: SyntheticConfig, scenario: WhatIfScenario): SyntheticConfig {
  return { ...live, ...(scenario.synthetic ?? {}), seed: scenario.synthetic?.seed ?? live.seed } as SyntheticConfig;
}

/** Drop remembered selections that no longer exist (for example a retired preset); never return none. */
export function knownScenarioIds(selected: WhatIfScenarioId[] | undefined, custom: WhatIfScenario[] = []): WhatIfScenarioId[] {
  const known = new Set([...WHAT_IF_SCENARIOS, ...custom].map((scenario) => scenario.id));
  const kept = (selected ?? []).filter((id) => known.has(id));
  return kept.length ? kept : DEFAULT_WHAT_IF_IDS;
}
