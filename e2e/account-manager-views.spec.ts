import { expect, test } from "@playwright/test";
import { farFutureDeadline, signInAs } from "./helpers";

test("Admin can filter briefs and the dashboard by Account Manager; the General Manager sees the dashboard without exports", async ({
  page,
}) => {
  const customer = `E2E-AM-${Date.now()}`;

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
      ppdFlag: true,
      gcmsFlag: false,
      deadline: farFutureDeadline(),
    },
  });
  expect(res.ok()).toBeTruthy();

  // An Account Manager sees no Account Manager filter and no dashboard.
  await page.goto("/briefs");
  await expect(page.getByLabel("Account Manager")).toHaveCount(0);
  await page.goto("/dashboard");
  await expect(
    page.getByText(/Requires the Admin, Auditor or General Manager role/),
  ).toBeVisible();

  // Admin: filter the list to that Account Manager.
  await signInAs(page, "admin@cpl.example");
  await page.goto(`/briefs?q=${customer}`);
  await page
    .getByLabel("Account Manager")
    .selectOption({ label: "Amara Manager (Account Manager)" });
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByRole("link", { name: customer })).toBeVisible();

  // Dashboard: month-by-month resource table and the per-Account-Manager table.
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Briefs per month/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "By Account Manager" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();

  // Narrowing the dashboard to one person hides the all-team table.
  await page
    .getByLabel("Account Manager")
    .selectOption({ label: "Amara Manager (Account Manager)" });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/Showing briefs for/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "By Account Manager" })).toHaveCount(0);

  // General Manager: dashboard yes, exports no.
  await signInAs(page, "gm@cpl.example");
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Briefs per month/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Export CSV" })).toHaveCount(0);
  await page.goto("/briefs");
  await expect(page.getByLabel("Account Manager")).toBeVisible();
});
