import { expect, test } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const MODULES = [
  { code: "OPT", path: "/optimization" },
  { code: "COLL", path: "/collateral" },
  { code: "IBAL", path: "/inventory-optimizer" },
  { code: "CASH", path: "/cash-optimizer" },
  { code: "MMKT", path: "/money-market" },
  { code: "SXU", path: "/sources-uses" },
  { code: "MMFO", path: "/money-market-fund-optimizer" },
  { code: "REINV", path: "/reinvestment" },
  { code: "LIQ", path: "/liquidity" },
];

for (const module of MODULES) {
  test(`${module.code} page opens its help and white paper from the header`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${BASE}${module.path}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("open-guide").click();
    const drawer = page.getByTestId("guide-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("heading", { name: new RegExp(`\\(${module.code}\\): help and FAQ`) })).toBeVisible({ timeout: 10_000 });
    for (const section of ["Quick start", "Screen guide", "FAQ", "Troubleshooting", "Glossary"]) {
      await expect(page.getByTestId("guide-body").getByRole("heading", { name: section, exact: true })).toBeVisible();
    }
    await drawer.getByRole("tab", { name: "White paper" }).click();
    await expect(drawer.getByRole("heading", { name: new RegExp(`\\(${module.code}\\): white paper`) })).toBeVisible();
    await expect(page.getByTestId("guide-body").getByRole("heading", { name: "Executive summary", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test("guide search keeps only matching sections", async ({ page }) => {
  await page.goto(`${BASE}/inventory-optimizer`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-guide").click();
  const body = page.getByTestId("guide-body");
  await expect(body.getByRole("heading", { name: "Glossary", exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByLabel("Search this guide").fill("STALE_OR_FUTURE_AS_OF");
  await expect(body.getByRole("heading", { name: "Troubleshooting", exact: true })).toBeVisible();
  await expect(body.getByRole("heading", { name: "Glossary", exact: true })).toBeHidden();
  await page.getByLabel("Search this guide").fill("zzzz-no-such-text");
  await expect(body.getByText(/No section mentions/)).toBeVisible();
});

test("the guide library lists every optimization module and opens a full-page white paper", async ({ page }) => {
  await page.goto(`${BASE}/guides`, { waitUntil: "domcontentloaded" });
  const library = page.getByTestId("guide-library");
  for (const module of MODULES) await expect(library.getByText(module.code, { exact: true }).first()).toBeVisible();
  await page.goto(`${BASE}/guides/COLL/whitepaper`, { waitUntil: "domcontentloaded" });
  const article = page.getByTestId("guide-article");
  await expect(article.getByRole("heading", { name: "How it works", exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(article.locator("table").first()).toBeVisible();
  await page.getByRole("tab", { name: "Help & FAQ" }).click();
  await expect(page).toHaveURL(/\/guides\/COLL\/help$/);
  await expect(page.getByTestId("guide-article").getByRole("heading", { name: "Screen guide", exact: true })).toBeVisible();
});

test("the guide drawer fits a tablet-width screen", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1100 });
  await page.goto(`${BASE}/money-market`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-guide").click();
  await expect(page.getByTestId("guide-body").locator("table").first()).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
