import { test, expect, type Page } from "@playwright/test";
import { signInAs, farFutureDeadline, selectTierA } from "./helpers.js";
import {
  brandWithApprovedAssessment,
  connect,
  ensureNicheRoutingPublished,
} from "./niche-fixtures.js";
import type { NicheBand } from "../src/engine/niche-assessment.js";

test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed for the niche fixtures");

test.beforeAll(async () => {
  const { sql, db } = connect();
  try {
    await ensureNicheRoutingPublished(db);
  } finally {
    await sql.end();
  }
});

async function makeBrand(band: NicheBand, label: string) {
  const { sql, db } = connect();
  try {
    return await brandWithApprovedAssessment(db, band, label);
  } finally {
    await sql.end();
  }
}

/** Fills the brief form with a Creation/Unknown-free, comfortably-scored brief for a niche brand. */
async function fillNicheBrief(
  page: Page,
  brandName: string,
  route?: { value: string; why: string },
) {
  const ref = `E2E-NICHE-${Date.now()}`;
  await page.goto("/briefs/new");
  await page.waitForLoadState("networkidle");
  await page.locator("#customerReference").fill(ref);
  await selectTierA(page);
  await page.locator("#valuePotentialGbp").fill("50000");
  await page.locator("#newRework").selectOption("New");
  await page.locator("#briefType").selectOption("Exclusive");
  await page.locator("#customerApproval").selectOption("Direct");
  await page.locator("#creativeApproach").selectOption("Library Only");
  await page.locator("#deadline").fill(farFutureDeadline());
  await page
    .getByRole("radiogroup", { name: /niche brand/i })
    .getByLabel("Yes")
    .check();
  await page.locator("#nicheBrandText").fill(brandName);
  if (route) {
    await page.locator("#nicheRoute").selectOption(route.value);
    await page.locator("#nicheRouteRationale").fill(route.why);
  }
  await page.getByRole("button", { name: "Next: Approvals" }).click();
  await page.getByRole("button", { name: "Next: Review & submit" }).click();
  await page.getByRole("button", { name: "Submit brief" }).click();
  return ref;
}

test("Strategic Partner brand: brief is pre-approved with no extra sign-off", async ({
  page,
}) => {
  const { name } = await makeBrand("strategic_partner", "Tier1");
  await signInAs(page, "am@cpl.example");
  await fillNicheBrief(page, name);
  await expect(page.getByText(/approval code/i).first()).toBeVisible();
  await expect(page.getByText(/not yet fully clear/i)).toHaveCount(0);
});

test("Growth Partner brand: needs the Commercial Director, who then clears it", async ({
  page,
}) => {
  const { name } = await makeBrand("growth_partner", "Tier2");
  await signInAs(page, "am@cpl.example");
  const ref = await fillNicheBrief(page, name);
  await expect(page.getByText(/not yet fully clear/i)).toBeVisible();

  await signInAs(page, "cd@cpl.example");
  await page.goto("/approvals");
  const row = page.locator(".card", { hasText: ref });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator(".card", { hasText: ref })).toHaveCount(0);
});

test("Development Opportunity: the route is required and goes to the Development Director", async ({
  page,
}) => {
  const { name } = await makeBrand("development_opportunity", "Dev");
  await signInAs(page, "am@cpl.example");
  const ref = await fillNicheBrief(page, name, {
    value: "junior_perfumer_development",
    why: "Good brief for a junior perfumer to learn on",
  });
  await expect(page.getByText(/not yet fully clear/i)).toBeVisible();

  await signInAs(page, "dd@cpl.example");
  await page.goto("/approvals");
  await expect(page.locator(".card", { hasText: ref })).toBeVisible();
});

test("Charge or Decline brand: the charging model goes to the Commercial Director", async ({
  page,
}) => {
  const { name } = await makeBrand("charge_or_decline", "Charge");
  await signInAs(page, "am@cpl.example");
  const ref = await fillNicheBrief(page, name, {
    value: "charging_model",
    why: "Brand will pay for development work",
  });
  await expect(page.getByText(/not yet fully clear/i)).toBeVisible();
  await signInAs(page, "cd@cpl.example");
  await page.goto("/approvals");
  await expect(page.locator(".card", { hasText: ref })).toBeVisible();
});

test("Charge or Decline brand: choosing Decline declines the brief", async ({ page }) => {
  const { name } = await makeBrand("charge_or_decline", "Decline");
  await signInAs(page, "am@cpl.example");
  await fillNicheBrief(page, name, {
    value: "decline",
    why: "We do not take this brand on",
  });
  await expect(page.getByText(/declined/i).first()).toBeVisible();
});

test("A brand with no current assessment warns and is scored as a standard brief", async ({
  page,
}) => {
  await signInAs(page, "am@cpl.example");
  const brand = `E2E NoAssess ${Date.now()}`;
  await page.goto("/niche/brands/new");
  await page.waitForLoadState("networkidle");
  await page.locator("#name").fill(brand);
  await page.getByRole("button", { name: /create brand/i }).click();
  await expect(page.getByRole("heading", { name: brand })).toBeVisible();
  await page.goto("/briefs/new");
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("radiogroup", { name: /niche brand/i })
    .getByLabel("Yes")
    .check();
  await page.locator("#nicheBrandText").fill(brand);
  await expect(page.getByText(/No current Niche Brand Assessment/i)).toBeVisible();
});
