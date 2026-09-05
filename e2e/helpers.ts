import type { Page } from "@playwright/test";

/**
 * Signs in via the dev-login dropdown (ALLOW_DEV_LOGIN=true), matching
 * the seeded test users from src/db/seed/dev-test-users.ts:
 *   am@cpl.example    — Account Manager
 *   ppd@cpl.example   — Approver + PPD Manager
 *   admin@cpl.example — Admin
 *
 * Confirmed working against the real dev-login flow (see docs/backlog.md
 * for the two real bugs this helper had on its first actual run: an
 * ineffective waitForURL that never actually waited for sign-in to
 * complete, and no sign-out between calls when a test switches users).
 */
export async function signInAs(page: Page, upn: string) {
  // Clear any existing session first — tests that switch users mid-test
  // (submitter, then a different approver) would otherwise land on the
  // already-authenticated homepage instead of the sign-in form on the
  // second call, since there's no sign-out in between. Confirmed as a
  // real bug on this suite's first actual run: #upn never appeared for
  // any test that signs in more than once.
  await page.context().clearCookies();
  await page.goto("/");
  await page.locator("#upn").selectOption(upn);
  await page.getByRole("button", { name: "Sign in" }).click();
  // NOT waitForURL("/") — the page starts on "/" and redirects back to "/",
  // so that would resolve instantly without ever waiting for the sign-in
  // to actually complete (confirmed as the real cause of every test in
  // this suite failing on its first real run: the next navigation raced
  // ahead of the session cookie being set). Wait instead for something
  // that only renders once a session exists — the nav's user identity
  // (unique, unlike "New brief" which also appears as a page-body button
  // for account managers, causing a strict-mode ambiguity).
  await page.locator(".shell-user").waitFor();
}

/** Generates a deadline far enough out to clear the 14-day short-deadline
 * window and any test's own execution time. */
export function farFutureDeadline(daysFromNow = 45): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}
