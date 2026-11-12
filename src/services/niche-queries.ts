/**
 * Read models for the Niche Brand Assessment pages. No mutation here.
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import {
  isAssessmentCurrent,
  todayLondon,
  addMonthsIso,
  type NicheFrameworkPayload,
} from "../engine/niche-assessment.js";

type Db = PostgresJsDatabase<typeof schema>;
type Assessment = typeof schema.nicheAssessments.$inferSelect;

export type BrandState = "current" | "expiring" | "expired" | "none";

export interface BrandSummary {
  id: string;
  name: string;
  customerReference: string | null;
  active: boolean;
  state: BrandState;
  /** Approved assessment in force (or the last approved one when expired). */
  latest: Assessment | null;
  pending: Assessment | null;
}

export interface BrandListFilters {
  q?: string;
  band?: string;
  state?: BrandState | "";
  includeInactive?: boolean;
}

export async function getPublishedFrameworkPayload(db: Db) {
  const [fw] = await db
    .select()
    .from(schema.nicheFrameworks)
    .where(eq(schema.nicheFrameworks.status, "published"))
    .limit(1);
  return fw
    ? { id: fw.id, version: fw.version, payload: fw.payload as NicheFrameworkPayload }
    : null;
}

export async function listNicheBrands(
  db: Db,
  filters: BrandListFilters = {},
  today: string = todayLondon(),
): Promise<BrandSummary[]> {
  const fw = await getPublishedFrameworkPayload(db);
  const reminderDays = fw?.payload.expiryReminderDays ?? 30;
  const windowEnd = addDaysIso(today, reminderDays);

  const brands = await db
    .select()
    .from(schema.nicheBrands)
    .where(
      and(
        isNull(schema.nicheBrands.mergedIntoId),
        filters.includeInactive ? undefined : eq(schema.nicheBrands.active, true),
      ),
    )
    .orderBy(asc(schema.nicheBrands.name));
  if (brands.length === 0) return [];

  const assessments = await db
    .select()
    .from(schema.nicheAssessments)
    .where(
      and(
        inArray(
          schema.nicheAssessments.brandId,
          brands.map((b) => b.id),
        ),
        inArray(schema.nicheAssessments.status, ["approved", "submitted"]),
      ),
    )
    .orderBy(desc(schema.nicheAssessments.reviewedAt));

  const q = filters.q?.trim().toLowerCase();
  const out: BrandSummary[] = [];
  for (const b of brands) {
    const mine = assessments.filter((a) => a.brandId === b.id);
    const approved = mine.filter((a) => a.status === "approved");
    const current = approved.find((a) =>
      isAssessmentCurrent({ status: a.status, validUntil: a.validUntil }, today),
    );
    const latest = current ?? approved[0] ?? null;
    const pending = mine.find((a) => a.status === "submitted") ?? null;
    const state: BrandState = current
      ? current.validUntil! <= windowEnd
        ? "expiring"
        : "current"
      : latest
        ? "expired"
        : "none";
    if (
      q &&
      !b.name.toLowerCase().includes(q) &&
      !(b.customerReference ?? "").toLowerCase().includes(q)
    )
      continue;
    if (filters.band && !(current && current.band === filters.band)) continue;
    if (filters.state && filters.state !== state) continue;
    out.push({
      id: b.id,
      name: b.name,
      customerReference: b.customerReference,
      active: b.active,
      state,
      latest,
      pending,
    });
  }
  return out;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export { addMonthsIso };

export async function getBrandDetail(
  db: Db,
  brandId: string,
  today: string = todayLondon(),
) {
  const [brand] = await db
    .select()
    .from(schema.nicheBrands)
    .where(eq(schema.nicheBrands.id, brandId));
  if (!brand) return null;
  const assessor = alias(schema.users, "assessor");
  const reviewer = alias(schema.users, "reviewer");
  const history = await db
    .select({
      a: schema.nicheAssessments,
      assessorName: assessor.displayName,
      reviewerName: reviewer.displayName,
      frameworkVersion: schema.nicheFrameworks.version,
    })
    .from(schema.nicheAssessments)
    .innerJoin(assessor, eq(assessor.id, schema.nicheAssessments.assessorId))
    .leftJoin(reviewer, eq(reviewer.id, schema.nicheAssessments.reviewedBy))
    .innerJoin(
      schema.nicheFrameworks,
      eq(schema.nicheFrameworks.id, schema.nicheAssessments.frameworkId),
    )
    .where(eq(schema.nicheAssessments.brandId, brandId))
    .orderBy(desc(schema.nicheAssessments.createdAt));
  const current =
    history.find((h) =>
      isAssessmentCurrent({ status: h.a.status, validUntil: h.a.validUntil }, today),
    ) ?? null;
  const briefs = await db
    .select({
      id: schema.briefs.id,
      customerReference: schema.briefs.customerReference,
      submittedAt: schema.briefs.submittedAt,
      finalStatus: schema.decisions.finalStatus,
      commercialDecision: schema.decisions.commercialDecision,
      route: schema.briefs.nicheRoute,
      snapshot: schema.decisions.nicheSnapshot,
    })
    .from(schema.briefs)
    .innerJoin(schema.decisions, eq(schema.decisions.briefId, schema.briefs.id))
    .where(eq(schema.briefs.nicheBrandId, brandId))
    .orderBy(desc(schema.briefs.submittedAt));
  return { brand, history, current, briefs };
}

export async function getAssessmentDetail(db: Db, id: string) {
  const assessor = alias(schema.users, "assessor");
  const reviewer = alias(schema.users, "reviewer");
  const [row] = await db
    .select({
      a: schema.nicheAssessments,
      brand: schema.nicheBrands,
      assessorName: assessor.displayName,
      reviewerName: reviewer.displayName,
      framework: schema.nicheFrameworks,
    })
    .from(schema.nicheAssessments)
    .innerJoin(
      schema.nicheBrands,
      eq(schema.nicheBrands.id, schema.nicheAssessments.brandId),
    )
    .innerJoin(assessor, eq(assessor.id, schema.nicheAssessments.assessorId))
    .leftJoin(reviewer, eq(reviewer.id, schema.nicheAssessments.reviewedBy))
    .innerJoin(
      schema.nicheFrameworks,
      eq(schema.nicheFrameworks.id, schema.nicheAssessments.frameworkId),
    )
    .where(eq(schema.nicheAssessments.id, id));
  if (!row) return null;
  return {
    a: row.a,
    brand: row.brand,
    assessorName: row.assessorName,
    reviewerName: row.reviewerName,
    frameworkVersion: row.framework.version,
    framework: row.framework.payload as NicheFrameworkPayload,
  };
}

export async function getAssessmentAudit(db: Db, id: string) {
  return db
    .select({
      id: schema.auditEvents.id,
      action: schema.auditEvents.action,
      occurredAt: schema.auditEvents.occurredAt,
      actorName: schema.users.displayName,
      after: schema.auditEvents.after,
    })
    .from(schema.auditEvents)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditEvents.actorId))
    .where(
      and(
        eq(schema.auditEvents.entityType, "niche_assessment"),
        eq(schema.auditEvents.entityId, id),
      ),
    )
    .orderBy(asc(schema.auditEvents.occurredAt));
}

/** Submitted assessments awaiting review, oldest first, with who may review them. */
export async function listReviewQueue(db: Db) {
  const assessor = alias(schema.users, "assessor");
  return db
    .select({
      a: schema.nicheAssessments,
      brandName: schema.nicheBrands.name,
      assessorName: assessor.displayName,
    })
    .from(schema.nicheAssessments)
    .innerJoin(
      schema.nicheBrands,
      eq(schema.nicheBrands.id, schema.nicheAssessments.brandId),
    )
    .innerJoin(assessor, eq(assessor.id, schema.nicheAssessments.assessorId))
    .where(eq(schema.nicheAssessments.status, "submitted"))
    .orderBy(asc(schema.nicheAssessments.submittedAt));
}

/** The brand's own current-assessment card data for the brief wizard (read-only). */
export async function brandOptionsForBrief(db: Db, today: string = todayLondon()) {
  const rows = await listNicheBrands(db, {}, today);
  const fw = await getPublishedFrameworkPayload(db);
  const names = new Map<string, string>();
  const ids = rows
    .flatMap((r) => (r.latest ? [r.latest.assessorId, r.latest.reviewedBy ?? ""] : []))
    .filter(Boolean);
  if (ids.length) {
    const users = await db
      .select({ id: schema.users.id, name: schema.users.displayName })
      .from(schema.users)
      .where(inArray(schema.users.id, ids));
    users.forEach((u) => names.set(u.id, u.name));
  }
  return { rows, names, framework: fw };
}
