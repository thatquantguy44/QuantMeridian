import { expect, test } from "@playwright/test";

test("COLL shows the true unconfigured service state without a synthetic solve", async ({ page }) => {
  await page.route("**/api/collateral-optimizer/health", route => route.fulfill({
    status: 503, json: { code: "BINDING_UNCONFIGURED", message: "Service URL is missing." }
  }));
  let submitted = 0;
  page.on("request", request => {
    if (request.url().includes("/api/collateral-optimizer/runs")) submitted += 1;
  });
  await page.goto("/collateral");
  await expect(page.getByText("BINDING_UNCONFIGURED")).toBeVisible();
  await expect(page.getByRole("button", { name: /Margin spike/ })).toBeDisabled();
  expect(submitted).toBe(0);
  await expect(page.getByText("No result")).toBeVisible();
});

test("COLL walks the pinned five-scenario SIM book without invented savings", async ({ page }) => {
  test.skip(process.env.COLLATERAL_E2E_REAL !== "1", "Requires the pinned local service.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/collateral");
  await expect(page.getByText("SUCCEEDED_VERIFIED").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Calls and haircut-adjusted coverage")).toBeVisible();
  await expect(page.getByText("Target allocation routes · model output")).toBeVisible();
  await expect(page.getByText("SIM / NO LIVE RECOMMENDATION")).toBeVisible();

  await page.getByRole("button", { name: /Margin spike/ }).click();
  await expect(page.getByText("Incumbent invalid or no verified target")).toBeVisible();
  await expect(page.getByText(/NON-COMPARABLE for a causal savings claim/)).toBeVisible();

  await page.getByRole("button", { name: /Liquidity scarcity/ }).click();
  await expect(page.getByText(/reserve:liquidity/)).toBeVisible();
  await page.getByRole("button", { name: /Cutoff \+ fees/ }).click();
  await expect(page.getByText("SUCCEEDED_VERIFIED").first()).toBeVisible();

  await page.getByRole("button", { name: /Infeasible stress/ }).click();
  await expect(page.getByText("INFEASIBLE").first()).toBeVisible();
  await expect(page.getByText("No verified target allocation.")).toBeVisible();
  await expect(page.getByText("No verified movement proposal.")).toBeVisible();
  await expect(page.getByText("Target cost")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("LCR contribution");
});

test("OPT reads a real SIM preview without operational run totals", async ({ page }) => {
  test.skip(process.env.COLLATERAL_E2E_REAL !== "1", "Requires the pinned local service.");
  await page.goto("/optimization");
  await expect(page.getByText("No durable collateral run registry is configured.")).toBeVisible();
  await page.getByRole("button", { name: "Solve baseline preview" }).click();
  await expect(page.getByText(/SUCCEEDED_VERIFIED/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/No live recommendation, booked movement, or operational savings total/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Recommended Trades");
});
