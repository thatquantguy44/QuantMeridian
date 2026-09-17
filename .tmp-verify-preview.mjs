import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

await page.goto(`${BASE}/inventory-optimizer`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=InventoryBallast", { timeout: 15000 });

await page.click('button:has-text("Synthetic")');
await page.waitForSelector("text=VALID", { timeout: 10000 });
await page.waitForSelector("text=Dataset Preview", { timeout: 5000 });
console.log("1. Synthetic dataset generated, Dataset Preview panel appeared.");

await page.screenshot({ path: "/tmp/ibal_preview_01_inventory.png" });
const invRows = await page.locator("table tbody tr").count();
console.log(`2. Inventory tab (default) shows ${invRows} rows.`);

for (const tab of ["Routes", "Demand", "Limits", "Policies", "Entities", "Raw"]) {
  await page.locator(`button:has-text("${tab}")`).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `/tmp/ibal_preview_${tab.toLowerCase()}.png` });
  console.log(`3. ${tab} tab screenshot captured.`);
}

console.log(`\nConsole errors: ${consoleErrors.length}`);
consoleErrors.forEach((e) => console.log("  -", e));

await browser.close();
console.log("\nDONE");
