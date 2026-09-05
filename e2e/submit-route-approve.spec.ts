import { test, expect } from "@playwright/test";
import { signInAs, farFutureDeadline } from "./helpers.js";

/**
 * Journey 2: submit a brief that raises a PPD resource requirement (so
 * it's commercially auto-approved but NOT fully clear), confirm no code
 * is issued yet, then sign in as the PPD Manager approver and approve it
 * via the real queue UI, confirming the code issues at that point.
 *
 * Confirmed passing for real — see playwright.config.ts's docstring.
 */
test("submit and route for approval, then approve: code withheld until the PPD sign-off clears", async ({
  page,
}) => {
  const customerReference = `E2E-ROUTE-APPROVE-${Date.now()}`;

  await signInAs(page, "am@cpl.example");
  await page.goto("/briefs/new");

  await page.locator("#customerReference").fill(customerReference);
  await page.locator("#tier").selectOption("A/T");
  await page.locator("#valuePotentialGbp").fill("200000");
  await page.locator("#newRework").selectOption("New");
  await page.locator("#briefType").selectOption("Exclusive");
  await page.locator("#customerApproval").selectOption("Direct");
  await page.locator("#creativeApproach").selectOption("Library Only");
  await page.locator("#deadline").fill(farFutureDeadline());
  await page.getByLabel("PPD resource").check();

  // Live preview should show the PPD requirement before submitting.
  await expect(page.getByText("PPD Manager")).toBeVisible();

  await page.getByRole("button", { name: "Submit brief" }).click();

  // Auto-approved commercially, but NOT fully clear — the central §5 rule.
  await expect(page.getByText("1 pending")).toBeVisible();
  await expect(page.getByText("not yet fully clear", { exact: false })).toBeVisible();

  // Sign in as the PPD Manager and approve it via the real queue.
  await signInAs(page, "ppd@cpl.example");
  await page.goto("/approvals");

  const row = page.locator(".card", { hasText: customerReference });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Approve" }).click();

  // After approval, the queue should no longer show this item (revalidated).
  await expect(page.locator(".card", { hasText: customerReference })).toHaveCount(0);
});
