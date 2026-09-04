import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema.js";
import { createBrief } from "../create-brief.js";
import { revokeRequirement } from "../decide-requirement.js";
import {
  dispatchQueuedNotifications,
  type EmailMessage,
} from "./dispatch-notifications.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("dispatchQueuedNotifications (integration)", () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let submitterId: string;
  let ppdManagerId: string;
  let ppdManagerEmail: string;

  beforeAll(async () => {
    sql = postgres(databaseUrl!);
    db = drizzle(sql, { schema });

    async function upsertUser(upn: string, displayName: string) {
      const [user] = await db
        .insert(schema.users)
        .values({
          entraObjectId: `test-dispatch-${upn}`,
          upn,
          displayName,
          email: upn,
          active: true,
        })
        .onConflictDoUpdate({ target: schema.users.upn, set: { active: true } })
        .returning();
      return user!;
    }

    const submitter = await upsertUser(
      "dispatch-submitter@cpl.example",
      "Dispatch Test Submitter",
    );
    submitterId = submitter.id;
    const ppdManager = await upsertUser(
      "dispatch-ppd@cpl.example",
      "Dispatch Test PPD Manager",
    );
    ppdManagerId = ppdManager.id;
    ppdManagerEmail = ppdManager.email;

    const existing = await db
      .select()
      .from(schema.roleHolders)
      .where(eq(schema.roleHolders.userId, ppdManagerId));
    if (existing.length === 0) {
      await db.insert(schema.roleHolders).values({
        roleKey: "ppd_manager",
        userId: ppdManagerId,
        effectiveFrom: new Date().toISOString().slice(0, 10),
      });
    }
  });

  afterAll(async () => {
    await sql.end();
  });

  function farFutureDate(days = 60) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  function baseInput(overrides: Partial<Parameters<typeof createBrief>[1]> = {}) {
    return {
      customerReference: `DISPATCH-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      tier: "A/T",
      valuePotentialGbp: 200_000,
      newRework: "New",
      briefType: "Exclusive",
      customerApproval: "Direct",
      nicheFfPreApproved: false,
      strategicPriority: false,
      creativeApproach: "Library Only",
      marketingFlag: false,
      ppdFlag: true,
      gcmsFlag: false,
      deadline: farFutureDate(),
      submittedBy: submitterId,
      ...overrides,
    };
  }

  async function getRawRevokeToken(briefId: string) {
    const notifications = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.template, "pre_approval_declared"));
    const match = notifications.find(
      (n) => (n.payload as Record<string, unknown>)?.briefId === briefId,
    );
    return (match!.payload as Record<string, unknown>).rawRevokeToken as string;
  }

  it("sends a queued pre_approval_declared notification and marks it sent", async () => {
    const customerReference = `DISPATCH-DECLARED-${Date.now()}`;
    await createBrief(
      db,
      baseInput({
        customerReference,
        preApprovals: {
          ppd_resource: { nominatedManagerId: ppdManagerId, comment: "Cleared verbally" },
        },
      }),
    );

    const sentMessages: EmailMessage[] = [];
    const sendEmail = vi.fn(async (message: EmailMessage) => {
      sentMessages.push(message);
    });

    const dispatchResult = await dispatchQueuedNotifications(db, sendEmail, {
      appBaseUrl: "https://feasibilitycalculator.example.com",
    });

    expect(dispatchResult.attempted).toBeGreaterThanOrEqual(1);
    expect(dispatchResult.failed).toBe(0);

    const match = sentMessages.find((m) => m.subject.includes(customerReference));
    expect(match).toBeDefined();
    expect(match!.to).toBe(ppdManagerEmail);
    expect(match!.html).toContain("/revoke/");

    // Confirm the row itself, not just the callback, was updated — the
    // callback firing doesn't prove the DB write happened.
    const relevantRow = (
      await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.recipientId, ppdManagerId))
    ).find(
      (n) =>
        (n.payload as Record<string, unknown>)?.customerReference === customerReference,
    );
    expect(relevantRow!.deliveryStatus).toBe("sent");
    expect(relevantRow!.sentAt).not.toBeNull();

    // Re-running dispatch must NOT re-send an already-sent notification —
    // the outer query only selects delivery_status = 'queued'.
    sentMessages.length = 0;
    await dispatchQueuedNotifications(db, sendEmail, {
      appBaseUrl: "https://feasibilitycalculator.example.com",
    });
    expect(
      sentMessages.find((m) => m.subject.includes(customerReference)),
    ).toBeUndefined();
  });

  it("sends a queued pre_approval_revoked notification to the submitter after a real revoke", async () => {
    const customerReference = `DISPATCH-REVOKED-${Date.now()}`;
    const submission = await createBrief(
      db,
      baseInput({
        customerReference,
        preApprovals: {
          ppd_resource: { nominatedManagerId: ppdManagerId, comment: "Cleared verbally" },
        },
      }),
    );
    const [requirement] = await db
      .select()
      .from(schema.approvalRequirements)
      .where(eq(schema.approvalRequirements.decisionId, submission.decisionId));
    const rawToken = await getRawRevokeToken(submission.briefId);

    await revokeRequirement(db, { requirementId: requirement!.id, rawToken });

    const sentMessages: EmailMessage[] = [];
    const sendEmail = vi.fn(async (message: EmailMessage) => {
      sentMessages.push(message);
    });

    await dispatchQueuedNotifications(db, sendEmail, {
      appBaseUrl: "https://feasibilitycalculator.example.com",
    });

    const [submitterRow] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, submitterId));

    const match = sentMessages.find(
      (m) =>
        m.subject.startsWith("Pre-approval revoked") &&
        m.subject.includes(customerReference),
    );
    expect(match).toBeDefined();
    expect(match!.to).toBe(submitterRow!.email);
    expect(match!.text.toLowerCase()).toContain("revoked");
  });

  it("marks a notification failed (not sent, and not silently dropped) when the send callback throws", async () => {
    const customerReference = `DISPATCH-FAIL-${Date.now()}`;
    await createBrief(
      db,
      baseInput({
        customerReference,
        preApprovals: {
          ppd_resource: { nominatedManagerId: ppdManagerId, comment: "Cleared verbally" },
        },
      }),
    );

    const sendEmail = vi.fn(async (message: EmailMessage) => {
      if (message.subject.includes(customerReference)) {
        throw new Error("simulated provider outage");
      }
    });

    const dispatchResult = await dispatchQueuedNotifications(db, sendEmail, {
      appBaseUrl: "https://feasibilitycalculator.example.com",
    });

    expect(dispatchResult.failed).toBeGreaterThanOrEqual(1);
    expect(
      dispatchResult.failures.some((f) => f.error.includes("simulated provider outage")),
    ).toBe(true);

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.recipientId, ppdManagerId));
    const failedRow = rows.find(
      (n) =>
        (n.payload as Record<string, unknown>)?.customerReference === customerReference,
    );
    expect(failedRow!.deliveryStatus).toBe("failed");
    expect(failedRow!.sentAt).toBeNull();

    // A failed notification is not automatically retried on the next run —
    // it stays "failed", not "queued", so it won't be picked up again
    // without a deliberate retry mechanism (not built yet; see backlog).
    await dispatchQueuedNotifications(
      db,
      vi.fn(async () => {}),
      {
        appBaseUrl: "https://feasibilitycalculator.example.com",
      },
    );
    const stillFailed = (
      await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.recipientId, ppdManagerId))
    ).find(
      (n) =>
        (n.payload as Record<string, unknown>)?.customerReference === customerReference,
    );
    expect(stillFailed!.deliveryStatus).toBe("failed");
  });

  it("respects batchSize, leaving remaining queued notifications untouched for the next run", async () => {
    const refA = `DISPATCH-BATCH-A-${Date.now()}`;
    const refB = `DISPATCH-BATCH-B-${Date.now()}`;
    await createBrief(
      db,
      baseInput({
        customerReference: refA,
        preApprovals: {
          ppd_resource: { nominatedManagerId: ppdManagerId, comment: "x" },
        },
      }),
    );
    await createBrief(
      db,
      baseInput({
        customerReference: refB,
        preApprovals: {
          ppd_resource: { nominatedManagerId: ppdManagerId, comment: "x" },
        },
      }),
    );

    const sendEmail = vi.fn(async () => {});
    const result = await dispatchQueuedNotifications(db, sendEmail, {
      appBaseUrl: "https://example.com",
      batchSize: 1,
    });
    expect(result.attempted).toBe(1);

    // Clean up: send the rest so this test doesn't leak a permanently
    // queued row that later tests' broader queries might trip over.
    await dispatchQueuedNotifications(db, sendEmail, {
      appBaseUrl: "https://example.com",
    });
  });
});
