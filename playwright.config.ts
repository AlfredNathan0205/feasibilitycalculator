import { defineConfig } from "@playwright/test";

/**
 * All three journeys in this suite have been run for real and pass —
 * confirmed twice from a clean state. See docs/backlog.md for what was
 * found and fixed on the first actual run (two real bugs in
 * e2e/helpers.ts, one in a spec's assertion), and for the one-off
 * workaround used to get a Chromium binary in a network-restricted
 * sandbox (not needed on a machine with normal internet access — just
 * run `npx playwright install` there as usual).
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
