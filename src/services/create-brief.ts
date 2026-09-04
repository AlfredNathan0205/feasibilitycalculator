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
import { generateRevokeToken } from "../engine/revoke-token.js";

/** §5 Stage C: a per-requirement pre-approval declaration, made inline at
 * submission time (the spec's step-2-of-the-wizard concept, folded into
 * this single-page form). Keyed by requirement type (e.g.
 * "marketing_resource") since that's what the submitter sees on the live
 * preview before the brief — and therefore its requirements' real ids —
 * exist yet. */
export interface PreApprovalDeclaration {
  nominatedManagerId: string;
  comment: string;
}

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
  /** Per-requirement pre-approval declarations, keyed by requirement type.
   * A key with no matching requirement raised by Stage B is silently
   * ignored — declaring pre-approval for a requirement that was never
   * going to be raised isn't an error, it's a no-op (the submitter can't
   * know in advance exactly which requirement types apply without
   * checking the live preview first, and the preview and the actual
   * Stage B computation are guaranteed to agree since they're the same
   * function). */
  preApprovals?: Record<string, PreApprovalDeclaration>;
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
    throw new ValidationError("A rationale is required when Strategic Priority is set");
  }
  for (const [requirementType, decl] of Object.entries(input.preApprovals ?? {})) {
    if (!decl.nominatedManagerId || !decl.comment?.trim()) {
      throw new ValidationError(
        `Pre-approval for "${requirementType}" requires both a nominated manager and a comment`,
      );
    }
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

/** §5 Stage C: "the named manager who gave the go-ahead, selected from
 * the people currently holding the relevant role" — a real check, not
 * just trusting whatever user id the client sends. */
async function userCurrentlyHoldsRole(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
  roleKey: string,
  asOf: Date,
): Promise<boolean> {
  const asOfDay = asOf.toISOString().slice(0, 10);
  const rows = await db
    .select({ id: schema.roleHolders.id })
    .from(schema.roleHolders)
    .where(
      and(
        eq(schema.roleHolders.roleKey, roleKey),
        eq(schema.roleHolders.userId, userId),
        lte(schema.roleHolders.effectiveFrom, asOfDay),
        or(
          isNull(schema.roleHolders.effectiveTo),
          gte(schema.roleHolders.effectiveTo, asOfDay),
        ),
      ),
    );
  return rows.length > 0;
}

async function getCurrentPublishedRuleSet(db: PostgresJsDatabase<typeof schema>) {
  const [ruleSet] = await db
    .select()
    .from(schema.ruleSets)
    .where(eq(schema.ruleSets.status, "published"))
    .orderBy(desc(schema.ruleSets.version))
    .limit(1);
  if (!ruleSet) {
    throw new Error("No published rule set found — has the version 1 seed been applied?");
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

    // §5 Stage D can't be fully computed until we know which requirements
    // were satisfied by an inline pre-approval declaration (Stage C) — so
    // the decision row is inserted with a placeholder finalStatus first,
    // then finalized after the requirements loop below, the same pattern
    // decideRequirement.ts uses for a later approve/reject.
    const [decision] = await tx
      .insert(schema.decisions)
      .values({
        briefId: brief.id,
        ruleSetId: ruleSetRow.id,
        computedScore: String(stageA.score),
        scoreBreakdown: stageA.scoreBreakdown,
        commercialDecision: stageA.commercialDecision,
        finalStatus: "pending",
        approvalCode: null,
        codeIssuedAt: null,
      })
      .returning();
    if (!decision) throw new Error("Failed to insert decision");

    // §5 Stage C: for each requirement, the submitter may have declared
    // it pre-approved inline. Insert accordingly and track whether the
    // brief is fully clear right now (Stage D needs "satisfied", not
    // "zero requirements" — a pre-approved requirement counts as
    // satisfied even though it exists).
    let allRequirementsSatisfied = true;
    for (const requirement of requirements) {
      const declaration = input.preApprovals?.[requirement.requirementType];

      if (declaration) {
        const managerHoldsRole = await userCurrentlyHoldsRole(
          tx,
          declaration.nominatedManagerId,
          requirement.role,
          now,
        );
        if (!managerHoldsRole) {
          throw new ValidationError(
            `The nominated manager for "${requirement.requirementType}" does not currently hold the required role "${requirement.role}"`,
          );
        }

        const revokeToken = generateRevokeToken(now);
        await tx.insert(schema.approvalRequirements).values({
          briefId: brief.id,
          decisionId: decision.id,
          requirementType: requirement.requirementType,
          requiredRoleKey: requirement.role,
          assignedHolderId: declaration.nominatedManagerId,
          state: "pre_approved",
          preApprovalNominatedManagerId: declaration.nominatedManagerId,
          preApprovalSubmitterComment: declaration.comment,
          revokeTokenHash: revokeToken.hash,
          revokeWindowExpiresAt: revokeToken.expiresAt,
        });

        // Queued for whenever real email sending exists (backlog item);
        // storing the raw token here (not just its hash) is the outbox
        // pattern — the eventual send step reads this row, builds the
        // link, emails it, and never persists the token anywhere else.
        // The submitter's own API response never sees this raw token.
        await tx.insert(schema.notifications).values({
          recipientId: declaration.nominatedManagerId,
          channel: "email",
          template: "pre_approval_declared",
          payload: {
            briefId: brief.id,
            requirementType: requirement.requirementType,
            submitterComment: declaration.comment,
            rawRevokeToken: revokeToken.rawToken,
            revokeWindowExpiresAt: revokeToken.expiresAt.toISOString(),
          },
          deliveryStatus: "queued",
        });
      } else {
        allRequirementsSatisfied = false;
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
    }

    // Now finalize Stage D: declined wins outright regardless of anything
    // above; otherwise fully clear only if EVERY requirement (zero of
    // them, or all pre-approved) is satisfied.
    const finalStatus: "pending" | "approved" | "declined" =
      stageA.commercialDecision === "declined"
        ? "declined"
        : allRequirementsSatisfied
          ? "approved"
          : "pending";

    let approvalCode: string | null = null;
    let codeIssuedAt: Date | null = null;
    if (finalStatus === "approved") {
      approvalCode = await issueUniqueApprovalCode(tx, now);
      codeIssuedAt = now;
    }

    await tx
      .update(schema.decisions)
      .set({ finalStatus, approvalCode, codeIssuedAt })
      .where(eq(schema.decisions.id, decision.id));

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
