import { defineConfig } from "@playwright/test";

/**
 * Playwright runs the shared framework contract spec through the entry that
 * installs its `test`/`expect` globals. No browsers are required: the contract
 * exercises the reporter API, not a page.
 */
export default defineConfig({
  testDir: "./tests/integration",
  testMatch: "**/framework-contract.playwright.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  reporter: [["list"]],
});
