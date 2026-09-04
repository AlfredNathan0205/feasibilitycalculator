import type { Page } from "@playwright/test";

/**
 * Signs in via the dev-login dropdown (ALLOW_DEV_LOGIN=true), matching
 * the seeded test users from src/db/seed/dev-test-users.ts:
 *   am@cpl.example    — Account Manager
 *   ppd@cpl.example   — Approver + PPD Manager
 *   admin@cpl.example — Admin
 *
 * NOT run/verified in the sandbox these tests were authored in (see
 * playwright.config.ts's docstring) — written against the real component
 * markup in src/app/page.tsx, but the first real run should be treated as
 * the actual verification step, not this comment.
 */
export async function signInAs(page: Page, upn: string) {
  await page.goto("/");
  await page.locator("#upn").selectOption(upn);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
}

/** Generates a deadline far enough out to clear the 14-day short-deadline
 * window and any test's own execution time. */
export function farFutureDeadline(daysFromNow = 45): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}
