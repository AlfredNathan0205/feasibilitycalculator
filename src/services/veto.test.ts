import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { createBrief } from "./create-brief.js";
import { decideRequirement, ValidationError } from "./decide-requirement.js";
import { listOpenRequirementsForVeto, reverseVeto, vetoRequirement } from "./veto.js";
import { canVeto, requireCanVeto, AuthorizationError } from "../auth/authz.js";

describe("canVeto (pure)", () => {
  const s = (accessRoles: string[], approvalAuthorityRoles: string[]) => ({
    userId: "u",
    accessRoles,
    approvalAuthorityRoles,
  });
  it("needs the Approver access role AND general_manager", () => {
    expect(canVeto(s(["approver"], ["general_manager"]))).toBe(true);
    expect(canVeto(s([], ["general_manager"]))).toBe(false);
    expect(canVeto(s(["approver"], ["ppd_manager"]))).toBe(false);
    expect(canVeto(s(["admin"], []))).toBe(false);
    expect(() => requireCanVeto(s(["admin"], []))).toThrow(AuthorizationError);
  });
});

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("veto (integration)", () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let submitter: string;
  let gm: string;
  let admin: string;
  const k = `veto${Date.now()}`;

  async function user(key: string) {
    const [u] = await db
      .insert(schema.users)
      .values({
        entraObjectId: `test-${k}-${key}`,
        upn: `${k}-${key}@cpl.example`,
        displayName: `V ${key}`,
        email: `${k}-${key}@cpl.example`,
      })
      .returning();
    return u!.id;
  }

  function submit(ref: string) {
    const deadline = new Date();
    deadline.setUTCDate(deadline.getUTCDate() + 60);
    return createBrief(db, {
      customerReference: `${k}-${ref}`,
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
      deadline,
      submittedBy: submitter,
    });
  }

  const requirementOf = async (briefId: string) =>
    (
      await db
        .select()
        .from(schema.approvalRequirements)
        .where(eq(schema.approvalRequirements.briefId, briefId))
    )[0]!;
  const decisionOf = async (briefId: string) =>
    (
      await db
        .select()
        .from(schema.decisions)
        .where(eq(schema.decisions.briefId, briefId))
    )[0]!;

  beforeAll(async () => {
    sql = postgres(databaseUrl!);
    db = drizzle(sql, { schema });
    submitter = await user("sub");
    gm = await user("gm");
    admin = await user("admin");
  });
  afterAll(async () => {
    await sql.end();
  });

  it("requires a reason", async () => {
    const { briefId } = await submit("reason");
    const r = await requirementOf(briefId);
    await expect(
      vetoRequirement(db, { requirementId: r.id, vetoedBy: gm, reason: "  " }),
    ).rejects.toThrow(/reason is required/);
  });

  it("vetoes an open requirement routed to another role: brief declined, audited, submitter notified", async () => {
    const { briefId } = await submit("a");
    const r = await requirementOf(briefId);
    expect(r.requiredRoleKey).toBe("ppd_manager"); // not the GM's role
    expect(
      (await listOpenRequirementsForVeto(db)).some((x) => x.requirementId === r.id),
    ).toBe(true);

    await vetoRequirement(db, {
      requirementId: r.id,
      vetoedBy: gm,
      reason: "Capacity clash",
    });

    const d = await decisionOf(briefId);
    expect(d.finalStatus).toBe("declined");
    expect(d.vetoedBy).toBe(gm);
    expect(d.vetoReason).toBe("Capacity clash");
    expect(d.approvalCode).toBeNull();
    expect((await requirementOf(briefId)).state).toBe("rejected");
    expect(
      (await listOpenRequirementsForVeto(db)).some((x) => x.requirementId === r.id),
    ).toBe(false);

    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.entityId, briefId),
          eq(schema.auditEvents.action, "brief.vetoed"),
        ),
      );
    expect(audits).toHaveLength(1);
    const notes = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.recipientId, submitter),
          eq(schema.notifications.template, "brief_vetoed"),
        ),
      );
    expect(notes.length).toBeGreaterThan(0);
  });

  it("blocks further decisions and a second veto while the veto stands", async () => {
    const { briefId } = await submit("b");
    const r = await requirementOf(briefId);
    await vetoRequirement(db, { requirementId: r.id, vetoedBy: gm, reason: "No" });
    await expect(
      decideRequirement(db, {
        requirementId: r.id,
        decidedBy: admin,
        decision: "approve",
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      vetoRequirement(db, { requirementId: r.id, vetoedBy: gm, reason: "Again" }),
    ).rejects.toThrow(/open requirement|already been vetoed/);
  });

  it("an Admin reversal reopens the requirement, and it can then be approved normally", async () => {
    const { briefId } = await submit("c");
    const r = await requirementOf(briefId);
    await vetoRequirement(db, { requirementId: r.id, vetoedBy: gm, reason: "Hold" });
    await expect(
      reverseVeto(db, { briefId, reversedBy: admin, reason: " " }),
    ).rejects.toThrow(/reason is required/);

    const out = await reverseVeto(db, {
      briefId,
      reversedBy: admin,
      reason: "Raised in error",
    });
    expect(out.finalStatus).toBe("pending");
    const d = await decisionOf(briefId);
    expect(d.vetoedAt).toBeNull();
    expect(d.vetoReason).toBeNull();
    expect((await requirementOf(briefId)).state).toBe("pending");

    const res = await decideRequirement(db, {
      requirementId: r.id,
      decidedBy: admin,
      decision: "approve",
    });
    expect(res.finalStatus).toBe("approved");
    expect(res.approvalCode).toMatch(/^FC-/);

    await expect(
      reverseVeto(db, { briefId, reversedBy: admin, reason: "x" }),
    ).rejects.toThrow(/no veto to reverse/);
  });
});
