import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { createBrief, ValidationError } from "./create-brief.js";
import {
  revokeRequirement,
  decideRequirement,
  listPendingRequirementsForRoles,
  NotFoundError,
} from "./decide-requirement.js";
import { verifyApprovalCode } from "../engine/approval-code.js";
import { generateRevokeToken } from "../engine/revoke-token.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("Stage C: pre-approval declaration + revoke (integration)", () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let submitterId: string;
  let ppdManagerId: string;
  let wrongRoleUserId: string;

  beforeAll(async () => {
    sql = postgres(databaseUrl!);
    db = drizzle(sql, { schema });

    async function upsertUser(upn: string, displayName: string) {
      const [user] = await db
        .insert(schema.users)
        .values({
          entraObjectId: `test-stage-c-${upn}`,
          upn,
          displayName,
          email: upn,
          active: true,
        })
        .onConflictDoUpdate({ target: schema.users.upn, set: { active: true } })
        .returning();
      return user!.id;
    }

    submitterId = await upsertUser("stage-c-submitter@cpl.example", "Stage C Submitter");
    ppdManagerId = await upsertUser("stage-c-ppd@cpl.example", "Stage C PPD Manager");
    wrongRoleUserId = await upsertUser("stage-c-wrong-role@cpl.example", "Stage C Wrong Role User");

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
      customerReference: "STAGE-C-TEST",
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

  it("a pre-approval declaration at submission satisfies the requirement immediately and issues the code", async () => {
    const result = await createBrief(
      db,
      baseInput({
        preApprovals: {
          ppd_resource: {
            nominatedManagerId: ppdManagerId,
            comment: "Pre-cleared with PPD in Monday's planning call",
          },
        },
      }),
    );

    expect(result.finalStatus).toBe("approved");
    expect(result.approvalCode).not.toBeNull();
    expect(verifyApprovalCode(result.approvalCode!).valid).toBe(true);

    const [requirement] = await db
      .select()
      .from(schema.approvalRequirements)
      .where(eq(schema.approvalRequirements.decisionId, result.decisionId));
    expect(requirement!.state).toBe("pre_approved");
    expect(requirement!.preApprovalNominatedManagerId).toBe(ppdManagerId);
    expect(requirement!.preApprovalSubmitterComment).toContain("Monday's planning call");
    expect(requirement!.revokeTokenHash).not.toBeNull();
    expect(requirement!.revokeWindowExpiresAt).not.toBeNull();
  });

  it("queues a notification to the nominated manager with the raw revoke token (outbox pattern)", async () => {
    const result = await createBrief(
      db,
      baseInput({
        preApprovals: {
          ppd_resource: { nominatedManagerId: ppdManagerId, comment: "Cleared verbally" },
        },
      }),
    );
    const notifications = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.recipientId, ppdManagerId));
    const match = notifications.find(
      (n) => (n.payload as any)?.briefId === result.briefId,
    );
    expect(match).toBeDefined();
    expect(match!.template).toBe("pre_approval_declared");
    expect(typeof (match!.payload as any).rawRevokeToken).toBe("string");
  });

  it("rejects a pre-approval declaration when the nominated manager doesn't currently hold the required role", async () => {
    await expect(
      createBrief(
        db,
        baseInput({
          preApprovals: {
            ppd_resource: { nominatedManagerId: wrongRoleUserId, comment: "Trust me" },
          },
        }),
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a pre-approval declaration missing a comment", async () => {
    await expect(
      createBrief(
        db,
        baseInput({
          preApprovals: {
            ppd_resource: { nominatedManagerId: ppdManagerId, comment: "  " },
          },
        }),
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("a pre-approval for a requirement type that wasn't actually raised is a silent no-op, not an error", async () => {
    const result = await createBrief(
      db,
      baseInput({
        ppdFlag: false,
        preApprovals: {
          ppd_resource: { nominatedManagerId: ppdManagerId, comment: "Doesn't matter" },
        },
      }),
    );
    expect(result.requirementCount).toBe(0);
    expect(result.finalStatus).toBe("approved");
  });

  describe("revoke path", () => {
    async function submitPreApprovedBrief() {
      return createBrief(
        db,
        baseInput({
          preApprovals: {
            ppd_resource: { nominatedManagerId: ppdManagerId, comment: "Cleared verbally" },
          },
        }),
      );
    }

    async function getTheRequirementAndRawToken(decisionId: string) {
      const [requirement] = await db
        .select()
        .from(schema.approvalRequirements)
        .where(eq(schema.approvalRequirements.decisionId, decisionId));
      const notifications = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.template, "pre_approval_declared"));
      const match = notifications
        .filter((n) => (n.payload as any)?.briefId === requirement!.briefId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      return { requirement: requirement!, rawToken: (match!.payload as any).rawRevokeToken as string };
    }

    it("revoking strips the Approval Code and returns the brief to pending", async () => {
      const submission = await submitPreApprovedBrief();
      expect(submission.finalStatus).toBe("approved");
      expect(submission.approvalCode).not.toBeNull();

      const { requirement, rawToken } = await getTheRequirementAndRawToken(
        submission.decisionId,
      );

      const result = await revokeRequirement(db, {
        requirementId: requirement.id,
        rawToken,
      });

      expect(result.finalStatus).toBe("pending");
      expect(result.approvalCode).toBeNull();

      const [decisionRow] = await db
        .select()
        .from(schema.decisions)
        .where(eq(schema.decisions.id, submission.decisionId));
      expect(decisionRow!.finalStatus).toBe("pending");
      expect(decisionRow!.approvalCode).toBeNull();
      expect(decisionRow!.codeIssuedAt).toBeNull();

      const [requirementRow] = await db
        .select()
        .from(schema.approvalRequirements)
        .where(eq(schema.approvalRequirements.id, requirement.id));
      expect(requirementRow!.state).toBe("revoked");
      expect(requirementRow!.revokeTokenHash).toBeNull();
    });

    it("the previously-issued Approval Code no longer verifies against any brief after revocation", async () => {
      const submission = await submitPreApprovedBrief();
      const issuedCode = submission.approvalCode!;
      const { requirement, rawToken } = await getTheRequirementAndRawToken(
        submission.decisionId,
      );
      await revokeRequirement(db, { requirementId: requirement.id, rawToken });

      const [stillThere] = await db
        .select()
        .from(schema.decisions)
        .where(eq(schema.decisions.approvalCode, issuedCode));
      expect(stillThere).toBeUndefined();
    });

    it("the token is single-use: a second revoke attempt with the same token fails", async () => {
      const submission = await submitPreApprovedBrief();
      const { requirement, rawToken } = await getTheRequirementAndRawToken(
        submission.decisionId,
      );
      await revokeRequirement(db, { requirementId: requirement.id, rawToken });

      await expect(
        revokeRequirement(db, { requirementId: requirement.id, rawToken }),
      ).rejects.toThrow();
    });

    it("rejects a wrong token", async () => {
      const submission = await submitPreApprovedBrief();
      const { requirement } = await getTheRequirementAndRawToken(submission.decisionId);
      const wrongToken = generateRevokeToken().rawToken;

      await expect(
        revokeRequirement(db, { requirementId: requirement.id, rawToken: wrongToken }),
      ).rejects.toThrow();
    });

    it("throws NotFoundError for a nonexistent requirement id", async () => {
      await expect(
        revokeRequirement(db, {
          requirementId: "00000000-0000-0000-0000-000000000000",
          rawToken: "irrelevant",
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("queues a notification to the submitter on revoke", async () => {
      const submission = await submitPreApprovedBrief();
      const { requirement, rawToken } = await getTheRequirementAndRawToken(
        submission.decisionId,
      );
      await revokeRequirement(db, { requirementId: requirement.id, rawToken });

      const notifications = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.recipientId, submitterId));
      const match = notifications.find(
        (n) =>
          n.template === "pre_approval_revoked" &&
          (n.payload as any)?.requirementId === requirement.id,
      );
      expect(match).toBeDefined();
    });

    it("a revoked requirement is actionable again — approving it after revoke clears the brief (regression: this was previously impossible, and invisible in the approver queue)", async () => {
      const submission = await submitPreApprovedBrief();
      const { requirement, rawToken } = await getTheRequirementAndRawToken(
        submission.decisionId,
      );
      await revokeRequirement(db, { requirementId: requirement.id, rawToken });

      const [afterRevoke] = await db
        .select()
        .from(schema.approvalRequirements)
        .where(eq(schema.approvalRequirements.id, requirement.id));
      expect(afterRevoke!.state).toBe("revoked");

      // It must show up in the approver queue for ppd_manager...
      const queue = await listPendingRequirementsForRoles(db, ["ppd_manager"]);
      expect(queue.some((q) => q.requirementId === requirement.id)).toBe(true);

      // ...and it must be decidable, not permanently stuck.
      const decided = await decideRequirement(db, {
        requirementId: requirement.id,
        decidedBy: ppdManagerId,
        decision: "approve",
      });
      expect(decided.requirementState).toBe("approved");
      expect(decided.finalStatus).toBe("approved");
      expect(decided.approvalCode).not.toBeNull();
    });
  });
});
