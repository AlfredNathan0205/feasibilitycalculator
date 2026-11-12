import { test, expect } from "@playwright/test";
import { signInAs } from "./helpers.js";

/**
 * Niche Brand Assessment: an Account Manager creates a brand and completes the
 * assessment, the Commercial Director reviews it, and the brand then shows a
 * current assessment. Also checks the assessor cannot review their own work.
 */
test("create brand, assess, submit, review and approve", async ({ page }) => {
  const brand = `E2E Niche ${Date.now()}`;

  await signInAs(page, "am@cpl.example");
  await page.goto("/niche/brands/new");
  await page.waitForLoadState("networkidle");
  await page.locator("#name").fill(brand);
  await page.getByRole("button", { name: /create brand/i }).click();
  await expect(page.getByRole("heading", { name: brand })).toBeVisible();

  await page
    .getByRole("link", { name: /new assessment|start assessment/i })
    .first()
    .click();
  await page.getByRole("button", { name: "Start assessment" }).click();
  await page.waitForLoadState("networkidle");
  // Answer every criterion "Yes".
  const yes = page.locator('input[type="radio"][value="yes"]');
  const n = await yes.count();
  expect(n).toBeGreaterThanOrEqual(14);
  for (let i = 0; i < n; i++) {
    await yes.nth(i).locator("xpath=..").click();
    await expect(yes.nth(i)).toBeChecked();
  }
  await expect(page.getByText(/Strategic Partner/i).first()).toBeVisible();
  await page.getByRole("button", { name: /submit for review/i }).click();
  await expect(page.getByText(/awaiting review|submitted/i).first()).toBeVisible();

  // The assessor has no review controls on their own assessment.
  await expect(page.getByRole("button", { name: /^approve/i })).toHaveCount(0);

  await signInAs(page, "cd@cpl.example");
  await page.goto("/niche/review");
  await page.locator("tr", { hasText: brand }).getByRole("link").first().click();
  await page.getByRole("button", { name: /^approve/i }).click();
  await expect(page.getByText(/approved/i).first()).toBeVisible();

  await page.goto("/niche");
  await expect(page.locator("tr", { hasText: brand })).toContainText(/current/i);
});
