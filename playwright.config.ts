import fs from "node:fs";
import { defineConfig } from "@playwright/test";

// A Chromium that is already installed outside Playwright's own cache, used only when it exists:
// PLAYWRIGHT_CHROMIUM_PATH if set, else the path the cloud sandbox ships. Anywhere else (CI after
// `npx playwright install chromium`, a laptop) Playwright launches its own managed browser.
const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_PATH || (fs.existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined);

export default defineConfig({
  testDir: "./test",
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:5173",
    headless: true,
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: "npx vite --host 0.0.0.0 --port 5173",
    port: 5173,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
