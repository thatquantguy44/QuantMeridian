import { expect, test, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 720 },
  { name: "tablet", width: 820, height: 1100 },
];

const current = (page: Page) => page.getByTestId("presenter-bar").locator('[aria-current="step"]');

for (const viewport of VIEWPORTS) {
  test(`IBAL guided demo walkthrough (${viewport.name} ${viewport.width}x${viewport.height})`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${BASE}/inventory-optimizer`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("status", { name: "Optimizer engine status" }).getByText("PIN VERIFIED")).toBeVisible({ timeout: 15_000 });

    // Present mode warms the engine up and starts at the first unfinished step.
    await page.getByRole("button", { name: "Present" }).click();
    const bar = page.getByTestId("presenter-bar");
    await expect(bar).toBeVisible();
    await expect(page.getByTestId("presenter-warm")).toContainText(/Warm · \d+ ms/, { timeout: 15_000 });
    await expect(current(page)).toContainText("Generate a book");
    await expect(page.getByTestId("presenter-say")).not.toBeEmpty();

    // The bar must never cause horizontal scrolling at any supported width.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const run = page.getByTestId("presenter-run");
    await run.click();                                                   // generate the book
    await expect(current(page)).toContainText("Solve the base case", { timeout: 30_000 });
    await run.click();                                                   // solve
    await expect(current(page)).toContainText("Stress one scenario", { timeout: 30_000 });
    await expect(page.getByText(/returned optimal/i)).toBeVisible();
    await run.click();                                                   // single engine stress
    await expect(current(page)).toContainText("Rank every stress", { timeout: 30_000 });
    await run.click();                                                   // ranked suite
    const table = page.getByTestId("stress-suite-table");
    await expect(table).toBeVisible({ timeout: 60_000 });
    expect(await table.locator("tbody tr").count()).toBeGreaterThanOrEqual(5);
    await expect(table.locator("tbody tr").first().locator("td").nth(4)).toHaveText("yes");   // verified
    await expect(current(page)).toContainText("Compare what-ifs");
    await run.click();                                                   // what-ifs
    await expect(page.getByText(/Completed \d+ what-if scenarios\./)).toBeVisible({ timeout: 60_000 });

    // Every step is now done: the stepper shows no remaining numbered (pending) step.
    await expect(bar.locator("ol button svg.text-term-up")).toHaveCount(6);

    await page.keyboard.press("Escape");
    await expect(bar).toBeHidden();
    expect(pageErrors).toEqual([]);
  });
}

test("scenario sizing form drives the engine parameters and clamps bad input", async ({ page }) => {
  await page.goto(`${BASE}/inventory-optimizer`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Synthetic$/i }).click();
  await expect(page.getByText("Dataset is valid and ready to run.")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Base Case Run$/i }).click();
  await expect(page.getByText(/returned optimal/i)).toBeVisible({ timeout: 30_000 });

  await page.locator("select").filter({ has: page.locator('option[value="recall_wave"]') }).selectOption("recall_wave");
  const json = page.locator("details", { hasText: "explicit engine parameters" }).locator("textarea");
  await page.locator("summary", { hasText: "Advanced: explicit" }).click();
  const quantities = async () => (JSON.parse(await json.inputValue()).targets as { quantity_shares: number }[]).map((t) => t.quantity_shares);

  const pct = page.getByLabel("Share of each route recalled value");
  await pct.fill("20");
  const small = await quantities();
  await pct.fill("80");
  const large = await quantities();
  expect(large[0]).toBeGreaterThan(small[0] * 3.9);           // 80% is four times 20% of the same baseline
  await pct.fill("5000");
  await expect(pct).toHaveValue("100");                        // clamped to the field's maximum
});
