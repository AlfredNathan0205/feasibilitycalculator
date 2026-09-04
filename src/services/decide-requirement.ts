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
import { SATISFIED_REQUIREMENT_STATES } from "./satisfied-states.js";
import { verifyRevokeToken } from "../engine/revoke-token.js";

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
    // A previously-revoked requirement is actionable again, same as
    // plain pending — "revoked" only exists as a distinct state for audit
    // clarity (see satisfied-states.ts), not to block a fresh decision.
    if (requirement.state !== "pending" && requirement.state !== "revoked") {
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
      SATISFIED_REQUIREMENT_STATES.has(r.state),
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

/** §5 Stage C revoke path: "If the manager revokes, the requirement
 * returns to pending, the brief loses any issued Approval Code, and the
 * submitter and their line manager are both notified."
 *
 * No session/authz check here by design — the security model for this
 * path is possession of the raw token (like a password-reset link), not
 * being signed in (see engine/revoke-token.ts's docstring). The caller
 * (the revoke page) passes whatever token came in the URL; this function
 * is what actually verifies it.
 */
export interface RevokeRequirementResult {
  requirementId: string;
  briefId: string;
  decisionId: string;
  finalStatus: "pending" | "declined";
  /** Always null — revoking strips any issued code unconditionally (§5). */
  approvalCode: null;
}

export async function revokeRequirement(
  db: PostgresJsDatabase<typeof schema>,
  input: { requirementId: string; rawToken: string },
  now: Date = new Date(),
): Promise<RevokeRequirementResult> {
  return db.transaction(async (tx) => {
    const [requirement] = await tx
      .select()
      .from(schema.approvalRequirements)
      .where(eq(schema.approvalRequirements.id, input.requirementId));

    if (!requirement) {
      throw new NotFoundError(`No requirement with id ${input.requirementId}`);
    }
    if (requirement.state !== "pre_approved") {
      throw new ValidationError(
        `Requirement is "${requirement.state}", not pre_approved — nothing to revoke`,
      );
    }
    if (!requirement.revokeTokenHash) {
      throw new ValidationError("This requirement has no active revoke token");
    }
    if (requirement.revokeWindowExpiresAt && now > requirement.revokeWindowExpiresAt) {
      throw new ValidationError("The revoke window has expired");
    }
    if (!verifyRevokeToken(input.rawToken, requirement.revokeTokenHash)) {
      throw new ValidationError("Invalid revoke token");
    }

    // "Returns to pending" functionally (§5) — recorded as the distinct
    // `revoked` state so the audit trail shows this was pre-approved and
    // then revoked, not indistinguishable from never having been declared
    // (see satisfied-states.ts's docstring for the same reasoning).
    // Single-use: revokeTokenHash is cleared so this exact token can never
    // be replayed, even before the window would otherwise expire.
    await tx
      .update(schema.approvalRequirements)
      .set({
        state: "revoked",
        revokeTokenHash: null,
        revokeWindowExpiresAt: null,
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

    // The brief was fully clear only if this was its last unsatisfied
    // requirement being pre-approved — revoking it can only ever move
    // finalStatus from approved back to pending (or leave it pending if
    // something else was already outstanding), never touch "declined".
    const newFinalStatus: "pending" | "approved" | "declined" =
      decision.commercialDecision === "declined" ? "declined" : "pending";

    // "the brief loses any issued Approval Code" (§5) — unconditionally,
    // even though in principle a NEW code could be regenerated later once
    // re-approved; the spec is explicit the code is stripped on revoke.
    await tx
      .update(schema.decisions)
      .set({
        finalStatus: newFinalStatus,
        approvalCode: null,
        codeIssuedAt: null,
      })
      .where(eq(schema.decisions.id, decision.id));

    await tx.insert(schema.auditEvents).values({
      actorId: null, // revoker acts via a signed link, not a session — no user id to attribute to
      action: "requirement.revoked",
      entityType: "approval_requirement",
      entityId: requirement.id,
      before: { state: "pre_approved" },
      after: { state: "revoked", briefFinalStatus: newFinalStatus },
      requestCorrelationId: crypto.randomUUID(),
    });

    const [brief] = await tx
      .select({
        submittedBy: schema.briefs.submittedBy,
        customerReference: schema.briefs.customerReference,
      })
      .from(schema.briefs)
      .where(eq(schema.briefs.id, requirement.briefId));
    if (!brief) {
      throw new Error(`Requirement ${requirement.id} references a missing brief`);
    }

    // Both the submitter and their line manager should be notified (§5).
    // The line-manager half is blocked on docs/open-questions.md item 2
    // (no line-manager relationship modeled yet) — queuing only the
    // submitter notification for now rather than guessing a recipient for
    // the other half.
    await tx.insert(schema.notifications).values({
      recipientId: brief.submittedBy,
      channel: "email",
      template: "pre_approval_revoked",
      payload: {
        requirementId: requirement.id,
        briefId: requirement.briefId,
        customerReference: brief.customerReference,
        requirementType: requirement.requirementType,
      },
      deliveryStatus: "queued",
    });

    return {
      requirementId: requirement.id,
      briefId: requirement.briefId,
      decisionId: decision.id,
      finalStatus: newFinalStatus,
      approvalCode: null,
    };
  });
}

/** Requirements currently assigned to any of the given approval-authority
 * roles that are actionable — pending, or revoked (a revoked pre-approval
 * needs a fresh human decision, same as pending; see the state-check note
 * in decideRequirement above). Used by the approver queue (§9). */
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
      state: schema.approvalRequirements.state,
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
        inArray(schema.approvalRequirements.state, ["pending", "revoked"]),
        inArray(schema.approvalRequirements.requiredRoleKey, roleKeys),
      ),
    );
}
