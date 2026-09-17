import { expect, test } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

test("IBAL loads data, runs optimizer, and exposes results", async ({ page }) => {
  const apiEvents: string[] = [];
  const pageErrors: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("/api/inventory-optimizer")) {
      apiEvents.push(`request ${request.method()} ${request.url()}`);
    }
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/inventory-optimizer")) {
      apiEvents.push(`response ${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/api/inventory-optimizer")) {
      apiEvents.push(`failed ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`);
    }
  });

  await page.goto(`${BASE}/inventory-optimizer`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "InventoryBallast" })).toBeVisible();

  const initialRun = page.getByRole("button", { name: /Load Data First/i });
  await expect(page.getByText("No dataset loaded")).toBeVisible();
  await expect(initialRun).toBeDisabled();

  const syntheticButton = page.getByRole("button", { name: /^Synthetic$/i });
  await expect(syntheticButton).toBeEnabled();
  const syntheticRequestPromise = page.waitForRequest(
    (request) => request.url().includes("/api/inventory-optimizer/datasets/synthetic") && request.method() === "POST",
    { timeout: 10_000 }
  );
  const syntheticResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/inventory-optimizer/datasets/synthetic") && response.request().method() === "POST",
    { timeout: 30_000 }
  );
  await syntheticButton.click();
  await syntheticRequestPromise;
  const syntheticResponse = await syntheticResponsePromise;
  expect(syntheticResponse.status(), apiEvents.join("\n")).toBe(200);

  await expect(page.getByText("Dataset loaded successfully")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Dataset is valid and ready to run.")).toBeVisible();

  const runButton = page.getByRole("button", { name: /^Base Case Run$/i });
  await expect(runButton).toBeEnabled();
  const runResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/inventory-optimizer/runs") && response.request().method() === "POST",
    { timeout: 30_000 }
  );
  await runButton.click();
  const runResponse = await runResponsePromise;
  expect(runResponse.status(), apiEvents.join("\n")).toBe(200);

  await expect(page.getByText(/returned optimal/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("OPTIMAL").first()).toBeVisible();
  await expect(page.getByText("Base Case Before / After")).toBeVisible();
  await expect(page.getByText("Top Route Movers")).toBeVisible();
  await expect(page.getByText("Demand Shortfall")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Export$/i })).toBeEnabled();

  const scenarioButton = page.getByRole("button", { name: /^Run Scenarios$/i });
  await expect(scenarioButton).toBeEnabled();
  await scenarioButton.click();
  await expect(page.getByText("Completed 4 what-if scenarios.")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("What If Comparison")).toBeVisible();
  await expect(page.getByText("Base Case").first()).toBeVisible();
  await expect(page.getByText("Scarce Supply").first()).toBeVisible();
  await expect(page.getByText("Specials Squeeze").first()).toBeVisible();
  await expect(page.getByText("Borrower Concentration").first()).toBeVisible();
  await expect(page.getByText(/Scenario Detail - /)).toBeVisible();
  await expect(page.getByText("Inventory Balances")).toBeVisible();
  await expect(page.getByText("Route Allocations")).toBeVisible();
  await expect(page.getByRole("cell", { name: /SYN-RT-/ }).first()).toBeVisible();
  await expect(page.getByText("failed")).toHaveCount(0);

  const body = await page.textContent("body");
  expect(body).not.toContain("REQUEST_HASH_MISMATCH");
  expect(pageErrors).toEqual([]);

  test.info().attach("ibal-api-events", {
    body: apiEvents.join("\n"),
    contentType: "text/plain",
  });
});
