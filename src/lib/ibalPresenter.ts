/** Guided-demo sequence for the InventoryBallast page (spec013 IBAL-006). Pure logic only. */

export interface PresenterStep { id: string; title: string; say: string }

export const PRESENTER_STEPS: PresenterStep[] = [
  { id: "engine", title: "Confirm the engine", say: "The solver is a pinned, verified build, not whatever happens to be installed. We warm it up first so nothing stalls on stage." },
  { id: "dataset", title: "Generate a book", say: "A synthetic securities-lending book: inventory, borrower demand, limits and fees. Clearly labelled as synthetic, with a hash so the exact book can be reproduced." },
  { id: "solve", title: "Solve the base case", say: "The optimizer reallocates inventory across routes to maximise lending value. An independent check re-verifies the answer before it is shown." },
  { id: "stress", title: "Stress one scenario", say: "Pick a failure mode, size it with the controls, and see how the verified answer moves and which routes and borrowers drive the change." },
  { id: "suite", title: "Rank every stress", say: "One click runs every supported scenario and ranks them, so the biggest risk to the book is at the top." },
  { id: "whatif", title: "Compare what-ifs", say: "Alternative market conditions, solved side by side against the base case, so a desk can see how sensitive the plan is." },
];

export type StepState = { done: boolean; busy: boolean; disabledReason?: string };
export type StepStatus = "done" | "busy" | "blocked" | "ready";

export function currentStepIndex(done: boolean[]): number {
  const first = done.findIndex((value) => !value);
  return first === -1 ? Math.max(0, done.length - 1) : first;
}

export function stepStatus(step: StepState): StepStatus {
  if (step.busy) return "busy";
  if (step.done) return "done";
  return step.disabledReason ? "blocked" : "ready";
}

const WARM_ENDPOINTS: { name: string; url: string }[] = [
  { name: "health", url: "/api/inventory-optimizer/health" },
  { name: "capabilities", url: "/api/inventory-optimizer/capabilities" },
  { name: "catalog", url: "/api/inventory-optimizer/scenarios/catalog" },
];

export interface WarmUpResult { ok: boolean; ms: number; failed: string[] }

/** Touch the read-only endpoints a demo needs so the first on-stage click is not the cold one. */
export async function warmUp(fetcher: typeof fetch = fetch, clock: () => number = () => performance.now()): Promise<WarmUpResult> {
  const started = clock();
  const settled = await Promise.allSettled(WARM_ENDPOINTS.map(async (endpoint) => {
    const response = await fetcher(endpoint.url, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
  }));
  const failed = WARM_ENDPOINTS.filter((_, index) => settled[index].status === "rejected").map((endpoint) => endpoint.name);
  return { ok: failed.length === 0, ms: Math.round(clock() - started), failed };
}
