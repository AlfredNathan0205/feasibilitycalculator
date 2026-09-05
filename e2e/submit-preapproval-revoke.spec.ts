import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { signInAs, farFutureDeadline } from "./helpers.js";

/**
 * Journey 3: submit a brief with an inline pre-approval declaration
 * (immediately issuing a code), then follow the actual revoke link — the
 * same one a real nominated manager would receive by email — and confirm
 * the code stops working afterward.
 *
 * The raw revoke token is deliberately never shown in the UI (only its
 * hash is stored; the raw token exists only in the notifications outbox
 * row, standing in for the email that isn't wired up to send yet — see
 * docs/backlog.md). This test reads it from the database directly, the
 * same way the eventual email-sending step would, rather than skipping
 * the hardest part of the journey.
 *
 * Confirmed passing for real — see playwright.config.ts's docstring.
 */
test("submit with pre-approval, then revoke: the Approval Code genuinely stops working", async ({
  page,
}) => {
  const databaseUrl = process.env.DATABASE_URL;
  test.skip(!databaseUrl, "DATABASE_URL must be set to read the revoke token");
  const sql = postgres(databaseUrl!);

  const customerReference = `E2E-PREAPPROVAL-REVOKE-${Date.now()}`;

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

  // Step 2: the per-requirement pre-approval declaration lives here, not
  // on step 1 alongside the fields that determine the requirement exists.
  await page.getByRole("button", { name: "Next: Approvals" }).click();

  // Declare pre-approval inline, per §5 Stage C. Only one requirement
  // (PPD) is raised here, so there's exactly one such block on the page.
  await page.getByLabel("Already approved by a manager").check();
  const managerSelect = page
    .locator("select")
    .filter({ hasText: "Select the manager who approved this" });
  await managerSelect.selectOption({ label: "Priya PPD (PPD Manager, Approver)" });
  await page
    .getByPlaceholder("Comment explaining the circumstances (required)")
    .fill("Confirmed verbally with Priya ahead of submission — e2e test");

  await page.getByRole("button", { name: "Next: Review & submit" }).click();
  await page.getByRole("button", { name: "Submit brief" }).click();

  // Pre-approval satisfies the requirement immediately — code issued now.
  const codeLocator = page.locator("code", {
    hasText: /^FC-\d{4}-[0-9A-Z]{5}-[0-9A-Z]$/,
  });
  await expect(codeLocator).toBeVisible();
  const approvalCode = await codeLocator.textContent();
  expect(approvalCode).toBeTruthy();

  // Read the raw revoke token from the outbox — standing in for the
  // email that would normally deliver it.
  const [notification] = await sql`
    SELECT n.payload
    FROM notifications n
    JOIN briefs b ON b.id = (n.payload->>'briefId')::uuid
    WHERE b.customer_reference = ${customerReference}
      AND n.template = 'pre_approval_declared'
    ORDER BY n.created_at DESC
    LIMIT 1
  `;
  expect(notification).toBeTruthy();
  const rawToken = (notification!.payload as { rawRevokeToken: string }).rawRevokeToken;
  const [requirementRow] = await sql`
    SELECT ar.id
    FROM approval_requirements ar
    JOIN briefs b ON b.id = ar.brief_id
    WHERE b.customer_reference = ${customerReference}
  `;
  const requirementId = requirementRow!.id as string;
  await sql.end();

  // Confirm the code resolves BEFORE revoking (as Admin, per §6's
  // role-based-not-ownership-based audit access).
  await signInAs(page, "admin@cpl.example");
  await page.goto(`/verify/${approvalCode}`);
  await expect(page.getByText(customerReference)).toBeVisible();

  // Follow the actual revoke link — no sign-in required, per Stage C's
  // possession-of-token security model.
  await page.goto(`/revoke/${requirementId}/${encodeURIComponent(rawToken)}`);
  await page.getByRole("button", { name: "Yes, revoke this pre-approval" }).click();
  // Not getByText("Revoked") — that's ambiguous: it also matches the
  // paragraph explaining what happened (contains "revoked" as a
  // substring) and Next.js's hidden route-announcer element. The heading
  // role is what this assertion actually means to check.
  await expect(page.getByRole("heading", { name: "Revoked" })).toBeVisible();

  // The code must genuinely no longer resolve.
  await page.goto(`/verify/${approvalCode}`);
  await expect(page.getByText("no brief with this code exists")).toBeVisible();
});
