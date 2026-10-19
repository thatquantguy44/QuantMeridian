import { describe, expect, it } from "vitest";
import { DEFAULT_SYNTHETIC_CONFIG } from "@/lib/inventoryOptimizer";
import { DEFAULT_WHAT_IF_IDS, WHAT_IF_SCENARIOS, knownScenarioIds, scenarioSyntheticConfig } from "./ibalWhatIfs";

const live = { ...DEFAULT_SYNTHETIC_CONFIG, seed: 4242 };

describe("IBAL what-if presets", () => {
  it("solve every preset on the live seed, so only the shock differs from the base case", () => {
    for (const scenario of WHAT_IF_SCENARIOS) expect(scenarioSyntheticConfig(live, scenario).seed, scenario.id).toBe(4242);
  });

  it("replays a custom shock's own captured seed", () => {
    const custom = { id: "custom-1", label: "Saved", desc: "", synthetic: { ...live, seed: 99 }, isCustom: true };
    expect(scenarioSyntheticConfig(live, custom).seed).toBe(99);
  });

  it("change something real in every preset except the base case", () => {
    for (const scenario of WHAT_IF_SCENARIOS.filter((s) => s.id !== "base")) {
      const changed = Object.entries(scenario.synthetic ?? {}).some(([key, value]) => (live as Record<string, unknown>)[key] !== value);
      expect(changed, scenario.id).toBe(true);
    }
  });

  it("no longer offer a preset that only changes minimum entity confidence (the pinned engine ignores it)", () => {
    for (const scenario of WHAT_IF_SCENARIOS) {
      expect(Object.keys(scenario.runConfig ?? {})).not.toContain("minimum_entity_confidence");
    }
    expect(WHAT_IF_SCENARIOS.some((s) => s.id === "confidence")).toBe(false);
  });

  it("drop remembered selections that no longer exist and fall back to the defaults", () => {
    expect(knownScenarioIds(["base", "confidence"])).toEqual(["base"]);
    expect(knownScenarioIds(["confidence"])).toEqual(DEFAULT_WHAT_IF_IDS);
    expect(knownScenarioIds(["custom-1"], [{ id: "custom-1", label: "x", desc: "", isCustom: true }])).toEqual(["custom-1"]);
  });
});
