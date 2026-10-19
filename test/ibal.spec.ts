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
  await expect(page.getByRole("status", { name: "Optimizer engine status" }).getByText("PIN VERIFIED")).toBeVisible({ timeout: 10_000 });

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
  await expect(page.getByRole("button", { name: /^Export Base Case$/i })).toBeEnabled();

  const secondRunResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/inventory-optimizer/runs") && response.request().method() === "POST",
    { timeout: 30_000 }
  );
  await runButton.click();
  const secondRunResponse = await secondRunResponsePromise;
  expect(secondRunResponse.status(), apiEvents.join("\n")).toBe(200);
  await expect(page.getByText("Base-Run Comparison")).toBeVisible();
  const baselineSelector = page.getByLabel("Baseline run");
  const comparisonSelector = page.getByLabel("Comparison run");
  await expect(baselineSelector.locator("option")).toHaveCount(2);
  await expect(comparisonSelector.locator("option")).toHaveCount(2);
  await expect(baselineSelector).not.toHaveValue(await comparisonSelector.inputValue());
  await expect(page.getByText(/Engine .* · backend/).first()).toBeVisible();
  await expect(page.getByText("Security Drivers · ABSOLUTE SHARE DELTA")).toBeVisible();
  await expect(page.getByText("Borrower / Parent Drivers · ABSOLUTE SHARE DELTA")).toBeVisible();
  await expect(page.getByText("Inventory Drivers · ABSOLUTE SHARE DELTA")).toBeVisible();
  await expect(page.getByText("Inventory Pool Drivers · ABSOLUTE SHARE DELTA")).toBeVisible();
  await expect(page.getByText("Route Drivers · ABSOLUTE SHARE DELTA")).toBeVisible();

  const scenarioButton = page.getByRole("button", { name: /^Run Scenarios$/i });
  await expect(scenarioButton).toBeEnabled();
  await scenarioButton.click();
  await expect(page.getByText("Completed 4 what-if scenarios.")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("Scenario Comparison")).toBeVisible();
  await expect(page.getByText("Base Case").first()).toBeVisible();
  await expect(page.getByText("Scarce Supply").first()).toBeVisible();
  await expect(page.getByText("Specials Squeeze").first()).toBeVisible();
  await expect(page.getByText("Borrower Concentration").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: /SYN-RT-/ }).first()).toBeVisible();
  await expect(page.getByText("failed")).toHaveCount(0);

  const body = await page.textContent("body");
  expect(body).not.toContain("REQUEST_HASH_MISMATCH");
  expect(pageErrors).toEqual([]);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("Base-Run Comparison")).toHaveCount(0);

  test.info().attach("ibal-api-events", {
    body: apiEvents.join("\n"),
    contentType: "text/plain",
  });
});

test("IBAL blocks solving and explains why when the engine does not match its pin", async ({ page }) => {
  await page.route("**/api/inventory-optimizer/health", (route) =>
    route.fulfill({
      json: {
        status: "unready",
        ready: false,
        engine_mismatches: ["fingerprint"],
        error_category: "incompatible_engine",
        backend: { name: "highs", version: "1.15.1", ready: true },
        formulations: ["lp", "mip", "qp"],
      },
    })
  );
  await page.route("**/api/inventory-optimizer/capabilities", async (route) => {
    const response = await route.fetch();
    route.fulfill({ response, json: { ...(await response.json()), engine_compatible: false } });
  });

  await page.goto(`${BASE}/inventory-optimizer`, { waitUntil: "domcontentloaded" });
  const strip = page.getByRole("status", { name: "Optimizer engine status" });
  await expect(strip.getByText("NOT READY")).toBeVisible({ timeout: 10_000 });
  await expect(strip.getByText("Installed engine does not match the pin (source fingerprint).")).toBeVisible();

  await page.getByRole("button", { name: /^Synthetic$/i }).click();
  await expect(page.getByText("Dataset loaded successfully")).toBeVisible({ timeout: 30_000 });
  const runButton = page.getByRole("button", { name: /^Engine Not Ready$/i });
  await expect(runButton).toBeDisabled();
  await expect(runButton).toHaveAttribute("title", "Installed engine does not match the pin (source fingerprint).");
  await expect(page.getByRole("button", { name: /^Run Scenarios$/i })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Run Engine Scenario/i })).toBeDisabled();
});

test("IBAL rejects a file type the service does not accept before uploading it", async ({ page }) => {
  let uploads = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/inventory-optimizer/datasets/upload")) uploads += 1;
  });
  await page.goto(`${BASE}/inventory-optimizer`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("status", { name: "Optimizer engine status" }).getByText("PIN VERIFIED")).toBeVisible({ timeout: 10_000 });

  await page.locator('input[type="file"]').setInputFiles({ name: "book.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2\n") });

  await expect(page.getByText('Unsupported file type ".csv". Upload XLSX or JSON.')).toBeVisible();
  expect(uploads).toBe(0);
});

test("IBAL hides result tabs the pinned service does not return", async ({ page }) => {
  await page.route("**/api/inventory-optimizer/capabilities", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    route.fulfill({ response, json: { ...body, output_sections: body.output_sections.filter((section: string) => section !== "economics") } });
  });
  await page.goto(`${BASE}/inventory-optimizer`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("status", { name: "Optimizer engine status" }).getByText("PIN VERIFIED")).toBeVisible({ timeout: 10_000 });

  await expect(page.getByRole("button", { name: /^Balances$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Raw$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Economics$/ })).toHaveCount(0);
});

test("IBAL recovers from a service outage without a page reload", async ({ page }) => {
  await page.route("**/api/inventory-optimizer/health", (route) => route.fulfill({ status: 503, json: { error: "down" } }));
  await page.goto(`${BASE}/inventory-optimizer`, { waitUntil: "domcontentloaded" });
  const strip = page.getByRole("status", { name: "Optimizer engine status" });
  await expect(strip.getByText("NOT READY")).toBeVisible({ timeout: 10_000 });
  await expect(strip.getByText(/Optimizer service is unavailable/)).toBeVisible();

  await page.unroute("**/api/inventory-optimizer/health");
  await strip.getByRole("button", { name: /Recheck/ }).click();
  await expect(strip.getByText("PIN VERIFIED")).toBeVisible({ timeout: 10_000 });
});

test("IBAL keeps custom synthetic counts within the service's bounds", async ({ page }) => {
  await page.goto(`${BASE}/inventory-optimizer`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Scale").selectOption("custom");
  await page.getByRole("spinbutton", { name: "Borrowers" }).fill("100");
  const parentGroups = page.getByRole("spinbutton", { name: "Parent groups" });
  await parentGroups.fill("60");
  await expect(parentGroups).toHaveValue("50");

  await page.getByRole("button", { name: /^Synthetic$/i }).click();
  await expect(page.getByText("Dataset loaded successfully")).toBeVisible({ timeout: 30_000 });
});
