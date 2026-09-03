/**
 * decideRequirement — the missing half of §5's lifecycle. createBrief
 * handles the immediate-clear case (zero requirements at submission); this
 * handles a brief that started PENDING because a requirement existed, and
 * now that requirement is being approved or rejected.
 *
 * Authorization is NOT checked in here, same convention as createBrief —
 * callers (the API route) must call requireCanDecideRequirement() first,
 * which needs the brief and requirement rows to check against, so the
 * route reads those, authorizes, then calls this to persist.
 *
 * Stage D is recomputed from scratch on every call rather than
 * incrementally patched, so it can never drift out of sync with the
 * requirements table — same principle as createBrief's own Stage D
 * computation.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import { issueUniqueApprovalCode } from "./issue-approval-code.js";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export interface DecideRequirementInput {
  requirementId: string;
  decidedBy: string;
  decision: "approve" | "reject";
  /** Mandatory when decision is "reject" (§9: "Rejection comments are
   * mandatory"). Optional on approve. */
  comment?: string | null;
}

export interface DecideRequirementResult {
  requirementId: string;
  requirementState: "approved" | "rejected";
  briefId: string;
  decisionId: string;
  finalStatus: "pending" | "approved" | "declined";
  approvalCode: string | null;
  /** True only when this specific call is what pushed the brief over the
   * line into fully-clear — useful for the caller to decide whether to
   * fire a "your brief is now approved" notification. */
  codeJustIssued: boolean;
}

/** States that count as "satisfied" for Stage D's "any requirement not
 * satisfied -> PENDING" check (§5). Pending, rejected, and revoked are all
 * NOT satisfied — a rejected requirement blocks the brief from ever
 * reaching APPROVED on its own; there is no auto-decline-on-reject rule in
 * the spec, so this is a deliberate stuck state pending human
 * intervention (resubmission), not a bug. */
const SATISFIED_STATES = new Set(["approved", "pre_approved"]);

export async function decideRequirement(
  db: PostgresJsDatabase<typeof schema>,
  input: DecideRequirementInput,
  now: Date = new Date(),
): Promise<DecideRequirementResult> {
  if (input.decision === "reject" && !input.comment?.trim()) {
    throw new ValidationError("A comment is required to reject a requirement");
  }

  return db.transaction(async (tx) => {
    const [requirement] = await tx
      .select()
      .from(schema.approvalRequirements)
      .where(eq(schema.approvalRequirements.id, input.requirementId));

    if (!requirement) {
      throw new NotFoundError(`No requirement with id ${input.requirementId}`);
    }
    if (requirement.state !== "pending") {
      throw new ValidationError(
        `Requirement is already "${requirement.state}", not pending`,
      );
    }

    const newState = input.decision === "approve" ? "approved" : "rejected";

    await tx
      .update(schema.approvalRequirements)
      .set({
        state: newState,
        decidedBy: input.decidedBy,
        decidedAt: now,
        comment: input.comment ?? null,
      })
      .where(eq(schema.approvalRequirements.id, input.requirementId));

    const [decision] = await tx
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.id, requirement.decisionId));
    if (!decision) {
      throw new Error(
        `Requirement ${input.requirementId} references a missing decision ${requirement.decisionId}`,
      );
    }

    const allRequirements = await tx
      .select({ state: schema.approvalRequirements.state })
      .from(schema.approvalRequirements)
      .where(eq(schema.approvalRequirements.decisionId, decision.id));

    const allSatisfied = allRequirements.every((r) =>
      SATISFIED_STATES.has(r.state),
    );

    const newFinalStatus: "pending" | "approved" | "declined" =
      decision.commercialDecision === "declined"
        ? "declined"
        : allSatisfied
          ? "approved"
          : "pending";

    let approvalCode = decision.approvalCode;
    let codeIssuedAt = decision.codeIssuedAt;
    let codeJustIssued = false;

    if (newFinalStatus === "approved" && !approvalCode) {
      approvalCode = await issueUniqueApprovalCode(tx, now);
      codeIssuedAt = now;
      codeJustIssued = true;
    }

    await tx
      .update(schema.decisions)
      .set({
        finalStatus: newFinalStatus,
        approvalCode,
        codeIssuedAt,
      })
      .where(eq(schema.decisions.id, decision.id));

    await tx.insert(schema.auditEvents).values({
      actorId: input.decidedBy,
      action: `requirement.${newState}`,
      entityType: "approval_requirement",
      entityId: requirement.id,
      before: { state: "pending" },
      after: {
        state: newState,
        comment: input.comment ?? null,
        briefFinalStatus: newFinalStatus,
        approvalCodeJustIssued: codeJustIssued,
      },
      requestCorrelationId: crypto.randomUUID(),
    });

    return {
      requirementId: requirement.id,
      requirementState: newState,
      briefId: requirement.briefId,
      decisionId: decision.id,
      finalStatus: newFinalStatus,
      approvalCode,
      codeJustIssued,
    };
  });
}

/** Requirements currently assigned to any of the given approval-authority
 * roles, still pending. Used by the approver queue (§9). */
export async function listPendingRequirementsForRoles(
  db: PostgresJsDatabase<typeof schema>,
  roleKeys: string[],
) {
  if (roleKeys.length === 0) return [];

  return db
    .select({
      requirementId: schema.approvalRequirements.id,
      requirementTypeKind: schema.approvalRequirements.requirementType,
      requiredRoleKey: schema.approvalRequirements.requiredRoleKey,
      createdAt: schema.approvalRequirements.createdAt,
      briefId: schema.briefs.id,
      customerReference: schema.briefs.customerReference,
      tier: schema.briefs.tier,
      valuePotentialGbp: schema.briefs.valuePotentialGbp,
      submittedBy: schema.briefs.submittedBy,
      onBehalfOf: schema.briefs.onBehalfOf,
      score: schema.decisions.computedScore,
      commercialDecision: schema.decisions.commercialDecision,
      decisionId: schema.decisions.id,
    })
    .from(schema.approvalRequirements)
    .innerJoin(schema.briefs, eq(schema.briefs.id, schema.approvalRequirements.briefId))
    .innerJoin(
      schema.decisions,
      eq(schema.decisions.id, schema.approvalRequirements.decisionId),
    )
    .where(
      and(
        eq(schema.approvalRequirements.state, "pending"),
        inArray(schema.approvalRequirements.requiredRoleKey, roleKeys),
      ),
    );
}
