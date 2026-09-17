import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  timeout: 45_000,
  retries: 0,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
    },
  },
});
