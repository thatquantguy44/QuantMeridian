import { describe, expect, it, vi } from "vitest";
import { PRESENTER_STEPS, currentStepIndex, stepStatus, warmUp } from "./ibalPresenter";

describe("presenter steps", () => {
  it("walks the story in order and gives every step something to say", () => {
    expect(PRESENTER_STEPS.map((s) => s.id)).toEqual(["engine", "dataset", "solve", "stress", "suite", "whatif"]);
    for (const step of PRESENTER_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.say.length).toBeGreaterThan(20);
    }
  });

  it("points at the first step that is not done", () => {
    expect(currentStepIndex([false, false, false, false, false, false])).toBe(0);
    expect(currentStepIndex([true, true, false, false, false, false])).toBe(2);
    expect(currentStepIndex([true, true, true, false, true, false])).toBe(3);
  });

  it("stays on the last step once everything is done", () => {
    expect(currentStepIndex([true, true, true, true, true, true])).toBe(5);
  });

  it("classifies a step as blocked, busy, done or ready", () => {
    expect(stepStatus({ done: true, busy: false })).toBe("done");
    expect(stepStatus({ done: false, busy: true })).toBe("busy");
    expect(stepStatus({ done: false, busy: false, disabledReason: "Generate a dataset first." })).toBe("blocked");
    expect(stepStatus({ done: false, busy: false })).toBe("ready");
    expect(stepStatus({ done: true, busy: true })).toBe("busy"); // re-running a finished step shows progress
  });
});

describe("warmUp", () => {
  const ok = () => Promise.resolve(new Response("{}", { status: 200 }));

  it("touches health, capabilities and the scenario catalog once each", async () => {
    const fetcher = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => ok());
    const result = await warmUp(fetcher as unknown as typeof fetch);
    const urls = fetcher.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual(expect.arrayContaining([
      "/api/inventory-optimizer/health",
      "/api/inventory-optimizer/capabilities",
      "/api/inventory-optimizer/scenarios/catalog",
    ]));
    expect(urls).toHaveLength(3);
    expect(result.ok).toBe(true);
    expect(result.failed).toEqual([]);
  });

  it("reports which endpoints failed instead of throwing", async () => {
    const fetcher = vi.fn((url: RequestInfo | URL) =>
      String(url).includes("capabilities") ? Promise.reject(new Error("down")) : ok());
    const result = await warmUp(fetcher as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.failed).toEqual(["capabilities"]);
  });

  it("treats a non-2xx response as a failure", async () => {
    const fetcher = vi.fn((url: RequestInfo | URL) =>
      Promise.resolve(new Response("{}", { status: String(url).includes("catalog") ? 503 : 200 })));
    const result = await warmUp(fetcher as unknown as typeof fetch);
    expect(result.failed).toEqual(["catalog"]);
  });

  it("measures elapsed time with the supplied clock", async () => {
    const times = [1000, 1250];
    const result = await warmUp(ok as unknown as typeof fetch, () => times.shift() ?? 0);
    expect(result.ms).toBe(250);
  });
});
