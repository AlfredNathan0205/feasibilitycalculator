import { expect, test } from "@playwright/test";
import { farFutureDeadline, signInAs } from "./helpers";

test("a submitted brief can be found in the list and opened, and an Admin sees its audit trail", async ({
  page,
}) => {
  const customer = `E2E-BROWSE-${Date.now()}`;

  await signInAs(page, "am@cpl.example");
  const res = await page.request.post("/api/briefs", {
    data: {
      customerReference: customer,
      tier: "A/T",
      valuePotentialGbp: 200000,
      newRework: "New",
      briefType: "Exclusive",
      customerApproval: "Direct",
      nicheFfPreApproved: false,
      strategicPriority: false,
      creativeApproach: "Library Only",
      marketingFlag: false,
      ppdFlag: false,
      gcmsFlag: false,
      deadline: farFutureDeadline(),
    },
  });
  expect(res.ok()).toBeTruthy();

  // Submitter: finds it by search and opens the detail page, but sees no audit trail.
  await page.goto(`/briefs?q=${customer}`);
  await page.getByRole("link", { name: customer }).click();
  await expect(page.getByRole("heading", { name: customer })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit trail" })).toHaveCount(0);
  const detailUrl = page.url();

  // Admin: same brief, with the audit trail.
  await signInAs(page, "admin@cpl.example");
  await page.goto(detailUrl);
  await expect(page.getByRole("heading", { name: "Audit trail" })).toBeVisible();
  await expect(page.getByText("brief.submitted")).toBeVisible();
});
