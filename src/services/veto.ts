/**
 * General Manager veto, and the Admin reversal of it.
 *
 * vetoRequirement: the caller must have passed requireCanVeto(session). Any
 * open (pending or revoked) requirement on any brief can be vetoed whatever
 * role it is routed to. The requirement becomes "rejected" with the reason
 * as its comment, the brief's decision becomes "declined" and records who
 * vetoed and why, and the submitter is notified. A vetoed brief cannot be
 * decided further until an Admin reverses the veto.
 *
 * reverseVeto: the caller must have passed requireAdmin(session). Clears the
 * veto, returns the vetoed requirement to pending, and recomputes the
 * brief's status. A reason is mandatory and everything is audited.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import { NotFoundError, ValidationError } from "./decide-requirement.js";

type Db = PostgresJsDatabase<typeof schema>;

export async function vetoRequirement(
  db: Db,
  input: { requirementId: string; vetoedBy: string; reason: string },
  now: Date = new Date(),
): Promise<{ briefId: string; decisionId: string }> {
  const reason = input.reason.trim();
  if (!reason) throw new ValidationError("A reason is required to veto");

  return db.transaction(async (tx) => {
    const [requirement] = await tx
      .select()
      .from(schema.approvalRequirements)
      .where(eq(schema.approvalRequirements.id, input.requirementId));
    if (!requirement)
      throw new NotFoundError(`No requirement with id ${input.requirementId}`);
    if (requirement.state !== "pending" && requirement.state !== "revoked") {
      throw new ValidationError(
        `Only an open requirement can be vetoed; this one is "${requirement.state}"`,
      );
    }
    const [decision] = await tx
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.id, requirement.decisionId));
    if (!decision) throw new Error(`Requirement ${requirement.id} has no decision`);
    if (decision.vetoedAt)
      throw new ValidationError("This brief has already been vetoed");

    await tx
      .update(schema.approvalRequirements)
      .set({
        state: "rejected",
        decidedBy: input.vetoedBy,
        decidedAt: now,
        comment: reason,
      })
      .where(eq(schema.approvalRequirements.id, requirement.id));

    await tx
      .update(schema.decisions)
      .set({
        finalStatus: "declined",
        approvalCode: null,
        codeIssuedAt: null,
        vetoedAt: now,
        vetoedBy: input.vetoedBy,
        vetoReason: reason,
        vetoedRequirementId: requirement.id,
      })
      .where(eq(schema.decisions.id, decision.id));

    const [brief] = await tx
      .select({
        submittedBy: schema.briefs.submittedBy,
        customerReference: schema.briefs.customerReference,
      })
      .from(schema.briefs)
      .where(eq(schema.briefs.id, requirement.briefId));
    if (!brief) throw new Error(`Requirement ${requirement.id} has no brief`);

    await tx.insert(schema.auditEvents).values({
      actorId: input.vetoedBy,
      action: "brief.vetoed",
      entityType: "brief",
      entityId: requirement.briefId,
      before: { finalStatus: decision.finalStatus, requirementState: requirement.state },
      after: {
        finalStatus: "declined",
        requirementId: requirement.id,
        requirementType: requirement.requirementType,
        routedToRole: requirement.requiredRoleKey,
        reason,
      },
      requestCorrelationId: crypto.randomUUID(),
    });

    await tx.insert(schema.notifications).values({
      recipientId: brief.submittedBy,
      channel: "email",
      template: "brief_vetoed",
      payload: {
        briefId: requirement.briefId,
        customerReference: brief.customerReference,
        reason,
      },
      deliveryStatus: "queued",
    });

    return { briefId: requirement.briefId, decisionId: decision.id };
  });
}

export async function reverseVeto(
  db: Db,
  input: { briefId: string; reversedBy: string; reason: string },
): Promise<{ finalStatus: "pending" | "declined" }> {
  const reason = input.reason.trim();
  if (!reason) throw new ValidationError("A reason is required to reverse a veto");

  return db.transaction(async (tx) => {
    const [decision] = await tx
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.briefId, input.briefId));
    if (!decision) throw new NotFoundError(`No decision for brief ${input.briefId}`);
    if (!decision.vetoedAt)
      throw new ValidationError("This brief has no veto to reverse");

    if (decision.vetoedRequirementId) {
      await tx
        .update(schema.approvalRequirements)
        .set({ state: "pending", decidedBy: null, decidedAt: null, comment: null })
        .where(eq(schema.approvalRequirements.id, decision.vetoedRequirementId));
    }

    // The vetoed requirement is pending again, so a reversal can only land
    // on pending (or stay declined if the commercial decision was a decline).
    const finalStatus: "pending" | "declined" =
      decision.commercialDecision === "declined" ? "declined" : "pending";

    await tx
      .update(schema.decisions)
      .set({
        finalStatus,
        vetoedAt: null,
        vetoedBy: null,
        vetoReason: null,
        vetoedRequirementId: null,
      })
      .where(eq(schema.decisions.id, decision.id));

    const [brief] = await tx
      .select({
        submittedBy: schema.briefs.submittedBy,
        customerReference: schema.briefs.customerReference,
      })
      .from(schema.briefs)
      .where(eq(schema.briefs.id, input.briefId));

    await tx.insert(schema.auditEvents).values({
      actorId: input.reversedBy,
      action: "brief.veto_reversed",
      entityType: "brief",
      entityId: input.briefId,
      before: { vetoedBy: decision.vetoedBy, reason: decision.vetoReason },
      after: { finalStatus, reversalReason: reason },
      requestCorrelationId: crypto.randomUUID(),
    });

    if (brief) {
      await tx.insert(schema.notifications).values({
        recipientId: brief.submittedBy,
        channel: "email",
        template: "veto_reversed",
        payload: { briefId: input.briefId, customerReference: brief.customerReference },
        deliveryStatus: "queued",
      });
    }
    return { finalStatus };
  });
}

/** Every open requirement on every brief — the General Manager's view. */
export async function listOpenRequirementsForVeto(db: Db) {
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
        eq(schema.decisions.finalStatus, "pending"),
      ),
    );
}
