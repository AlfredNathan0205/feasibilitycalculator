/**
 * Niche assessment notifications (build spec §11). All three go through the
 * existing notifications outbox, so they are sent by the dispatch route.
 *
 *  - niche_assessment_review_request: on submit, to reviewer-role holders
 *    (never the assessor); to Admins when escalated or nobody else holds the role.
 *  - niche_assessment_outcome: on approve/reject, to the assessor.
 *  - niche_assessment_expiring: once per assessment, N days before valid_until,
 *    to the assessor and the most recent submitter of a brief for that brand.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import { todayLondon } from "../engine/niche-assessment.js";
import { listApprovalRecipients } from "./notifications/recipients.js";

type Db = PostgresJsDatabase<typeof schema>;

async function queue(db: Db, recipientIds: string[], template: string, payload: unknown) {
  const ids = [...new Set(recipientIds)];
  if (ids.length === 0) return 0;
  await db
    .insert(schema.notifications)
    .values(ids.map((recipientId) => ({ recipientId, template, payload })));
  return ids.length;
}

export async function queueReviewRequest(
  db: Db,
  a: {
    id: string;
    reference: string;
    brandId: string;
    assessorId: string;
    band: string | null;
    score: number | null;
  },
  reviewerRoleKey: string,
  escalated: boolean,
) {
  const [brand] = await db
    .select()
    .from(schema.nicheBrands)
    .where(eq(schema.nicheBrands.id, a.brandId));
  const recipients = escalated
    ? await listApprovalRecipients(db, "admin", new Date(), [a.assessorId])
    : await listApprovalRecipients(db, reviewerRoleKey, new Date(), [a.assessorId]);
  return queue(db, recipients, "niche_assessment_review_request", {
    assessmentId: a.id,
    reference: a.reference,
    brandName: brand?.name ?? "—",
    band: a.band,
    score: a.score,
    escalated,
  });
}

export async function queueOutcome(
  db: Db,
  a: {
    id: string;
    reference: string;
    brandId: string;
    assessorId: string;
    score: number | null;
    band: string | null;
  },
  decision: "approved" | "rejected",
  comment: string | null,
  validUntil: string | null,
) {
  const [brand] = await db
    .select()
    .from(schema.nicheBrands)
    .where(eq(schema.nicheBrands.id, a.brandId));
  return queue(db, [a.assessorId], "niche_assessment_outcome", {
    assessmentId: a.id,
    reference: a.reference,
    brandName: brand?.name ?? "—",
    decision,
    comment,
    band: a.band,
    score: a.score,
    validUntil,
  });
}

/**
 * Queues one reminder per approved assessment expiring within its framework's
 * reminder window. Idempotent: an assessment is only ever reminded once.
 * Called by the dispatch route immediately before sending.
 */
export async function enqueueExpiringReminders(
  db: Db,
  today: string = todayLondon(),
): Promise<number> {
  const rows = await db
    .select({
      a: schema.nicheAssessments,
      brandName: schema.nicheBrands.name,
      fw: schema.nicheFrameworks.payload,
    })
    .from(schema.nicheAssessments)
    .innerJoin(
      schema.nicheBrands,
      eq(schema.nicheBrands.id, schema.nicheAssessments.brandId),
    )
    .innerJoin(
      schema.nicheFrameworks,
      eq(schema.nicheFrameworks.id, schema.nicheAssessments.frameworkId),
    )
    .where(
      and(
        eq(schema.nicheAssessments.status, "approved"),
        eq(schema.nicheBrands.active, true),
      ),
    );
  let queued = 0;
  for (const { a, brandName, fw } of rows) {
    if (!a.validUntil || a.validUntil < today) continue;
    const reminderDays = (fw as { expiryReminderDays: number }).expiryReminderDays;
    if (a.validUntil > addDays(today, reminderDays)) continue;
    // Skip when a newer approved assessment already supersedes this one.
    const [newer] = await db
      .select({ id: schema.nicheAssessments.id })
      .from(schema.nicheAssessments)
      .where(eq(schema.nicheAssessments.supersedesId, a.id))
      .limit(1);
    if (newer) continue;
    const already = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.template, "niche_assessment_expiring"),
          sql`${schema.notifications.payload}->>'assessmentId' = ${a.id}`,
        ),
      )
      .limit(1);
    if (already.length > 0) continue;
    const [lastBrief] = await db
      .select({ submittedBy: schema.briefs.submittedBy })
      .from(schema.briefs)
      .where(eq(schema.briefs.nicheBrandId, a.brandId))
      .orderBy(desc(schema.briefs.submittedAt))
      .limit(1);
    queued += await queue(
      db,
      [a.assessorId, lastBrief?.submittedBy].filter((x): x is string => !!x),
      "niche_assessment_expiring",
      {
        assessmentId: a.id,
        brandId: a.brandId,
        reference: a.reference,
        brandName,
        validUntil: a.validUntil,
      },
    );
  }
  return queued;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
