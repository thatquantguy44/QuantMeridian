import { expect, test } from "@playwright/test";

const liveDemo = process.env.QM_OPTIMIZATION_DEMO_E2E === "1";

test.describe("verified optimization presenter paths", () => {
  test.skip(!liveDemo, "Set QM_OPTIMIZATION_DEMO_E2E=1 with both pinned local services and terminal tokens configured.");

  test("MMKT shows service-backed rate and forecast execution changes", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/money-market");
    const all = page.getByRole("button", { name: "Run all scenarios" });
    await expect(all).toBeEnabled();
    await all.click();
    await expect(page.getByRole("region", { name: /rate cut plan impact/i })).toBeVisible({ timeout: 210_000 });
    await expect(page.getByRole("region", { name: /cash forecast miss plan impact/i })).toBeVisible();
    await expect(page.getByText("Largest ticket changes from verified blotters:").first()).toBeVisible();
    await expect(page.getByText(/SIM/i).first()).toBeVisible();
  });

  test("IBAL prime planned failure stays unranked and the named repair verifies", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/inventory-optimizer");
    await page.getByRole("combobox", { name: "Showcase book" }).selectOption("prime");
    await page.getByRole("button", { name: "Start guided run" }).click();
    await expect(page.getByText("VERIFIED SIM")).toBeVisible();
    await page.getByRole("button", { name: "2. shock" }).click();
    await expect(page.getByText("No verified allocation is available for this step.")).toBeVisible();
    await page.getByRole("button", { name: "4. repair" }).click();
    await expect(page.getByText(/optimal \/ VERIFIED/i)).toBeVisible();
    await page.getByRole("button", { name: "5. compare" }).click();
    await expect(page.getByText(/Matched, new and unmatched entities remain separate/i)).toBeVisible();
  });
});
