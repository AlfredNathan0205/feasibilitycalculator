/**
 * Niche Brand Assessment services — build spec §4–§8, §11.3.
 *
 * Brands, assessment lifecycle (draft -> submitted -> approved/rejected, or
 * withdrawn), self-review escalation to Admin, supersession and brand merge.
 * Every mutation writes an audit event (before/after) in the same
 * transaction. Authorisation is delegated to the pure functions in authz.ts.
 */
import { and, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import {
  AuthorizationError,
  canEditNiche,
  canManageNicheBrands,
  requireCanReviewNicheAssessment,
  type AuthSession,
} from "../auth/authz.js";
import {
  addMonthsIso,
  isAssessmentCurrent,
  normaliseBrandName,
  scoreNicheAssessment,
  todayLondon,
  type NicheAnswers,
  type NicheFrameworkPayload,
} from "../engine/niche-assessment.js";
import { NotFoundError, ValidationError } from "./decide-requirement.js";

type Db = PostgresJsDatabase<typeof schema>;
type Assessment = typeof schema.nicheAssessments.$inferSelect;
type Brand = typeof schema.nicheBrands.$inferSelect;

function requireEditor(session: AuthSession) {
  if (!canEditNiche(session)) {
    throw new AuthorizationError(
      `User ${session.userId} cannot edit niche brands or assessments`,
    );
  }
}

async function audit(
  tx: Db,
  actorId: string | null,
  action: string,
  entityType: "niche_brand" | "niche_assessment",
  entityId: string,
  before: unknown,
  after: unknown,
) {
  await tx.insert(schema.auditEvents).values({
    actorId,
    action,
    entityType,
    entityId,
    before: before ?? null,
    after: after ?? null,
    requestCorrelationId: crypto.randomUUID(),
  });
}

// ---------------------------------------------------------------------------
// Framework lookup
// ---------------------------------------------------------------------------

export async function getPublishedFramework(db: Db) {
  const [fw] = await db
    .select()
    .from(schema.nicheFrameworks)
    .where(eq(schema.nicheFrameworks.status, "published"))
    .limit(1);
  if (!fw) throw new NotFoundError("No published niche framework exists");
  return { ...fw, payload: fw.payload as NicheFrameworkPayload };
}

async function frameworkById(db: Db, id: string) {
  const [fw] = await db
    .select()
    .from(schema.nicheFrameworks)
    .where(eq(schema.nicheFrameworks.id, id));
  if (!fw) throw new NotFoundError(`Framework ${id} not found`);
  return { ...fw, payload: fw.payload as NicheFrameworkPayload };
}

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

export async function findSimilarBrands(db: Db, name: string): Promise<Brand[]> {
  const n = normaliseBrandName(name);
  if (!n) return [];
  return db
    .select()
    .from(schema.nicheBrands)
    .where(
      and(
        isNull(schema.nicheBrands.mergedIntoId),
        or(
          eq(schema.nicheBrands.normalisedName, n),
          sql`${schema.nicheBrands.normalisedName} LIKE ${"%" + n.replace(/[%_\\]/g, "\\$&") + "%"}`,
        ),
      ),
    )
    .limit(10);
}

export interface BrandInput {
  name: string;
  customerReference?: string | null;
  website?: string | null;
  notes?: string | null;
}

function cleanBrand(input: BrandInput) {
  const name = input.name?.trim().replace(/\s+/g, " ");
  if (!name) throw new ValidationError("Brand name is required");
  const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
  return {
    name,
    normalisedName: normaliseBrandName(name),
    customerReference: blank(input.customerReference),
    website: blank(input.website),
    notes: blank(input.notes),
  };
}

export async function createBrand(
  db: Db,
  session: AuthSession,
  input: BrandInput,
): Promise<Brand> {
  requireEditor(session);
  const values = cleanBrand(input);
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [dup] = await tx
      .select({ id: schema.nicheBrands.id })
      .from(schema.nicheBrands)
      .where(eq(schema.nicheBrands.normalisedName, values.normalisedName));
    if (dup) throw new ValidationError(`A brand called "${values.name}" already exists`);
    const [brand] = await tx
      .insert(schema.nicheBrands)
      .values({ ...values, createdBy: session.userId })
      .returning();
    await audit(
      tx,
      session.userId,
      "niche_brand.created",
      "niche_brand",
      brand!.id,
      null,
      brand,
    );
    return brand!;
  });
}

export async function updateBrand(
  db: Db,
  session: AuthSession,
  brandId: string,
  input: BrandInput,
): Promise<Brand> {
  requireEditor(session);
  const values = cleanBrand(input);
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [before] = await tx
      .select()
      .from(schema.nicheBrands)
      .where(eq(schema.nicheBrands.id, brandId));
    if (!before) throw new NotFoundError("Brand not found");
    const [clash] = await tx
      .select({ id: schema.nicheBrands.id })
      .from(schema.nicheBrands)
      .where(
        and(
          eq(schema.nicheBrands.normalisedName, values.normalisedName),
          ne(schema.nicheBrands.id, brandId),
        ),
      );
    if (clash)
      throw new ValidationError(`A brand called "${values.name}" already exists`);
    const [after] = await tx
      .update(schema.nicheBrands)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(schema.nicheBrands.id, brandId))
      .returning();
    await audit(
      tx,
      session.userId,
      "niche_brand.updated",
      "niche_brand",
      brandId,
      before,
      after,
    );
    return after!;
  });
}

export async function setBrandActive(
  db: Db,
  session: AuthSession,
  brandId: string,
  active: boolean,
): Promise<void> {
  if (!canManageNicheBrands(session)) {
    throw new AuthorizationError("Only an Admin can deactivate or reactivate brands");
  }
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [before] = await tx
      .select()
      .from(schema.nicheBrands)
      .where(eq(schema.nicheBrands.id, brandId));
    if (!before) throw new NotFoundError("Brand not found");
    await tx
      .update(schema.nicheBrands)
      .set({ active, updatedAt: new Date() })
      .where(eq(schema.nicheBrands.id, brandId));
    await audit(
      tx,
      session.userId,
      "niche_brand.deactivated",
      "niche_brand",
      brandId,
      { active: before.active },
      { active },
    );
  });
}

/**
 * Admin merge of duplicate brands (decision D10): moves assessments and brief
 * links to the surviving brand, deactivates the duplicate, records the merge.
 * Existing decisions keep their niche_snapshot, so nothing is re-explained.
 */
export async function mergeBrands(
  db: Db,
  session: AuthSession,
  input: { duplicateId: string; survivorId: string },
): Promise<void> {
  if (!canManageNicheBrands(session))
    throw new AuthorizationError("Only an Admin can merge brands");
  if (input.duplicateId === input.survivorId)
    throw new ValidationError("Choose two different brands");
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const rows = await tx
      .select()
      .from(schema.nicheBrands)
      .where(inArray(schema.nicheBrands.id, [input.duplicateId, input.survivorId]));
    const dup = rows.find((r) => r.id === input.duplicateId);
    const survivor = rows.find((r) => r.id === input.survivorId);
    if (!dup || !survivor) throw new NotFoundError("Brand not found");
    if (dup.mergedIntoId) throw new ValidationError("That brand has already been merged");
    if (survivor.mergedIntoId || !survivor.active) {
      throw new ValidationError(
        "The surviving brand must be active and not itself merged",
      );
    }
    const moved = await tx
      .update(schema.nicheAssessments)
      .set({ brandId: survivor.id })
      .where(eq(schema.nicheAssessments.brandId, dup.id))
      .returning({ id: schema.nicheAssessments.id });
    const briefsMoved = await tx
      .update(schema.briefs)
      .set({ nicheBrandId: survivor.id })
      .where(eq(schema.briefs.nicheBrandId, dup.id))
      .returning({ id: schema.briefs.id });
    await tx
      .update(schema.nicheBrands)
      .set({ active: false, mergedIntoId: survivor.id, updatedAt: new Date() })
      .where(eq(schema.nicheBrands.id, dup.id));
    await audit(tx, session.userId, "niche_brand.merged", "niche_brand", dup.id, dup, {
      mergedInto: survivor.id,
      assessmentsMoved: moved.length,
      briefsMoved: briefsMoved.length,
    });
  });
}

// ---------------------------------------------------------------------------
// Assessment: current-assessment lookup
// ---------------------------------------------------------------------------

/** Most recent approved, non-expired assessment for a brand, or null. */
export async function getCurrentAssessment(
  db: Db,
  brandId: string,
  today: string = todayLondon(),
): Promise<Assessment | null> {
  const [row] = await db
    .select()
    .from(schema.nicheAssessments)
    .where(
      and(
        eq(schema.nicheAssessments.brandId, brandId),
        eq(schema.nicheAssessments.status, "approved"),
        gte(schema.nicheAssessments.validUntil, today),
      ),
    )
    .orderBy(desc(schema.nicheAssessments.reviewedAt))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Assessment lifecycle
// ---------------------------------------------------------------------------

async function nextReference(tx: Db, year: string): Promise<string> {
  const [last] = await tx
    .select({ reference: schema.nicheAssessments.reference })
    .from(schema.nicheAssessments)
    .where(sql`${schema.nicheAssessments.reference} LIKE ${`NBA-${year}-%`}`)
    .orderBy(desc(schema.nicheAssessments.reference))
    .limit(1);
  const n = last ? Number(last.reference.split("-")[2]) + 1 : 1;
  return `NBA-${year}-${String(n).padStart(4, "0")}`;
}

export async function createAssessmentDraft(
  db: Db,
  session: AuthSession,
  input: { brandId: string; assessmentDate?: string },
): Promise<Assessment> {
  requireEditor(session);
  const today = todayLondon();
  const date = input.assessmentDate ?? today;
  if (date > today)
    throw new ValidationError("The assessment date cannot be in the future");
  const fw = await getPublishedFramework(db);
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [brand] = await tx
      .select()
      .from(schema.nicheBrands)
      .where(eq(schema.nicheBrands.id, input.brandId));
    if (!brand) throw new NotFoundError("Brand not found");
    if (!brand.active) throw new ValidationError("This brand is deactivated");
    const [row] = await tx
      .insert(schema.nicheAssessments)
      .values({
        reference: await nextReference(tx, today.slice(0, 4)),
        brandId: brand.id,
        frameworkId: fw.id,
        assessorId: session.userId,
        assessmentDate: date,
      })
      .returning();
    await audit(
      tx,
      session.userId,
      "niche_assessment.created",
      "niche_assessment",
      row!.id,
      null,
      row,
    );
    return row!;
  });
}

async function loadOwnDraft(
  tx: Db,
  session: AuthSession,
  id: string,
): Promise<Assessment> {
  const [a] = await tx
    .select()
    .from(schema.nicheAssessments)
    .where(eq(schema.nicheAssessments.id, id));
  if (!a) throw new NotFoundError("Assessment not found");
  if (a.assessorId !== session.userId) {
    throw new AuthorizationError("Only the assessor can change this assessment");
  }
  return a;
}

export interface DraftInput {
  answers: NicheAnswers;
  reviewerComment?: string | null;
  assessmentDate?: string;
}

export async function saveAssessmentDraft(
  db: Db,
  session: AuthSession,
  id: string,
  input: DraftInput,
): Promise<Assessment> {
  requireEditor(session);
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const before = await loadOwnDraft(tx, session, id);
    if (before.status !== "draft")
      throw new ValidationError("Only a draft can be edited");
    const fw = await frameworkById(tx, before.frameworkId);
    scoreNicheAssessment(input.answers, fw.payload); // throws on unknown key / bad value
    const date = input.assessmentDate ?? before.assessmentDate;
    if (date > todayLondon())
      throw new ValidationError("The assessment date cannot be in the future");
    const [after] = await tx
      .update(schema.nicheAssessments)
      .set({
        answers: input.answers,
        reviewerComment: input.reviewerComment?.trim() || null,
        assessmentDate: date,
        updatedAt: new Date(),
      })
      .where(eq(schema.nicheAssessments.id, id))
      .returning();
    await audit(
      tx,
      session.userId,
      "niche_assessment.updated",
      "niche_assessment",
      id,
      before,
      after,
    );
    return after!;
  });
}

async function activeHolderIds(tx: Db, roleKey: string, day: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: schema.roleHolders.userId })
    .from(schema.roleHolders)
    .innerJoin(schema.users, eq(schema.users.id, schema.roleHolders.userId))
    .where(
      and(
        eq(schema.roleHolders.roleKey, roleKey),
        eq(schema.users.active, true),
        lte(schema.roleHolders.effectiveFrom, day),
        or(
          isNull(schema.roleHolders.effectiveTo),
          gte(schema.roleHolders.effectiveTo, day),
        ),
      ),
    );
  return [...new Set(rows.map((r) => r.userId))];
}

/**
 * Submit for review. Requires every criterion answered. If every current
 * holder of the reviewer role is the assessor, the assessment is escalated to
 * Admin (same shape as shouldEscalateRequirement); with no holders at all it is
 * not escalated, since that is a role-mapping gap for an Admin to fix.
 */
export async function submitAssessment(
  db: Db,
  session: AuthSession,
  id: string,
  input?: DraftInput,
): Promise<Assessment> {
  requireEditor(session);
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const before = await loadOwnDraft(tx, session, id);
    if (before.status !== "draft")
      throw new ValidationError("Only a draft can be submitted");
    const fw = await frameworkById(tx, before.frameworkId);
    const answers = (input?.answers ?? before.answers) as NicheAnswers;
    const result = scoreNicheAssessment(answers, fw.payload);
    if (!result.complete) {
      throw new ValidationError(
        `Answer every criterion before submitting (${result.answeredCount} of ${result.totalCount} answered)`,
      );
    }
    const date = input?.assessmentDate ?? before.assessmentDate;
    if (date > todayLondon())
      throw new ValidationError("The assessment date cannot be in the future");

    const holders = await activeHolderIds(tx, fw.payload.reviewerRoleKey, todayLondon());
    const escalate = holders.length > 0 && holders.every((h) => h === session.userId);

    const [after] = await tx
      .update(schema.nicheAssessments)
      .set({
        status: "submitted",
        answers,
        score: result.score,
        sectionScores: result.sectionScores,
        band: result.band,
        reviewerComment:
          (input ? input.reviewerComment : before.reviewerComment)?.trim() || null,
        assessmentDate: date,
        submittedAt: new Date(),
        escalatedAt: escalate ? new Date() : null,
        escalationReason: escalate
          ? "Every current holder of the reviewer role is the assessor"
          : null,
        updatedAt: new Date(),
      })
      .where(eq(schema.nicheAssessments.id, id))
      .returning();
    await audit(
      tx,
      session.userId,
      "niche_assessment.submitted",
      "niche_assessment",
      id,
      before,
      after,
    );
    if (escalate) {
      await audit(
        tx,
        session.userId,
        "niche_assessment.escalated_to_admin",
        "niche_assessment",
        id,
        null,
        {
          reason: after!.escalationReason,
          reviewerRoleKey: fw.payload.reviewerRoleKey,
        },
      );
    }
    return after!;
  });
}

/** Withdraw own submitted assessment (back out before a decision is made). */
export async function withdrawAssessment(
  db: Db,
  session: AuthSession,
  id: string,
): Promise<Assessment> {
  requireEditor(session);
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const before = await loadOwnDraft(tx, session, id);
    if (before.status !== "submitted" && before.status !== "draft") {
      throw new ValidationError("Only a draft or submitted assessment can be withdrawn");
    }
    const [after] = await tx
      .update(schema.nicheAssessments)
      .set({ status: "withdrawn", updatedAt: new Date() })
      .where(eq(schema.nicheAssessments.id, id))
      .returning();
    await audit(
      tx,
      session.userId,
      "niche_assessment.withdrawn",
      "niche_assessment",
      id,
      before,
      after,
    );
    return after!;
  });
}

export interface ReviewInput {
  decision: "approve" | "reject";
  comment?: string | null;
}

export async function reviewAssessment(
  db: Db,
  session: AuthSession,
  id: string,
  input: ReviewInput,
): Promise<Assessment> {
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [before] = await tx
      .select()
      .from(schema.nicheAssessments)
      .where(eq(schema.nicheAssessments.id, id))
      .for("update");
    if (!before) throw new NotFoundError("Assessment not found");
    if (before.status !== "submitted")
      throw new ValidationError("Only a submitted assessment can be reviewed");
    const fw = await frameworkById(tx, before.frameworkId);
    requireCanReviewNicheAssessment(
      session,
      { assessorId: before.assessorId, escalated: before.escalatedAt !== null },
      fw.payload.reviewerRoleKey,
    );
    const comment = input.comment?.trim() || null;
    const now = new Date();

    if (input.decision === "reject") {
      if (!comment)
        throw new ValidationError("A comment is required when rejecting an assessment");
      const [after] = await tx
        .update(schema.nicheAssessments)
        .set({
          status: "rejected",
          reviewedBy: session.userId,
          reviewedAt: now,
          reviewComment: comment,
          updatedAt: now,
        })
        .where(eq(schema.nicheAssessments.id, id))
        .returning();
      await audit(
        tx,
        session.userId,
        "niche_assessment.rejected",
        "niche_assessment",
        id,
        before,
        after,
      );
      return after!;
    }

    const today = todayLondon(now);
    const previous = await getCurrentAssessment(tx, before.brandId, today);
    const [after] = await tx
      .update(schema.nicheAssessments)
      .set({
        status: "approved",
        reviewedBy: session.userId,
        reviewedAt: now,
        reviewComment: comment,
        validUntil: addMonthsIso(today, fw.payload.validityMonths),
        supersedesId: previous?.id ?? null,
        updatedAt: now,
      })
      .where(eq(schema.nicheAssessments.id, id))
      .returning();
    await audit(
      tx,
      session.userId,
      "niche_assessment.approved",
      "niche_assessment",
      id,
      before,
      after,
    );
    if (previous) {
      await audit(
        tx,
        session.userId,
        "niche_assessment.superseded",
        "niche_assessment",
        previous.id,
        null,
        {
          supersededBy: id,
        },
      );
    }
    return after!;
  });
}

export { isAssessmentCurrent };
