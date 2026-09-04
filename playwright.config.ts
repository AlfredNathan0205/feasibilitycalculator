import { defineConfig } from "@playwright/test";

/**
 * IMPORTANT — see docs/runbook.md "Known gotchas": this suite was written
 * against the real app markup but could NOT be executed in the sandbox
 * these tests were authored in (its network egress allowlist blocks
 * cdn.playwright.dev, which is needed to download the browser binary).
 * Every other test in this repo has been run and confirmed passing before
 * being called done — these have not. Run them for real (`npx playwright
 * test`) before trusting them, and expect to fix selector/timing issues on
 * the first real run.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // tests share one Postgres instance; avoid cross-test interference
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
