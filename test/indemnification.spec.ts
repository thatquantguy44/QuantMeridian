/**
 * INDEM page (spec020 IND-T14). The Python service is replaced by a canned response built from the
 * contract fixture, so these tests need only the dev server: they check the page, not the model.
 * The model itself is tested in services/indemnification_api.
 *
 * Run: npx playwright test test/indemnification.spec.ts
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";

const URL = "/securities-lending/indemnification";
const result = JSON.parse(fs.readFileSync(path.resolve("contracts/indemnification/fixtures/result.example.json"), "utf8"));

const envelope = {
  api_schema_version: "1.0",
  correlation_id: "5d7c1a3e-8c1f-4f0e-9d53-2b6f4d1c9a10",
  run: {
    run_id: result.run_id,
    received_at: "2026-10-20T12:00:00Z",
    snapshot_hash: result.snapshot_hash,
    request_hash: "a".repeat(64),
    status: "complete",
    model_version: "indem-test",
    duration_ms: 1234,
  },
  result,
};

async function mockRun(page: Page, respond: "ok" | "unconfigured") {
  await page.route("**/api/indemnification/runs", (route) =>
    respond === "ok"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(envelope) })
      : route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "BINDING_UNCONFIGURED", message: "not configured" }) }),
  );
}

test.describe("INDEM page", () => {
  test("shows a result with the SIM label, seed, path count and standard errors on every KPI", async ({ page }) => {
    await mockRun(page, "ok");
    await page.goto(URL);
    await expect(page.getByTestId("indem-empty")).toBeVisible();
    await page.getByTestId("indem-run").click();
    await expect(page.getByTestId("indem-empty")).toHaveCount(0);

    const stamp = `SIM · seed ${result.run.seed} · ${result.run.paths.toLocaleString("en-US")} paths (preview)`;
    await expect(page.getByText(stamp).first()).toBeVisible();
    const kpis = page.locator("[data-testid=kpi-se]");
    expect(await kpis.count()).toBeGreaterThanOrEqual(5);
    for (const text of await kpis.allTextContents()) expect(text).toMatch(/^SE /);
    expect(await page.locator("body").innerText()).not.toMatch(/undefined|NaN/);

    for (const tab of ["Borrowers", "Close-out profile", "Sensitivities", "Stresses", "Reinvestment", "Model card"]) {
      await page.getByRole("tab", { name: tab }).click();
      expect(await page.locator("body").innerText(), tab).not.toMatch(/undefined|NaN/);
    }
  });

  test("explains a bad setting and does not send the run", async ({ page }) => {
    let sent = 0;
    await page.route("**/api/indemnification/runs", (route) => { sent += 1; return route.abort(); });
    await page.goto(URL);
    await page.getByLabel("Wrong-way correlation").fill("0.9");
    await expect(page.getByTestId("indem-issues")).toContainText("cannot exceed borrower correlation");
    await expect(page.getByTestId("indem-run")).toBeDisabled();
    expect(sent).toBe(0);
  });

  test("says so in plain language when the service is not configured", async ({ page }) => {
    await mockRun(page, "unconfigured");
    await page.goto(URL);
    await page.getByTestId("indem-run").click();
    await expect(page.getByRole("alert")).toContainText("not configured");
    await expect(page.getByTestId("indem-empty")).toBeVisible();
  });

  test("a saved close-out profile survives a reload, and an invalid import is refused", async ({ page }) => {
    await page.goto(URL);
    await page.getByRole("tab", { name: "Close-out profile" }).click();
    await page.getByLabel("Profile name").fill("e2e profile");
    await page.getByRole("button", { name: "Save current profile" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await page.reload();
    await page.getByRole("tab", { name: "Close-out profile" }).click();
    await expect(page.getByText("e2e profile").first()).toBeVisible();

    await page.getByLabel("Profile JSON").fill('{"name": "x"}');
    await page.getByRole("button", { name: "Import pasted JSON" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Not imported" })).toBeVisible();
  });
});
