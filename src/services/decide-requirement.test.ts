import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { createBrief } from "./create-brief.js";
import {
  decideRequirement,
  decideRequirementsBulk,
  listPendingRequirementsForRoles,
  ValidationError,
  NotFoundError,
} from "./decide-requirement.js";
import { verifyApprovalCode } from "../engine/approval-code.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("decideRequirement (integration)", () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let submitterId: string;
  let ppdApproverId: string;

  beforeAll(async () => {
    sql = postgres(databaseUrl!);
    db = drizzle(sql, { schema });

    const [submitter] = await db
      .insert(schema.users)
      .values({
        entraObjectId: "test-decide-requirement-submitter",
        upn: "decide-req-submitter@cpl.example",
        displayName: "Decide-Requirement Test Submitter",
        email: "decide-req-submitter@cpl.example",
        active: true,
      })
      .onConflictDoUpdate({ target: schema.users.upn, set: { active: true } })
      .returning();
    submitterId = submitter!.id;

    const [approver] = await db
      .insert(schema.users)
      .values({
        entraObjectId: "test-decide-requirement-approver",
        upn: "decide-req-approver@cpl.example",
        displayName: "Decide-Requirement Test PPD Approver",
        email: "decide-req-approver@cpl.example",
        active: true,
      })
      .onConflictDoUpdate({ target: schema.users.upn, set: { active: true } })
      .returning();
    ppdApproverId = approver!.id;
  });

  afterAll(async () => {
    await sql.end();
  });

  function farFutureDate(days = 60) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  async function submitBriefWithPpdRequirement() {
    return createBrief(db, {
      customerReference: "DECIDE-REQ-TEST",
      tier: "A/T",
      valuePotentialGbp: 200_000,
      newRework: "New",
      briefType: "Exclusive",
      customerApproval: "Direct",
      nicheFfPreApproved: false,
      strategicPriority: false,
      creativeApproach: "Library Only",
      marketingFlag: false,
      ppdFlag: true, // raises exactly one requirement: ppd_resource
      gcmsFlag: false,
      deadline: farFutureDate(),
      submittedBy: submitterId,
    });
  }

  async function getTheOneRequirement(decisionId: string) {
    const rows = await db
      .select()
      .from(schema.approvalRequirements)
      .where(eq(schema.approvalRequirements.decisionId, decisionId));
    return rows[0]!;
  }

  it("approving the last outstanding requirement issues the Approval Code at that point, not before", async () => {
    const submission = await submitBriefWithPpdRequirement();
    expect(submission.finalStatus).toBe("pending");
    expect(submission.approvalCode).toBeNull();

    const requirement = await getTheOneRequirement(submission.decisionId);
    expect(requirement.state).toBe("pending");

    const result = await decideRequirement(db, {
      requirementId: requirement.id,
      decidedBy: ppdApproverId,
      decision: "approve",
    });

    expect(result.requirementState).toBe("approved");
    expect(result.finalStatus).toBe("approved");
    expect(result.codeJustIssued).toBe(true);
    expect(result.approvalCode).not.toBeNull();
    expect(verifyApprovalCode(result.approvalCode!).valid).toBe(true);

    const [decisionRow] = await db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.id, submission.decisionId));
    expect(decisionRow!.finalStatus).toBe("approved");
    expect(decisionRow!.approvalCode).toBe(result.approvalCode);
  });

  it("rejecting a requirement leaves the brief pending forever (no auto-decline), with the rejection comment recorded", async () => {
    const submission = await submitBriefWithPpdRequirement();
    const requirement = await getTheOneRequirement(submission.decisionId);

    const result = await decideRequirement(db, {
      requirementId: requirement.id,
      decidedBy: ppdApproverId,
      decision: "reject",
      comment: "Insufficient PPD capacity this quarter",
    });

    expect(result.requirementState).toBe("rejected");
    expect(result.finalStatus).toBe("pending"); // stuck, not auto-declined
    expect(result.approvalCode).toBeNull();
    expect(result.codeJustIssued).toBe(false);

    const [requirementRow] = await db
      .select()
      .from(schema.approvalRequirements)
      .where(eq(schema.approvalRequirements.id, requirement.id));
    expect(requirementRow!.comment).toBe("Insufficient PPD capacity this quarter");
  });

  it("rejecting without a comment throws ValidationError (mirrors the DB CHECK constraint)", async () => {
    const submission = await submitBriefWithPpdRequirement();
    const requirement = await getTheOneRequirement(submission.decisionId);

    await expect(
      decideRequirement(db, {
        requirementId: requirement.id,
        decidedBy: ppdApproverId,
        decision: "reject",
        comment: "   ", // whitespace only
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("deciding an already-decided requirement throws ValidationError, not a silent no-op", async () => {
    const submission = await submitBriefWithPpdRequirement();
    const requirement = await getTheOneRequirement(submission.decisionId);

    await decideRequirement(db, {
      requirementId: requirement.id,
      decidedBy: ppdApproverId,
      decision: "approve",
    });

    await expect(
      decideRequirement(db, {
        requirementId: requirement.id,
        decidedBy: ppdApproverId,
        decision: "approve",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("throws NotFoundError for a nonexistent requirement id", async () => {
    await expect(
      decideRequirement(db, {
        requirementId: "00000000-0000-0000-0000-000000000000",
        decidedBy: ppdApproverId,
        decision: "approve",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("a brief with two requirements only issues the code once BOTH are approved", async () => {
    const submission = await createBrief(db, {
      customerReference: "DECIDE-REQ-TWO-REQS",
      tier: "A/T",
      valuePotentialGbp: 200_000,
      newRework: "New",
      briefType: "Exclusive",
      customerApproval: "Direct",
      nicheFfPreApproved: false,
      strategicPriority: false,
      creativeApproach: "Library Only",
      marketingFlag: true,
      ppdFlag: true,
      gcmsFlag: false,
      deadline: farFutureDate(),
      submittedBy: submitterId,
    });
    expect(submission.requirementCount).toBe(2);

    const requirements = await db
      .select()
      .from(schema.approvalRequirements)
      .where(eq(schema.approvalRequirements.decisionId, submission.decisionId));
    expect(requirements).toHaveLength(2);

    const first = await decideRequirement(db, {
      requirementId: requirements[0]!.id,
      decidedBy: ppdApproverId,
      decision: "approve",
    });
    expect(first.finalStatus).toBe("pending");
    expect(first.approvalCode).toBeNull();

    const second = await decideRequirement(db, {
      requirementId: requirements[1]!.id,
      decidedBy: ppdApproverId,
      decision: "approve",
    });
    expect(second.finalStatus).toBe("approved");
    expect(second.codeJustIssued).toBe(true);
    expect(second.approvalCode).not.toBeNull();
  });

  it("listPendingRequirementsForRoles finds requirements for the given roles and no others", async () => {
    const submission = await submitBriefWithPpdRequirement();
    const items = await listPendingRequirementsForRoles(db, ["ppd_manager"]);
    expect(items.some((i) => i.decisionId === submission.decisionId)).toBe(true);

    const noneForOtherRole = await listPendingRequirementsForRoles(db, [
      "analytical_manager",
    ]);
    expect(noneForOtherRole.some((i) => i.decisionId === submission.decisionId)).toBe(
      false,
    );
  });

  it("returns an empty array for an empty role list without querying", async () => {
    const items = await listPendingRequirementsForRoles(db, []);
    expect(items).toEqual([]);
  });

  describe("decideRequirementsBulk", () => {
    it("approves multiple independent requirements from separate briefs in one call", async () => {
      const a = await submitBriefWithPpdRequirement();
      const b = await submitBriefWithPpdRequirement();
      const reqA = await getTheOneRequirement(a.decisionId);
      const reqB = await getTheOneRequirement(b.decisionId);

      const result = await decideRequirementsBulk(db, {
        requirementIds: [reqA.id, reqB.id],
        decidedBy: ppdApproverId,
      });

      expect(result.failed).toEqual([]);
      expect(result.succeeded).toHaveLength(2);
      expect(result.succeeded.every((r) => r.codeJustIssued)).toBe(true);
      expect(result.succeeded.every((r) => r.approvalCode !== null)).toBe(true);

      const [decisionA] = await db
        .select()
        .from(schema.decisions)
        .where(eq(schema.decisions.id, a.decisionId));
      expect(decisionA!.finalStatus).toBe("approved");
    });

    it("one already-decided requirement in the batch fails independently without blocking the rest", async () => {
      const a = await submitBriefWithPpdRequirement();
      const b = await submitBriefWithPpdRequirement();
      const reqA = await getTheOneRequirement(a.decisionId);
      const reqB = await getTheOneRequirement(b.decisionId);

      // Decide reqA ahead of time, outside the batch — simulating another
      // approver having just actioned it a moment earlier.
      await decideRequirement(db, {
        requirementId: reqA.id,
        decidedBy: ppdApproverId,
        decision: "reject",
        comment: "already handled by someone else",
      });

      const result = await decideRequirementsBulk(db, {
        requirementIds: [reqA.id, reqB.id],
        decidedBy: ppdApproverId,
      });

      expect(result.succeeded).toHaveLength(1);
      expect(result.succeeded[0]!.requirementId).toBe(reqB.id);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]!.requirementId).toBe(reqA.id);
      expect(result.failed[0]!.error).toMatch(/already "rejected"/);
    });

    it("an empty id list succeeds trivially with nothing decided", async () => {
      const result = await decideRequirementsBulk(db, {
        requirementIds: [],
        decidedBy: ppdApproverId,
      });
      expect(result).toEqual({ succeeded: [], failed: [] });
    });
  });
});
