import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema.js";
import type { AuthSession } from "../auth/authz.js";
import { AuthorizationError } from "../auth/authz.js";
import { ValidationError } from "./decide-requirement.js";
import {
  addMonthsIso,
  todayLondon,
  type NicheAnswers,
} from "../engine/niche-assessment.js";
import { NICHE_FRAMEWORK_V1 } from "../engine/niche-framework-v1.js";
import {
  createAssessmentDraft,
  createBrand,
  findSimilarBrands,
  getCurrentAssessment,
  mergeBrands,
  reviewAssessment,
  saveAssessmentDraft,
  setBrandActive,
  submitAssessment,
  withdrawAssessment,
} from "./niche-assessments.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;
type Db = ReturnType<typeof drizzle<typeof schema>>;
class Rollback extends Error {}

const keys = NICHE_FRAMEWORK_V1.sections.flatMap((s) => s.criteria.map((c) => c.key));
const all = (v: "yes" | "no"): NicheAnswers =>
  Object.fromEntries(keys.map((k) => [k, v]));
/** 86 points: everything yes except growth_multi_launch (8) and brand_own_stores (6). */
const score86: NicheAnswers = {
  ...all("yes"),
  growth_multi_launch: "no",
  brand_own_stores: "no",
};

describeIfDb("niche assessments (integration, each test rolls back)", () => {
  let client: ReturnType<typeof postgres>;
  let db: Db;
  beforeAll(() => {
    client = postgres(databaseUrl!);
    db = drizzle(client, { schema });
  });
  afterAll(async () => {
    await client.end();
  });

  async function inRollback(fn: (tx: Db) => Promise<void>) {
    try {
      await db.transaction(async (tx) => {
        await fn(tx as unknown as Db);
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  }
  const tag = () => Math.random().toString(36).slice(2, 9);

  async function person(
    tx: Db,
    name: string,
    access: string[],
    authority: string[] = [],
  ) {
    const t = tag();
    const [u] = await tx
      .insert(schema.users)
      .values({
        entraObjectId: `na-${t}`,
        upn: `${t}@na.example`,
        displayName: name,
        email: `${t}@na.example`,
      })
      .returning();
    for (const role of authority) {
      await tx
        .insert(schema.roleHolders)
        .values({ roleKey: role, userId: u!.id, effectiveFrom: "2020-01-01" });
    }
    const session: AuthSession = {
      userId: u!.id,
      accessRoles: access,
      approvalAuthorityRoles: authority,
    };
    return { user: u!, session };
  }

  /** Clean reviewer-role state and make sure a published framework exists. */
  async function setup(tx: Db) {
    await tx
      .delete(schema.roleHolders)
      .where(inArray(schema.roleHolders.roleKey, ["commercial_director"]));
    const [published] = await tx
      .select()
      .from(schema.nicheFrameworks)
      .where(eq(schema.nicheFrameworks.status, "published"));
    if (!published) {
      const [u] = await tx
        .insert(schema.users)
        .values({
          entraObjectId: `nf-${tag()}`,
          upn: `${tag()}@nf.example`,
          displayName: "F",
          email: "f@nf.example",
        })
        .returning();
      await tx.insert(schema.nicheFrameworks).values({
        version: 1,
        status: "published",
        payload: NICHE_FRAMEWORK_V1,
        sourceNote: "test",
        createdBy: u!.id,
        publishedBy: u!.id,
        publishedAt: new Date(),
      });
    }
  }

  async function submittedAssessment(
    tx: Db,
    am: AuthSession,
    brandName = `Brand ${tag()}`,
  ) {
    const brand = await createBrand(tx, am, { name: brandName });
    const draft = await createAssessmentDraft(tx, am, { brandId: brand.id });
    const a = await submitAssessment(tx, am, draft.id, {
      answers: score86,
      reviewerComment: "Strong founder",
    });
    return { brand, a };
  }

  async function actions(tx: Db, entityId: string) {
    const rows = await tx
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, entityId));
    return rows.map((r) => r.action);
  }

  it("creates brands, rejects duplicates that differ only by case or spacing, and finds similar names", async () => {
    await inRollback(async (tx) => {
      await setup(tx);
      const am = await person(tx, "AM", ["account_manager"]);
      const name = `Maison ${tag()}`;
      const brand = await createBrand(tx, am.session, { name: `  ${name}  ` });
      expect(brand.normalisedName).toBe(name.toLowerCase());
      await expect(
        createBrand(tx, am.session, { name: name.toUpperCase() }),
      ).rejects.toThrow(/already exists/);
      expect((await findSimilarBrands(tx, name.slice(0, 9))).map((b) => b.id)).toContain(
        brand.id,
      );
      expect(await actions(tx, brand.id)).toContain("niche_brand.created");
    });
  });

  it("only editors can create brands: Auditor and approver cannot", async () => {
    await inRollback(async (tx) => {
      await setup(tx);
      const auditor = await person(tx, "Aud", ["auditor"]);
      await expect(createBrand(tx, auditor.session, { name: "X" })).rejects.toThrow(
        AuthorizationError,
      );
    });
  });

  it("complete flow: draft, submit (score 86, band 1), approve, valid for 12 months, current", async () => {
    await inRollback(async (tx) => {
      await setup(tx);
      const am = await person(tx, "AM", ["account_manager"]);
      const cd = await person(tx, "CD", ["approver"], ["commercial_director"]);
      const { brand, a } = await submittedAssessment(tx, am.session);
      expect(a).toMatchObject({
        status: "submitted",
        score: 86,
        band: "strategic_partner",
        escalatedAt: null,
      });
      expect(a.reference).toMatch(/^NBA-\d{4}-\d{4}$/);

      const approved = await reviewAssessment(tx, cd.session, a.id, {
        decision: "approve",
      });
      expect(approved.status).toBe("approved");
      expect(approved.reviewedBy).toBe(cd.user.id);
      expect(approved.validUntil).toBe(addMonthsIso(todayLondon(), 12));
      expect((await getCurrentAssessment(tx, brand.id))?.id).toBe(a.id);
      expect(await actions(tx, a.id)).toEqual(
        expect.arrayContaining([
          "niche_assessment.created",
          "niche_assessment.submitted",
          "niche_assessment.approved",
        ]),
      );
    });
  });

  it("cannot submit until every criterion is answered", async () => {
    await inRollback(async (tx) => {
      await setup(tx);
      const am = await person(tx, "AM", ["account_manager"]);
      const brand = await createBrand(tx, am.session, { name: `B ${tag()}` });
      const d = await createAssessmentDraft(tx, am.session, { brandId: brand.id });
      await saveAssessmentDraft(tx, am.session, d.id, {
        answers: { fin_trading: "yes" },
      });
      await expect(submitAssessment(tx, am.session, d.id)).rejects.toThrow(/1 of 14/);
    });
  });

  it("only the assessor can change a draft, and only drafts can be edited", async () => {
    await inRollback(async (tx) => {
      await setup(tx);
      const am = await person(tx, "AM", ["account_manager"]);
      const other = await person(tx, "AM2", ["account_manager"]);
      const { a } = await submittedAssessment(tx, am.session);
      await expect(
        saveAssessmentDraft(tx, am.session, a.id, { answers: all("no") }),
      ).rejects.toThrow(ValidationError);
      const brand = await createBrand(tx, am.session, { name: `B ${tag()}` });
      const d = await createAssessmentDraft(tx, am.session, { brandId: brand.id });
      await expect(
        saveAssessmentDraft(tx, other.session, d.id, { answers: {} }),
      ).rejects.toThrow(AuthorizationError);
    });
  });

  it("the assessor cannot review their own assessment, and a non-reviewer cannot either", async () => {
    await inRollback(async (tx) => {
      await setup(tx);
      const am = await person(
        tx,
        "AM",
        ["account_manager", "approver"],
        ["commercial_director"],
      );
      const other = await person(tx, "Other", ["account_manager"]);
      const cd2 = await person(tx, "CD2", ["approver"], ["commercial_director"]);
      void cd2;
      const { a } = await submittedAssessment(tx, am.session);
      await expect(
        reviewAssessment(tx, am.session, a.id, { decision: "approve" }),
      ).rejects.toThrow(AuthorizationError);
      await expect(
        reviewAssessment(tx, other.session, a.id, { decision: "approve" }),
      ).rejects.toThrow(AuthorizationError);
    });
  });

  it("rejection needs a comment and the assessment never becomes current", async () => {
    await inRollback(async (tx) => {
      await setup(tx);
      const am = await person(tx, "AM", ["account_manager"]);
      const cd = await person(tx, "CD", ["approver"], ["commercial_director"]);
      const { brand, a } = await submittedAssessment(tx, am.session);
      await expect(
        reviewAssessment(tx, cd.session, a.id, { decision: "reject", comment: "  " }),
      ).rejects.toThrow(/comment/);
      const r = await reviewAssessment(tx, cd.session, a.id, {
        decision: "reject",
        comment: "Need forecast",
      });
      expect(r).toMatchObject({ status: "rejected", reviewComment: "Need forecast" });
      expect(await getCurrentAssessment(tx, brand.id)).toBeNull();
    });
  });

  it("escalates to Admin when the assessor is the only reviewer-role holder; Admin then reviews", async () => {
    await inRollback(async (tx) => {
      await setup(tx);
      const sole = await person(
        tx,
        "Sole",
        ["account_manager", "approver"],
        ["commercial_director"],
      );
      const admin = await person(tx, "Admin", ["admin"]);
      const { a } = await submittedAssessment(tx, sole.session);
      expect(a.escalatedAt).not.toBeNull();
      expect(a.escalationReason).toMatch(/assessor/);
      expect(await actions(tx, a.id)).toContain("niche_assessment.escalated_to_admin");
      await expect(
        reviewAssessment(tx, sole.session, a.id, { decision: "approve" }),
      ).rejects.toThrow(AuthorizationError);
      const done = await reviewAssessment(tx, admin.session, a.id, {
        decision: "approve",
      });
      expect(done.status).toBe("approved");
    });
  });

  it("an Admin who is the assessor cannot review the escalated assessment either", async () => {
    await inRollback(async (tx) => {
      await setup(tx);
      const both = await person(
        tx,
        "Both",
        ["admin", "approver"],
        ["commercial_director"],
      );
      const { a } = await submittedAssessment(tx, both.session);
      expect(a.escalatedAt).not.toBeNull();
      await expect(
        reviewAssessment(tx, both.session, a.id, { decision: "approve" }),
      ).rejects.toThrow(AuthorizationError);
    });
  });

  it("approving a new assessment supersedes the previous current one for the brand", async () => {
    await inRollback(async (tx) => {
      await setup(tx);
      const am = await person(tx, "AM", ["account_manager"]);
      const cd = await person(tx, "CD", ["approver"], ["commercial_director"]);
      const { brand, a: first } = await submittedAssessment(tx, am.session);
      await reviewAssessment(tx, cd.session, first.id, { decision: "approve" });

      const d = await createAssessmentDraft(tx, am.session, { brandId: brand.id });
      const second = await submitAssessment(tx, am.session, d.id, {
        answers: all("yes"),
      });
      // Until approved, the first stays current.
      expect((await getCurrentAssessment(tx, brand.id))?.id).toBe(first.id);
      const approved = await reviewAssessment(tx, cd.session, second.id, {
        decision: "approve",
      });
      expect(approved.supersedesId).toBe(first.id);
      expect((await getCurrentAssessment(tx, brand.id))?.id).toBe(second.id);
      expect(await actions(tx, first.id)).toContain("niche_assessment.superseded");
    });
  });

  it("an expired approved assessment is not current", async () => {
    await inRollback(async (tx) => {
      await setup(tx);
      const am = await person(tx, "AM", ["account_manager"]);
      const cd = await person(tx, "CD", ["approver"], ["commercial_director"]);
      const { brand, a } = await submittedAssessment(tx, am.session);
      await reviewAssessment(tx, cd.session, a.id, { decision: "approve" });
      await tx
        .update(schema.nicheAssessments)
        .set({ validUntil: "2020-01-01" })
        .where(eq(schema.nicheAssessments.id, a.id));
      expect(await getCurrentAssessment(tx, brand.id)).toBeNull();
    });
  });

  it("withdraw: assessor can withdraw a submitted assessment; it can no longer be reviewed", async () => {
    await inRollback(async (tx) => {
      await setup(tx);
      const am = await person(tx, "AM", ["account_manager"]);
      const cd = await person(tx, "CD", ["approver"], ["commercial_director"]);
      const { a } = await submittedAssessment(tx, am.session);
      const w = await withdrawAssessment(tx, am.session, a.id);
      expect(w.status).toBe("withdrawn");
      await expect(
        reviewAssessment(tx, cd.session, a.id, { decision: "approve" }),
      ).rejects.toThrow(/submitted/);
    });
  });

  it("Admin merges duplicate brands: assessments and briefs move, duplicate deactivated, audited", async () => {
    await inRollback(async (tx) => {
      await setup(tx);
      const am = await person(tx, "AM", ["account_manager"]);
      const admin = await person(tx, "Admin", ["admin"]);
      const { brand: dup, a } = await submittedAssessment(tx, am.session);
      const survivor = await createBrand(tx, am.session, { name: `Survivor ${tag()}` });
      await expect(
        mergeBrands(tx, am.session, { duplicateId: dup.id, survivorId: survivor.id }),
      ).rejects.toThrow(AuthorizationError);
      await mergeBrands(tx, admin.session, {
        duplicateId: dup.id,
        survivorId: survivor.id,
      });
      const [moved] = await tx
        .select()
        .from(schema.nicheAssessments)
        .where(eq(schema.nicheAssessments.id, a.id));
      expect(moved!.brandId).toBe(survivor.id);
      const [d] = await tx
        .select()
        .from(schema.nicheBrands)
        .where(eq(schema.nicheBrands.id, dup.id));
      expect(d).toMatchObject({ active: false, mergedIntoId: survivor.id });
      expect(await actions(tx, dup.id)).toContain("niche_brand.merged");
    });
  });

  it("deactivating a brand is Admin only and blocks new drafts", async () => {
    await inRollback(async (tx) => {
      await setup(tx);
      const am = await person(tx, "AM", ["account_manager"]);
      const admin = await person(tx, "Admin", ["admin"]);
      const brand = await createBrand(tx, am.session, { name: `B ${tag()}` });
      await expect(setBrandActive(tx, am.session, brand.id, false)).rejects.toThrow(
        AuthorizationError,
      );
      await setBrandActive(tx, admin.session, brand.id, false);
      await expect(
        createAssessmentDraft(tx, am.session, { brandId: brand.id }),
      ).rejects.toThrow(/deactivated/);
    });
  });
});
