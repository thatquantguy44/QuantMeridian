// InventoryBallast 0018 T-015 / AC-028: OPT lists the model runs this terminal server forwarded,
// with each service's own status, and no fabricated rows. Local only (CI runs the smoke specs):
// start the IBAL service and the built terminal, then
//   BASE_URL=http://127.0.0.1:3000 npx playwright test test/opt-run-log.spec.ts --retries=0
import { expect, test } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

test("OPT session run log lists a real IBAL run with the service's own status", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  await page.goto(`${BASE}/inventory-optimizer`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("status", { name: "Optimizer engine status" }).getByText("PIN VERIFIED")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /^Synthetic$/i }).click();
  await expect(page.getByText("Dataset is valid and ready to run.")).toBeVisible({ timeout: 30_000 });
  const solved = page.waitForResponse((r) => r.url().includes("/api/inventory-optimizer/runs") && r.request().method() === "POST");
  await page.getByRole("button", { name: /^Base Case Run$/i }).click();
  const { result } = await (await solved).json() as { result: { run_id: string; status: string; verification: { passed: boolean } } };

  await page.goto(`${BASE}/optimization`, { waitUntil: "domcontentloaded" });
  const log = page.getByTestId("opt-run-log");
  await expect(log).toBeVisible({ timeout: 15_000 });
  const row = log.locator("tbody tr", { hasText: result.run_id });
  await expect(row).toHaveCount(1);
  const cells = await row.locator("td").allInnerTexts();
  expect(cells.slice(1, 6)).toEqual(["IBAL", "run", result.run_id, result.status, result.verification.passed ? "yes" : "no"]);
  await expect(page.getByText("NOT PERSISTED")).toBeVisible();

  // Every row is backed by a server log entry: the table and the API agree exactly.
  const api = await page.evaluate(async () => (await (await fetch("/api/optimization/runs")).json()) as { persisted: boolean; runs: { run_id: string | null }[] });
  expect(api.persisted).toBe(false);
  expect(await log.locator("tbody tr").count()).toBe(api.runs.length);
  expect(errors).toEqual([]);
});
