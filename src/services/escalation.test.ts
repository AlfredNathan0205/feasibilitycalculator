import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { createBrief } from "./create-brief.js";
import {
  decideRequirement,
  listEscalatedRequirements,
  listPendingRequirementsForRoles,
} from "./decide-requirement.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const ROLE = "divisional_head_marketing";

function daysFromToday(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
const day = (d: Date) => d.toISOString().slice(0, 10);

describeIfDb("self-approval escalation (integration)", () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let conflictedId: string;
  let otherSubmitterId: string;
  let adminId: string;
  let holderRowId: string;

  // The whole scenario runs in a past window (-500d to -300d) in which the
  // conflicted user is the ONLY holder of the role. Real and seeded role
  // holders are not current then, and the test holder is not current today,
  // so no other test in the shared database is affected.
  const now = daysFromToday(-400);

  async function upsertUser(key: string) {
    const [u] = await db
      .insert(schema.users)
      .values({
        entraObjectId: `test-escalation-${key}`,
        upn: `escalation-${key}@cpl.example`,
        displayName: `Escalation ${key}`,
        email: `escalation-${key}@cpl.example`,
        active: true,
      })
      .onConflictDoUpdate({ target: schema.users.upn, set: { active: true } })
      .returning();
    return u!.id;
  }

  function submit(submittedBy: string, customerReference: string) {
    return createBrief(
      db,
      {
        customerReference,
        tier: "A/T",
        valuePotentialGbp: 200_000,
        newRework: "New",
        briefType: "Exclusive",
        customerApproval: "Direct",
        nicheFfPreApproved: false,
        strategicPriority: false,
        creativeApproach: "Library Only",
        marketingFlag: true, // raises exactly one requirement: marketing_resource
        ppdFlag: false,
        gcmsFlag: false,
        deadline: daysFromToday(60),
        submittedBy,
      },
      now,
    );
  }

  async function theRequirement(briefId: string) {
    const [r] = await db
      .select()
      .from(schema.approvalRequirements)
      .where(eq(schema.approvalRequirements.briefId, briefId));
    return r!;
  }

  beforeAll(async () => {
    sql = postgres(databaseUrl!);
    db = drizzle(sql, { schema });
    conflictedId = await upsertUser("conflicted");
    otherSubmitterId = await upsertUser("other");
    adminId = await upsertUser("admin");
    const [row] = await db
      .insert(schema.roleHolders)
      .values({
        roleKey: ROLE,
        userId: conflictedId,
        effectiveFrom: day(daysFromToday(-500)),
        effectiveTo: day(daysFromToday(-300)),
      })
      .returning();
    holderRowId = row!.id;
  });

  afterAll(async () => {
    await db.delete(schema.roleHolders).where(eq(schema.roleHolders.id, holderRowId));
    await sql.end();
  });

  it("escalates a requirement when its only holder is the submitter, and records it in the audit trail", async () => {
    const result = await submit(conflictedId, "ESCALATION-CONFLICTED");
    expect(result.finalStatus).toBe("pending");

    const req = await theRequirement(result.briefId);
    expect(req.escalatedAt).not.toBeNull();
    expect(req.escalationReason).toMatch(/escalated to an Admin/);

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.entityId, req.id),
          eq(schema.auditEvents.action, "requirement.escalated_to_admin"),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]!.actorId).toBe(conflictedId);
  });

  it("moves it out of the role's queue and into the Admin escalation list", async () => {
    const result = await submit(conflictedId, "ESCALATION-LISTING");
    const req = await theRequirement(result.briefId);

    const roleQueue = await listPendingRequirementsForRoles(db, [ROLE]);
    expect(roleQueue.some((i) => i.requirementId === req.id)).toBe(false);

    const escalated = await listEscalatedRequirements(db);
    expect(escalated.some((i) => i.requirementId === req.id)).toBe(true);
  });

  it("does not escalate when the submitter is not the role's holder", async () => {
    const result = await submit(otherSubmitterId, "ESCALATION-NOT-CONFLICTED");
    const req = await theRequirement(result.briefId);
    expect(req.escalatedAt).toBeNull();
    expect(req.escalationReason).toBeNull();
  });

  it("completes normally once an Admin approves it: the brief is approved and the code issues", async () => {
    const result = await submit(conflictedId, "ESCALATION-APPROVED");
    const req = await theRequirement(result.briefId);

    const decided = await decideRequirement(db, {
      requirementId: req.id,
      decidedBy: adminId,
      decision: "approve",
      comment: null,
    });
    expect(decided.finalStatus).toBe("approved");
    expect(decided.approvalCode).toMatch(/^FC-/);
  });
});
