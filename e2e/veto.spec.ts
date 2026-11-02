import { expect, test } from "@playwright/test";
import { farFutureDeadline, signInAs } from "./helpers";

test("the General Manager can veto a brief routed to another role; an Admin can reverse it", async ({
  page,
}) => {
  const customer = `E2E-VETO-${Date.now()}`;
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
      ppdFlag: true, // routed to the PPD Manager, not the General Manager
      gcmsFlag: false,
      deadline: farFutureDeadline(),
    },
  });
  expect(res.ok()).toBeTruthy();
  const { briefId } = await res.json();

  // Someone without veto authority doesn't get the veto section.
  await signInAs(page, "ppd@cpl.example");
  await page.goto("/approvals");
  await expect(page.getByRole("heading", { name: /^Veto/ })).toHaveCount(0);

  await signInAs(page, "gm@cpl.example");
  await page.goto("/approvals");
  const card = page.locator(".ticket").filter({ hasText: customer });
  await card.getByLabel(/Reason to veto/).fill("Capacity clash with a launch");
  await card.getByRole("button", { name: "Veto" }).click();
  await expect(card).toHaveCount(0);

  await page.goto(`/briefs/${briefId}`);
  await expect(page.getByText("Vetoed by the General Manager")).toBeVisible();
  await expect(
    page.getByRole("alert").getByText(/Capacity clash with a launch/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Reverse veto" })).toHaveCount(0);

  await signInAs(page, "admin@cpl.example");
  await page.goto(`/briefs/${briefId}`);
  await page.getByPlaceholder(/Reason for reversing/).fill("Raised in error");
  await page.getByRole("button", { name: "Reverse veto" }).click();
  await expect(page.getByText("Vetoed by the General Manager")).toHaveCount(0);
});
