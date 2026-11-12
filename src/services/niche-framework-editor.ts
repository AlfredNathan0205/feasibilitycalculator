/**
 * Niche framework versions — build spec §10. Mirrors rule-set-editor.ts:
 * a published framework is immutable (editing creates a new draft), a draft can
 * be replayed over historical assessments (read only) before it is published,
 * and publishing supersedes the previous version without recalculating any
 * existing assessment.
 */
import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import {
  AuthorizationError,
  canManageNicheFrameworks,
  type AuthSession,
} from "../auth/authz.js";
import {
  scoreNicheAssessment,
  validateNicheFramework,
  type NicheAnswers,
  type NicheBand,
  type NicheFrameworkPayload,
} from "../engine/niche-assessment.js";
import { NotFoundError, ValidationError } from "./decide-requirement.js";

type Db = PostgresJsDatabase<typeof schema>;

function requireManager(session: AuthSession) {
  if (!canManageNicheFrameworks(session)) {
    throw new AuthorizationError("Only an Admin can manage niche frameworks");
  }
}

async function audit(
  tx: Db,
  actorId: string,
  action: string,
  entityId: string,
  before: unknown,
  after: unknown,
) {
  await tx.insert(schema.auditEvents).values({
    actorId,
    action,
    entityType: "niche_framework",
    entityId,
    before: before ?? null,
    after: after ?? null,
    requestCorrelationId: crypto.randomUUID(),
  });
}

export async function listFrameworks(db: Db) {
  return db
    .select()
    .from(schema.nicheFrameworks)
    .orderBy(desc(schema.nicheFrameworks.version));
}

export async function getFramework(db: Db, id: string) {
  const [fw] = await db
    .select()
    .from(schema.nicheFrameworks)
    .where(eq(schema.nicheFrameworks.id, id));
  return fw ? { ...fw, payload: fw.payload as NicheFrameworkPayload } : null;
}

export async function listApprovalAuthorityRoleKeys(
  db: Db,
): Promise<Array<{ key: string; displayName: string }>> {
  return db
    .select({ key: schema.roles.key, displayName: schema.roles.displayName })
    .from(schema.roles)
    .where(eq(schema.roles.category, "approval_authority"))
    .orderBy(asc(schema.roles.displayName));
}

/** New draft cloned from the published framework (or the latest version if none is published). */
export async function createDraftFramework(
  db: Db,
  session: AuthSession,
): Promise<{ id: string; version: number }> {
  requireManager(session);
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [existing] = await tx
      .select()
      .from(schema.nicheFrameworks)
      .where(eq(schema.nicheFrameworks.status, "draft"))
      .limit(1);
    if (existing)
      throw new ValidationError(
        `Draft version ${existing.version} already exists; edit or publish it first`,
      );
    const [base] = await tx
      .select()
      .from(schema.nicheFrameworks)
      .where(eq(schema.nicheFrameworks.status, "published"))
      .limit(1);
    if (!base) throw new NotFoundError("No published niche framework to base a draft on");
    const [maxRow] = await tx
      .select({ v: max(schema.nicheFrameworks.version) })
      .from(schema.nicheFrameworks);
    const [draft] = await tx
      .insert(schema.nicheFrameworks)
      .values({
        version: (maxRow?.v ?? 0) + 1,
        status: "draft",
        payload: base.payload,
        sourceNote: `Draft based on version ${base.version}`,
        createdBy: session.userId,
      })
      .returning();
    await audit(tx, session.userId, "niche_framework.created", draft!.id, null, {
      version: draft!.version,
      basedOn: base.version,
    });
    return { id: draft!.id, version: draft!.version };
  });
}

/** Keys used by any earlier framework version but absent from the base version may not come back. */
async function checkKeyReuse(
  tx: Db,
  draftVersion: number,
  payload: NicheFrameworkPayload,
): Promise<string[]> {
  const earlier = await tx
    .select()
    .from(schema.nicheFrameworks)
    .where(and(inArray(schema.nicheFrameworks.status, ["published", "superseded"])));
  const base = [...earlier]
    .sort((a, b) => b.version - a.version)
    .find((f) => f.version < draftVersion);
  const baseKeys = new Set(
    base
      ? (base.payload as NicheFrameworkPayload).sections.flatMap((s) =>
          s.criteria.map((c) => c.key),
        )
      : [],
  );
  const everUsed = new Set(
    earlier.flatMap((f) =>
      (f.payload as NicheFrameworkPayload).sections.flatMap((s) =>
        s.criteria.map((c) => c.key),
      ),
    ),
  );
  const errors: string[] = [];
  for (const key of payload.sections.flatMap((s) => s.criteria.map((c) => c.key))) {
    if (everUsed.has(key) && !baseKeys.has(key)) {
      errors.push(
        `Criterion key "${key}" was used before and removed; a replacement needs a new key`,
      );
    }
  }
  return errors;
}

export async function updateDraftFramework(
  db: Db,
  session: AuthSession,
  id: string,
  payload: NicheFrameworkPayload,
): Promise<void> {
  requireManager(session);
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [fw] = await tx
      .select()
      .from(schema.nicheFrameworks)
      .where(eq(schema.nicheFrameworks.id, id))
      .for("update");
    if (!fw) throw new NotFoundError("Framework not found");
    if (fw.status !== "draft") {
      throw new ValidationError(
        `Framework is "${fw.status}", not draft: published frameworks are immutable`,
      );
    }
    const roleKeys = (await listApprovalAuthorityRoleKeys(tx)).map((r) => r.key);
    const errors = [
      ...validateNicheFramework(payload, roleKeys),
      ...(await checkKeyReuse(tx, fw.version, payload)),
    ];
    if (errors.length) throw new ValidationError(errors.join("; "));
    await tx
      .update(schema.nicheFrameworks)
      .set({ payload })
      .where(eq(schema.nicheFrameworks.id, id));
    await audit(
      tx,
      session.userId,
      "niche_framework.updated",
      id,
      { payload: fw.payload },
      { payload },
    );
  });
}

export interface NicheReplayChange {
  assessmentId: string;
  reference: string;
  brandName: string;
  status: string;
  fromBand: NicheBand;
  fromScore: number;
  toBand: NicheBand | null;
  toScore: number;
}

export interface NicheReplayResult {
  totalEvaluated: number;
  changes: NicheReplayChange[];
  /** Criteria present in history but missing from the draft count as "no" and are listed here. */
  warnings: string[];
}

/** Read-only: re-scores every submitted, approved or rejected assessment from its stored answers. */
export async function replayFramework(db: Db, id: string): Promise<NicheReplayResult> {
  const fw = await getFramework(db, id);
  if (!fw) throw new NotFoundError("Framework not found");
  const rows = await db
    .select({ a: schema.nicheAssessments, brandName: schema.nicheBrands.name })
    .from(schema.nicheAssessments)
    .innerJoin(
      schema.nicheBrands,
      eq(schema.nicheBrands.id, schema.nicheAssessments.brandId),
    )
    .where(
      inArray(schema.nicheAssessments.status, ["submitted", "approved", "rejected"]),
    );
  const draftKeys = new Set(
    fw.payload.sections.flatMap((s) => s.criteria.map((c) => c.key)),
  );
  const changes: NicheReplayChange[] = [];
  const missing = new Set<string>();
  for (const { a, brandName } of rows) {
    const stored = a.answers as NicheAnswers;
    const answers: NicheAnswers = {};
    for (const [k, v] of Object.entries(stored)) {
      if (draftKeys.has(k)) answers[k] = v;
      else missing.add(k);
    }
    // Criteria new in the draft have no historical answer: count as "no" for replay.
    for (const k of draftKeys) answers[k] ??= "no";
    const r = scoreNicheAssessment(answers, fw.payload);
    if (r.band !== a.band || r.score !== a.score) {
      changes.push({
        assessmentId: a.id,
        reference: a.reference,
        brandName,
        status: a.status,
        fromBand: a.band!,
        fromScore: a.score!,
        toBand: r.band,
        toScore: r.score,
      });
    }
  }
  const warnings = [...missing].map(
    (k) =>
      `Criterion "${k}" appears in past assessments but not in this draft; it is ignored in the replay`,
  );
  return { totalEvaluated: rows.length, changes, warnings };
}

export async function recordReplay(
  db: Db,
  session: AuthSession,
  id: string,
): Promise<NicheReplayResult> {
  requireManager(session);
  const result = await replayFramework(db, id);
  await audit(db, session.userId, "niche_framework.replayed", id, null, {
    totalEvaluated: result.totalEvaluated,
    changed: result.changes.length,
  });
  return result;
}

/** Publishes a draft: validates, supersedes the previous published version. Existing assessments are untouched. */
export async function publishFramework(
  db: Db,
  session: AuthSession,
  id: string,
): Promise<void> {
  requireManager(session);
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [fw] = await tx
      .select()
      .from(schema.nicheFrameworks)
      .where(eq(schema.nicheFrameworks.id, id))
      .for("update");
    if (!fw) throw new NotFoundError("Framework not found");
    if (fw.status !== "draft") throw new ValidationError("Only a draft can be published");
    const payload = fw.payload as NicheFrameworkPayload;
    const roleKeys = (await listApprovalAuthorityRoleKeys(tx)).map((r) => r.key);
    const errors = [
      ...validateNicheFramework(payload, roleKeys),
      ...(await checkKeyReuse(tx, fw.version, payload)),
    ];
    if (errors.length) throw new ValidationError(errors.join("; "));
    const now = new Date();
    const [prev] = await tx
      .select()
      .from(schema.nicheFrameworks)
      .where(eq(schema.nicheFrameworks.status, "published"))
      .for("update");
    if (prev) {
      await tx
        .update(schema.nicheFrameworks)
        .set({ status: "superseded", supersededAt: now })
        .where(eq(schema.nicheFrameworks.id, prev.id));
    }
    await tx
      .update(schema.nicheFrameworks)
      .set({ status: "published", publishedBy: session.userId, publishedAt: now })
      .where(eq(schema.nicheFrameworks.id, id));
    await audit(
      tx,
      session.userId,
      "niche_framework.published",
      id,
      { status: "draft" },
      { status: "published", version: fw.version, supersedes: prev?.version ?? null },
    );
  });
}

export async function discardDraftFramework(
  db: Db,
  session: AuthSession,
  id: string,
): Promise<void> {
  requireManager(session);
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [fw] = await tx
      .select()
      .from(schema.nicheFrameworks)
      .where(eq(schema.nicheFrameworks.id, id));
    if (!fw) throw new NotFoundError("Framework not found");
    if (fw.status !== "draft") throw new ValidationError("Only a draft can be discarded");
    await tx.delete(schema.nicheFrameworks).where(eq(schema.nicheFrameworks.id, id));
    await audit(
      tx,
      session.userId,
      "niche_framework.discarded",
      id,
      { version: fw.version },
      null,
    );
  });
}
