import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { signInAs } from "./helpers.js";
import { brandWithApprovedAssessment, connect } from "./niche-fixtures.js";
import * as schema from "../src/db/schema.js";

test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed for the niche fixtures");

test("an expired assessment is shown as expired and no longer counts for a brief", async ({
  page,
}) => {
  const { sql, db } = connect();
  let name: string;
  try {
    const b = await brandWithApprovedAssessment(db, "strategic_partner", "Expired");
    name = b.name;
    await db
      .update(schema.nicheAssessments)
      .set({ validUntil: "2020-01-01" })
      .where(eq(schema.nicheAssessments.id, b.assessmentId));
  } finally {
    await sql.end();
  }
  await signInAs(page, "am@cpl.example");
  await page.goto("/niche");
  await expect(page.locator("tr", { hasText: name })).toContainText(/expired/i);
  await page.goto("/briefs/new");
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("radiogroup", { name: /niche brand/i })
    .getByLabel("Yes")
    .check();
  await page.locator("#nicheBrandText").fill(name);
  await expect(page.getByText(/No current Niche Brand Assessment/i)).toBeVisible();
});

test("framework draft: change a band threshold, replay shows the affected assessments, discard", async ({
  page,
}) => {
  await signInAs(page, "admin@cpl.example");
  await page.goto("/admin/niche-frameworks");
  await page.waitForLoadState("networkidle");
  // Clear any draft left by an earlier run, then start a fresh one.
  const edit = page.getByRole("link", { name: "Edit" });
  if (await edit.count()) {
    await edit.first().click();
    await page.getByRole("button", { name: "Discard draft" }).click();
    await expect(page.getByText(/draft discarded/i)).toBeVisible();
  }
  await page.getByRole("button", { name: "New draft" }).click();
  await page.waitForLoadState("networkidle");
  // Strategic Partner from 80 to 99: nearly every existing Tier 1 assessment would move down.
  await page.locator('tbody tr input[type="number"]').first().fill("99");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/draft saved/i)).toBeVisible();
  await page.getByRole("button", { name: "Run replay" }).click();
  await expect(page.getByText(/would\s+change/i)).toBeVisible();
  await expect(page.locator("table", { hasText: "Would be" })).toBeVisible();
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expect(page.getByText(/draft discarded/i)).toBeVisible();
});
