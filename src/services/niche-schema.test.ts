import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { NICHE_FRAMEWORK_V1 } from "../engine/niche-framework-v1.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;
type Db = ReturnType<typeof drizzle<typeof schema>>;
class Rollback extends Error {}

describeIfDb("niche schema constraints (integration, each test rolls back)", () => {
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
  // Drizzle wraps driver errors ("Failed query"); the DB message is on .cause.
  async function rejectsWithDb(p: Promise<unknown>, re: RegExp) {
    const err = await p.then(
      () => null,
      (e: unknown) => e as { message: string; cause?: { message?: string } },
    );
    expect(err, "expected the statement to be rejected").not.toBeNull();
    expect(`${err!.message} ${err!.cause?.message ?? ""}`).toMatch(re);
  }
  const tag = () => Math.random().toString(36).slice(2, 9);

  async function fixtures(tx: Db) {
    const t = tag();
    const [u] = await tx
      .insert(schema.users)
      .values({
        entraObjectId: `nt-${t}`,
        upn: `${t}@n.example`,
        displayName: "N",
        email: `${t}@n.example`,
      })
      .returning();
    const [u2] = await tx
      .insert(schema.users)
      .values({
        entraObjectId: `nt2-${t}`,
        upn: `${t}b@n.example`,
        displayName: "N2",
        email: `${t}b@n.example`,
      })
      .returning();
    const [fw] = await tx
      .insert(schema.nicheFrameworks)
      .values({
        version: 9000 + Math.floor(Math.random() * 900000),
        status: "draft",
        payload: NICHE_FRAMEWORK_V1,
        sourceNote: "test",
        createdBy: u!.id,
      })
      .returning();
    const [brand] = await tx
      .insert(schema.nicheBrands)
      .values({ name: `B ${t}`, normalisedName: `b ${t}`, createdBy: u!.id })
      .returning();
    return { u: u!, u2: u2!, fw: fw!, brand: brand! };
  }

  const base = (f: Awaited<ReturnType<typeof fixtures>>) => ({
    reference: `NBA-T-${tag()}`,
    brandId: f.brand.id,
    frameworkId: f.fw.id,
    assessorId: f.u.id,
    assessmentDate: "2026-01-01",
  });
  const result = {
    score: 86,
    band: "strategic_partner" as const,
    sectionScores: { a: 1 },
    submittedAt: new Date(),
  };

  it("normalised brand names are unique", async () => {
    await inRollback(async (tx) => {
      const f = await fixtures(tx);
      await expect(
        tx.transaction((s) =>
          s.insert(schema.nicheBrands).values({
            name: "X",
            normalisedName: f.brand.normalisedName,
            createdBy: f.u.id,
          }),
        ),
      ).rejects.toThrow();
    });
  });

  it("only one framework can be published at a time", async () => {
    await inRollback(async (tx) => {
      const f = await fixtures(tx);
      await tx
        .update(schema.nicheFrameworks)
        .set({ status: "superseded" })
        .where(eq(schema.nicheFrameworks.status, "published"));
      await tx
        .update(schema.nicheFrameworks)
        .set({ status: "published" })
        .where(eq(schema.nicheFrameworks.id, f.fw.id));
      await expect(
        tx.transaction((s) =>
          s.insert(schema.nicheFrameworks).values({
            version: 99000000 + Math.floor(Math.random() * 1000000),
            status: "published",
            payload: NICHE_FRAMEWORK_V1,
            sourceNote: "dup",
            createdBy: f.u.id,
          }),
        ),
      ).rejects.toThrow();
    });
  });

  it("a published framework's payload is immutable", async () => {
    await inRollback(async (tx) => {
      const f = await fixtures(tx);
      await tx
        .update(schema.nicheFrameworks)
        .set({ status: "superseded" })
        .where(eq(schema.nicheFrameworks.status, "published"));
      await tx
        .update(schema.nicheFrameworks)
        .set({ status: "published" })
        .where(eq(schema.nicheFrameworks.id, f.fw.id));
      await rejectsWithDb(
        tx.transaction((s) =>
          s
            .update(schema.nicheFrameworks)
            .set({ payload: { x: 1 } })
            .where(eq(schema.nicheFrameworks.id, f.fw.id)),
        ),
        /immutable/,
      );
    });
  });

  it("submitted status requires score, band, section scores and submitted_at", async () => {
    await inRollback(async (tx) => {
      const f = await fixtures(tx);
      await expect(
        tx.transaction((s) =>
          s.insert(schema.nicheAssessments).values({ ...base(f), status: "submitted" }),
        ),
      ).rejects.toThrow();
    });
  });

  it("approved requires reviewer, reviewed_at and valid_until; rejected requires a comment", async () => {
    await inRollback(async (tx) => {
      const f = await fixtures(tx);
      await expect(
        tx.transaction((s) =>
          s
            .insert(schema.nicheAssessments)
            .values({ ...base(f), ...result, status: "approved" }),
        ),
      ).rejects.toThrow();
      await expect(
        tx.transaction((s) =>
          s
            .insert(schema.nicheAssessments)
            .values({ ...base(f), ...result, status: "rejected", reviewComment: "  " }),
        ),
      ).rejects.toThrow();
    });
  });

  it("reviewer must differ from assessor unless escalated", async () => {
    await inRollback(async (tx) => {
      const f = await fixtures(tx);
      const approved = {
        ...base(f),
        ...result,
        status: "approved" as const,
        reviewedAt: new Date(),
        validUntil: "2027-01-01",
      };
      await expect(
        tx.transaction((s) =>
          s.insert(schema.nicheAssessments).values({ ...approved, reviewedBy: f.u.id }),
        ),
      ).rejects.toThrow();
      await tx
        .insert(schema.nicheAssessments)
        .values({ ...approved, reviewedBy: f.u2.id });
      await tx.insert(schema.nicheAssessments).values({
        ...approved,
        reference: `NBA-T-${tag()}`,
        reviewedBy: f.u.id,
        escalatedAt: new Date(),
        escalationReason: "sole reviewer",
      });
    });
  });

  it("assessment date cannot be in the future", async () => {
    await inRollback(async (tx) => {
      const f = await fixtures(tx);
      await expect(
        tx.transaction((s) =>
          s
            .insert(schema.nicheAssessments)
            .values({ ...base(f), assessmentDate: "2999-01-01" }),
        ),
      ).rejects.toThrow();
    });
  });

  it("answers, score and band are frozen once submitted, but editable in draft", async () => {
    await inRollback(async (tx) => {
      const f = await fixtures(tx);
      const [a] = await tx.insert(schema.nicheAssessments).values(base(f)).returning();
      await tx
        .update(schema.nicheAssessments)
        .set({ answers: { fin_trading: "yes" } })
        .where(eq(schema.nicheAssessments.id, a!.id));
      await tx
        .update(schema.nicheAssessments)
        .set({ ...result, status: "submitted" })
        .where(eq(schema.nicheAssessments.id, a!.id));
      await rejectsWithDb(
        tx.transaction((s) =>
          s
            .update(schema.nicheAssessments)
            .set({ score: 10 })
            .where(eq(schema.nicheAssessments.id, a!.id)),
        ),
        /frozen/,
      );
      await rejectsWithDb(
        tx.transaction((s) =>
          s
            .update(schema.nicheAssessments)
            .set({ answers: {} })
            .where(eq(schema.nicheAssessments.id, a!.id)),
        ),
        /frozen/,
      );
      // Review fields remain updatable.
      await tx
        .update(schema.nicheAssessments)
        .set({ reviewComment: "ok" })
        .where(eq(schema.nicheAssessments.id, a!.id));
    });
  });

  it("brief cannot reference an assessment without a brand; non-standard route needs a rationale", async () => {
    await inRollback(async (tx) => {
      const f = await fixtures(tx);
      const [a] = await tx.insert(schema.nicheAssessments).values(base(f)).returning();
      const brief = {
        customerReference: "c",
        tier: "B",
        valuePotentialGbp: "1000",
        newRework: "New",
        briefType: "Exclusive",
        customerApproval: "Direct",
        creativeApproach: "Library Only",
        deadline: "2999-01-01",
        submittedBy: f.u.id,
      };
      await expect(
        tx.transaction((s) =>
          s.insert(schema.briefs).values({ ...brief, nicheAssessmentId: a!.id }),
        ),
      ).rejects.toThrow();
      await expect(
        tx.transaction((s) =>
          s
            .insert(schema.briefs)
            .values({ ...brief, nicheBrandId: f.brand.id, nicheRoute: "charging_model" }),
        ),
      ).rejects.toThrow();
      await tx
        .insert(schema.briefs)
        .values({ ...brief, nicheBrandId: f.brand.id, nicheRoute: "standard" });
      await tx.insert(schema.briefs).values({
        ...brief,
        nicheBrandId: f.brand.id,
        nicheAssessmentId: a!.id,
        nicheRoute: "charging_model",
        nicheRouteRationale: "Charge for development",
      });
    });
  });
});
