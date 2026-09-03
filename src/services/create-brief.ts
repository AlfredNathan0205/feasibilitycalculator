/**
 * createBrief — orchestrates §5's full submission flow: Stage A (commercial
 * decision) + Stage B (required approvals) via the pure engine, then Stage D
 * (final status + Approval Code issuance) based on what Stage B produced.
 *
 * This is intentionally NOT a pure function — it's the one place that talks
 * to the database, wrapping everything in a single transaction so a brief
 * is never left half-written (decision without requirements, etc).
 *
 * Authorization is NOT checked in here — callers (the API route) must call
 * requireAccessRole(session, "account_manager"|"sales_coordinator") before
 * invoking this, per "all server-side data access must go through a single
 * authorisation layer" (§2). This function trusts its caller already did
 * that; it only handles the business logic and persistence.
 */

import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import { computeStageA, computeStageB } from "../engine/decision.js";
import type { RuleSetPayload } from "../engine/scoring.js";
import { issueUniqueApprovalCode } from "./issue-approval-code.js";

export interface BriefSubmissionInput {
  customerReference: string;
  tier: string;
  valuePotentialGbp: number;
  newRework: string;
  briefType: string;
  customerApproval: string;
  nicheFfPreApproved: boolean;
  nicheFfRationale?: string | null;
  strategicPriority: boolean;
  strategicPriorityRationale?: string | null;
  creativeApproach: string;
  marketingFlag: boolean;
  ppdFlag: boolean;
  gcmsFlag: boolean;
  /** A real calendar date, not a day-count — the engine derives
   * daysUntilDeadline from this and `submittedAt` itself, so the caller
   * doesn't have to get that arithmetic right twice. */
  deadline: Date;
  pvReference?: string | null;
  submittedBy: string;
  onBehalfOf?: string | null;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Friendly, pre-DB validation for the two things the spec calls out
 * explicitly as form-level errors, not silent defects (§5: "a deadline on
 * or before today is a validation error, not a requirement... reject it at
 * the form with 'check this date'"; §8: rationale mandatory whenever its
 * trigger flag is set). The database CHECK constraints back these up
 * regardless — this just gives a nicer error before ever reaching them. */
function validateInput(input: BriefSubmissionInput, now: Date): void {
  const deadlineDay = input.deadline.toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  if (deadlineDay <= today) {
    throw new ValidationError("check this date");
  }
  if (input.nicheFfPreApproved && !input.nicheFfRationale?.trim()) {
    throw new ValidationError(
      "A rationale is required when Niche/FF Pre-Approved is set",
    );
  }
  if (input.strategicPriority && !input.strategicPriorityRationale?.trim()) {
    throw new ValidationError(
      "A rationale is required when Strategic Priority is set",
    );
  }
}

function daysBetween(from: Date, to: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round(
    (Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) -
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) /
      msPerDay,
  );
}

/** Resolves the current holder of a role, ONLY when exactly one person
 * currently holds it. `assignedHolderId` is a display/audit convenience,
 * not an authorization mechanism — actual permission to act is always
 * re-checked live against role_holders via authz.ts's
 * requireCanActOnRequirement, regardless of what's snapshotted here. When
 * a role has zero or multiple current holders (e.g. mid-handover),
 * leaving this null rather than guessing which one to snapshot is the
 * safer default; the UI falls back to showing the role name alone. */
async function resolveSingleCurrentHolder(
  db: PostgresJsDatabase<typeof schema>,
  roleKey: string,
  asOf: Date,
): Promise<string | null> {
  const asOfDay = asOf.toISOString().slice(0, 10);
  const holders = await db
    .select({ userId: schema.roleHolders.userId })
    .from(schema.roleHolders)
    .where(
      and(
        eq(schema.roleHolders.roleKey, roleKey),
        lte(schema.roleHolders.effectiveFrom, asOfDay),
        or(
          isNull(schema.roleHolders.effectiveTo),
          gte(schema.roleHolders.effectiveTo, asOfDay),
        ),
      ),
    );
  return holders.length === 1 ? holders[0]!.userId : null;
}

async function getCurrentPublishedRuleSet(db: PostgresJsDatabase<typeof schema>) {
  const [ruleSet] = await db
    .select()
    .from(schema.ruleSets)
    .where(eq(schema.ruleSets.status, "published"))
    .orderBy(desc(schema.ruleSets.version))
    .limit(1);
  if (!ruleSet) {
    throw new Error(
      "No published rule set found — has the version 1 seed been applied?",
    );
  }
  return ruleSet;
}

export interface CreateBriefResult {
  briefId: string;
  decisionId: string;
  commercialDecision: "auto_approved" | "pending" | "declined";
  finalStatus: "pending" | "approved" | "declined";
  score: number;
  approvalCode: string | null;
  requirementCount: number;
}

export async function createBrief(
  db: PostgresJsDatabase<typeof schema>,
  input: BriefSubmissionInput,
  now: Date = new Date(),
): Promise<CreateBriefResult> {
  validateInput(input, now);

  const ruleSetRow = await getCurrentPublishedRuleSet(db);
  const ruleSet = ruleSetRow.payload as RuleSetPayload;

  const daysUntilDeadline = daysBetween(now, input.deadline);

  const decisionInputs = {
    customerTier: input.tier,
    valuePotentialGbp: input.valuePotentialGbp,
    newRework: input.newRework,
    briefType: input.briefType,
    customerApproval: input.customerApproval,
    strategicPriority: input.strategicPriority,
    creativeApproach: input.creativeApproach,
    nicheFfPreApproved: input.nicheFfPreApproved,
    marketingFlag: input.marketingFlag,
    ppdFlag: input.ppdFlag,
    gcmsFlag: input.gcmsFlag,
    daysUntilDeadline,
  };

  const stageA = computeStageA(decisionInputs, ruleSet);
  const requirements = computeStageB(decisionInputs, ruleSet);

  return db.transaction(async (tx) => {
    const [brief] = await tx
      .insert(schema.briefs)
      .values({
        customerReference: input.customerReference,
        tier: input.tier,
        valuePotentialGbp: String(input.valuePotentialGbp),
        newRework: input.newRework,
        briefType: input.briefType,
        customerApproval: input.customerApproval,
        nicheFfPreApproved: input.nicheFfPreApproved,
        nicheFfRationale: input.nicheFfRationale ?? null,
        strategicPriority: input.strategicPriority,
        strategicPriorityRationale: input.strategicPriorityRationale ?? null,
        creativeApproach: input.creativeApproach,
        marketingFlag: input.marketingFlag,
        ppdFlag: input.ppdFlag,
        gcmsFlag: input.gcmsFlag,
        deadline: input.deadline.toISOString().slice(0, 10),
        pvReference: input.pvReference ?? null,
        submittedBy: input.submittedBy,
        onBehalfOf: input.onBehalfOf ?? null,
        submittedAt: now,
      })
      .returning();
    if (!brief) throw new Error("Failed to insert brief");

    // §5 Stage D, computed from what Stage B just produced: declined wins
    // outright; otherwise any outstanding requirement means pending; only
    // zero outstanding requirements (which includes the common case of zero
    // requirements at all) means fully clear.
    const finalStatus: "pending" | "approved" | "declined" =
      stageA.commercialDecision === "declined"
        ? "declined"
        : requirements.length === 0
          ? "approved"
          : "pending";

    let approvalCode: string | null = null;
    let codeIssuedAt: Date | null = null;
    if (finalStatus === "approved") {
      approvalCode = await issueUniqueApprovalCode(tx, now);
      codeIssuedAt = now;
    }

    const [decision] = await tx
      .insert(schema.decisions)
      .values({
        briefId: brief.id,
        ruleSetId: ruleSetRow.id,
        computedScore: String(stageA.score),
        scoreBreakdown: stageA.scoreBreakdown,
        commercialDecision: stageA.commercialDecision,
        finalStatus,
        approvalCode,
        codeIssuedAt,
      })
      .returning();
    if (!decision) throw new Error("Failed to insert decision");

    for (const requirement of requirements) {
      const assignedHolderId = await resolveSingleCurrentHolder(
        tx,
        requirement.role,
        now,
      );
      await tx.insert(schema.approvalRequirements).values({
        briefId: brief.id,
        decisionId: decision.id,
        requirementType: requirement.requirementType,
        requiredRoleKey: requirement.role,
        assignedHolderId,
        state: "pending",
      });
    }

    await tx.insert(schema.auditEvents).values({
      actorId: input.submittedBy,
      action: "brief.submitted",
      entityType: "brief",
      entityId: brief.id,
      before: null,
      after: {
        commercialDecision: stageA.commercialDecision,
        finalStatus,
        score: stageA.score,
        requirementCount: requirements.length,
        approvalCode,
      },
      requestCorrelationId: crypto.randomUUID(),
    });

    return {
      briefId: brief.id,
      decisionId: decision.id,
      commercialDecision: stageA.commercialDecision,
      finalStatus,
      score: stageA.score,
      approvalCode,
      requirementCount: requirements.length,
    };
  });
}
