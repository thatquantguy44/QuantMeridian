import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const datasetFixture = readFileSync("/tmp/live_dataset_check.json", "utf-8");

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

await page.route("**/api/inventory-optimizer/datasets/synthetic", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: datasetFixture })
);

await page.goto(`${BASE}/inventory-optimizer`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=InventoryBallast", { timeout: 15000 });

await page.click('button:has-text("Synthetic")');
await page.waitForSelector("text=VALID", { timeout: 10000 });
await page.waitForSelector("text=Dataset Preview", { timeout: 5000 });
console.log("1. Synthetic dataset (real captured fixture) generated, Dataset Preview panel appeared.");

await page.screenshot({ path: "/tmp/ibal_preview_01_inventory.png" });
const invRows = await page.locator("table tbody tr").count();
console.log(`2. Inventory tab (default) shows ${invRows} rows (expect 8).`);

for (const tab of ["Routes", "Demand", "Limits", "Policies", "Entities", "Raw"]) {
  await page.locator(`button:has-text("${tab}")`).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `/tmp/ibal_preview_${tab.toLowerCase()}.png` });
  const rows = await page.locator("table tbody tr").count();
  console.log(`3. ${tab} tab: ${rows} rows, screenshot captured.`);
}

console.log(`\nConsole errors: ${consoleErrors.length}`);
consoleErrors.forEach((e) => console.log("  -", e));

await browser.close();
console.log("\nDONE");
