import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers";

test("only an Admin can open People and roles; an Admin can add a person, give and end a role", async ({
  page,
}) => {
  await signInAs(page, "am@cpl.example");
  await page.goto("/admin/people");
  await expect(page.getByText("Requires the Admin role")).toBeVisible();
  await expect(page.getByRole("link", { name: "People and roles" })).toHaveCount(0);

  await signInAs(page, "admin@cpl.example");
  await page.goto("/admin/people");
  await page.waitForLoadState("networkidle");
  const email = `e2e-people-${Date.now()}@cpl.example`;
  await page.getByLabel("Name").fill("E2E Person");
  await page.getByLabel(/Work email/).fill(email);
  await page.getByRole("button", { name: "Add person" }).click();

  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toBeVisible();
  await row.getByRole("combobox").selectOption({ label: "Approver" });
  await row.getByRole("button", { name: "Add", exact: true }).click();
  await expect(row.getByText("Approver")).toBeVisible();

  await row.getByRole("button", { name: /End Approver/ }).click();
  await expect(row.getByText("No roles")).toBeVisible();
});
