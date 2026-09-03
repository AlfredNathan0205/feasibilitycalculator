/**
 * Integration test for createBrief — runs against a REAL local Postgres,
 * not a mock, because this function's whole job is transactional
 * correctness across 4 tables plus Approval Code issuance timing, which a
 * mocked DB can't meaningfully verify.
 *
 * Requires DATABASE_URL to point at a Postgres instance with migrations +
 * the v1 rule set seed already applied (see README "Running it yourself").
 * Skips itself gracefully if DATABASE_URL isn't set, so `npm test` doesn't
 * fail in environments without a running Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { createBrief, ValidationError } from "./create-brief.js";
import { verifyApprovalCode } from "../engine/approval-code.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("createBrief (integration)", () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let testUserId: string;

  beforeAll(async () => {
    sql = postgres(databaseUrl!);
    db = drizzle(sql, { schema });

    const [user] = await db
      .insert(schema.users)
      .values({
        entraObjectId: "test-create-brief-user",
        upn: "create-brief-test@cpl.example",
        displayName: "Create Brief Test User",
        email: "create-brief-test@cpl.example",
        active: true,
      })
      .onConflictDoUpdate({
        target: schema.users.upn,
        set: { active: true },
      })
      .returning();
    testUserId = user!.id;
  });

  afterAll(async () => {
    await sql.end();
  });

  function baseInput(overrides: Partial<Parameters<typeof createBrief>[1]> = {}) {
    const farFuture = new Date();
    farFuture.setUTCDate(farFuture.getUTCDate() + 60);
    return {
      customerReference: "TEST-CUSTOMER",
      tier: "A/T",
      valuePotentialGbp: 0,
      newRework: "Rework (Of Selling)", // auto-approves regardless of score
      briefType: "Competitive",
      customerApproval: "Deferred/Unknown",
      nicheFfPreApproved: false,
      strategicPriority: false,
      creativeApproach: "Library Only", // avoids the creative_creation/starting_point requirements
      marketingFlag: false,
      ppdFlag: false,
      gcmsFlag: false,
      deadline: farFuture,
      submittedBy: testUserId,
      ...overrides,
    };
  }

  it("issues an Approval Code immediately for a brief with zero required approvals", async () => {
    const result = await createBrief(db, baseInput());

    expect(result.commercialDecision).toBe("auto_approved");
    expect(result.finalStatus).toBe("approved");
    expect(result.requirementCount).toBe(0);
    expect(result.approvalCode).not.toBeNull();
    expect(verifyApprovalCode(result.approvalCode!).valid).toBe(true);

    const [decisionRow] = await db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.id, result.decisionId));
    expect(decisionRow!.approvalCode).toBe(result.approvalCode);
    expect(decisionRow!.codeIssuedAt).not.toBeNull();
  });

  it("does NOT issue a code when auto-approved but resource sign-off is outstanding — the central §5 rule", async () => {
    const result = await createBrief(
      db,
      baseInput({ marketingFlag: true }), // always raises a requirement (§11 item 2)
    );

    expect(result.commercialDecision).toBe("auto_approved");
    expect(result.finalStatus).toBe("pending"); // NOT "approved" despite auto_approved commercial decision
    expect(result.requirementCount).toBe(1);
    expect(result.approvalCode).toBeNull();

    const requirementRows = await db
      .select()
      .from(schema.approvalRequirements)
      .where(eq(schema.approvalRequirements.decisionId, result.decisionId));
    expect(requirementRows).toHaveLength(1);
    expect(requirementRows[0]!.requirementType).toBe("marketing_resource");
    expect(requirementRows[0]!.requiredRoleKey).toBe("divisional_head_marketing");
    expect(requirementRows[0]!.state).toBe("pending");
  });

  it("declined always wins outright, even when a requirement is also pending — proves Stage D's precedence order", async () => {
    // Tier D (10) + Creation/Unknown creative (0) + zero value potential
    // (zeroes every value-derived component) = score 10, which declines.
    // Creation/Unknown on a non-A/T tier ALSO raises the creative_creation
    // requirement (§5) — so this brief has both a decline-level score AND
    // an outstanding requirement at the same time. Stage D must resolve
    // this as "declined", not "pending", because the decline check is
    // unconditional and checked first, regardless of what Stage B found.
    const result = await createBrief(
      db,
      baseInput({
        tier: "D",
        newRework: "Rework (Non-Selling)",
        briefType: "ProActive",
        customerApproval: "Deferred/Unknown",
        creativeApproach: "Creation/Unknown",
        valuePotentialGbp: 0,
      }),
    );

    expect(result.score).toBe(10);
    expect(result.commercialDecision).toBe("declined");
    expect(result.requirementCount).toBeGreaterThan(0); // the requirement genuinely exists...
    expect(result.finalStatus).toBe("declined"); // ...but declined wins outright anyway
    expect(result.approvalCode).toBeNull();
  });

  it("rejects a deadline that is today or earlier with a ValidationError", async () => {
    const today = new Date();
    await expect(
      createBrief(db, baseInput({ deadline: today })),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects niche/FF pre-approval without a rationale", async () => {
    await expect(
      createBrief(
        db,
        baseInput({ nicheFfPreApproved: true, nicheFfRationale: null }),
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects strategic priority without a rationale", async () => {
    await expect(
      createBrief(
        db,
        baseInput({ strategicPriority: true, strategicPriorityRationale: null }),
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("records an audit_events row on submission", async () => {
    const result = await createBrief(db, baseInput());
    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, result.briefId));
    expect(events).toHaveLength(1);
    expect(events[0]!.action).toBe("brief.submitted");
  });

  it("two briefs submitted back-to-back get different Approval Codes (no accidental reuse)", async () => {
    const r1 = await createBrief(db, baseInput());
    const r2 = await createBrief(db, baseInput());
    expect(r1.approvalCode).not.toBe(r2.approvalCode);
  });
});
