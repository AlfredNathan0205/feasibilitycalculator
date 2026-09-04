import { test, expect } from "@playwright/test";
import { signInAs, farFutureDeadline } from "./helpers.js";

/**
 * Journey 1 (§14's three primary journeys): submit a brief that
 * commercially auto-approves with zero outstanding requirements, and
 * confirm an Approval Code is issued immediately.
 *
 * NOT verified as passing — see playwright.config.ts's docstring.
 */
test("submit and auto-approve: A/T tier, £200k, New/Exclusive/Direct/Library Only issues a code immediately", async ({
  page,
}) => {
  await signInAs(page, "am@cpl.example");

  await page.goto("/briefs/new");

  await page.locator("#customerReference").fill("E2E-AUTO-APPROVE");
  await page.locator("#tier").selectOption("A/T");
  await page.locator("#valuePotentialGbp").fill("200000");
  await page.locator("#newRework").selectOption("New");
  await page.locator("#briefType").selectOption("Exclusive");
  await page.locator("#customerApproval").selectOption("Direct");
  await page.locator("#creativeApproach").selectOption("Library Only");
  await page.locator("#deadline").fill(farFutureDeadline());
  // marketingFlag / ppdFlag / gcmsFlag all default unchecked — zero
  // requirements expected.

  // Live preview should show the score before submitting.
  await expect(page.getByText("900.0")).toBeVisible();
  await expect(page.getByText("Auto-Approved")).toBeVisible();

  await page.getByRole("button", { name: "Submit brief" }).click();

  // Outcome page: two-part display (§9) — commercial decision AND
  // outstanding approvals shown as separate facts.
  await expect(page.getByText("Commercial decision")).toBeVisible();
  await expect(page.getByText("Outstanding approvals")).toBeVisible();
  await expect(page.getByText("None")).toBeVisible();

  // The Approval Code itself — format FC-YYMM-XXXXX-C.
  const codeLocator = page.locator("code", {
    hasText: /^FC-\d{4}-[0-9A-Z]{5}-[0-9A-Z]$/,
  });
  await expect(codeLocator).toBeVisible();
});
