import { expect, test } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 720 },
  { name: "tablet", width: 820, height: 1100 },
];

for (const viewport of VIEWPORTS) {
  test(`COLL generated books and ranked stress (${viewport.name} ${viewport.width}x${viewport.height})`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${BASE}/collateral`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Service:\s*READY/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("SUCCEEDED_VERIFIED").first()).toBeVisible({ timeout: 20_000 });   // upstream SIM baseline

    // A generated book solves verified through the upload path and is never labelled SIM.
    await page.getByTestId("solve-generated-book").click();
    await expect(page.getByText("GENERATED DEMO BOOK · SYNTHETIC").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Input: USER_UPLOAD \/ native GENERATED-DEMO:dealer/)).toBeVisible();
    await expect(page.getByText("SUCCEEDED_VERIFIED").first()).toBeVisible();
    await expect(page.getByText("SIM / NO LIVE RECOMMENDATION")).toHaveCount(0);
    await expect(page.getByText(/vs verified incumbent/)).toBeVisible();     // the valid incumbent gives a saving

    // A sized stress changes only its own input and is flagged non-comparable.
    await page.getByTestId("stress-family").selectOption("call_spike");
    await page.getByLabel("Call increase value").fill("100");
    await expect(page.getByTestId("stress-changes")).toContainText("Changes input: calls");
    await page.getByTestId("solve-stress").click();
    await expect(page.getByText("NON-COMPARABLE for a causal savings claim")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Changed fields: calls\./)).toBeVisible();
    await expect(page.getByText("Incumbent invalid or no verified target")).toBeVisible();   // no saving claimed

    // The ranked suite solves every stress and orders them.
    await page.getByTestId("run-collateral-suite").click();
    const table = page.getByTestId("collateral-suite-table");
    await expect(table).toBeVisible({ timeout: 90_000 });
    await expect(table.locator("tbody tr")).toHaveCount(6);
    await expect(table.locator("tbody tr").first()).toContainText("Settlement cost spike");

    // Past the cliff the model says infeasible and shows no target cost.
    await page.getByTestId("stress-family").selectOption("reserve_squeeze");
    await page.getByLabel("Reserve as share of today's value").fill("500");
    await page.getByTestId("solve-stress").click();
    await expect(page.getByText("INFEASIBLE").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Unavailable").first()).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    expect(pageErrors).toEqual([]);
  });
}

test("the asset-manager book solves verified and keeps a different profile label", async ({ page }) => {
  await page.goto(`${BASE}/collateral`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Service:\s*READY/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("radio", { name: /Asset manager book/ }).check();
  await page.getByTestId("solve-generated-book").click();
  await expect(page.getByText(/Input: USER_UPLOAD \/ native GENERATED-DEMO:asset_manager/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("SUCCEEDED_VERIFIED").first()).toBeVisible();
});
