import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vitest's default include glob also matches *.spec.ts, which collides
    // with the Playwright e2e suite in e2e/ (which uses @playwright/test's
    // own test/expect, not Vitest's — Vitest can't collect them at all).
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "e2e/**"],
    // Every integration test file (create-brief, decide-requirement,
    // stage-c, rule-set-editor, reporting, notifications/dispatch-
    // notifications) opens its own connection to the SAME DATABASE_URL and
    // reads/writes shared tables (briefs, decisions, role_holders, ...).
    // Vitest's default is to run test files concurrently across worker
    // threads, which is fine when each file is isolated — it is NOT fine
    // here, because one file's aggregate count query (e.g. reporting's
    // "totals sum to the actual number of decisions") can race against
    // another file's insert. This mostly went unnoticed against a local
    // Postgres (same-machine round-trips are fast enough that the race
    // window rarely gets hit) but became a real, reproducible source of
    // "off by one" failures once tests ran against Supabase, where network
    // latency widens that window. Running test files sequentially removes
    // the race entirely; the suite is small enough (a few seconds) that
    // the serialization cost is negligible.
    fileParallelism: false,
  },
});
