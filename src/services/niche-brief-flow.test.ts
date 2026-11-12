import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema.js";
import type { AuthSession } from "../auth/authz.js";
import type { RuleSetPayload } from "../engine/scoring.js";
import { addNicheRouting } from "../engine/niche-rollout.js";
import { NICHE_FRAMEWORK_V1 } from "../engine/niche-framework-v1.js";
import type { NicheAnswers } from "../engine/niche-assessment.js";
import { createBrief } from "./create-brief.js";
import { decideRequirement } from "./decide-requirement.js";
import { createNicheRoutingDraft } from "./niche-rollout.js";
import { createDraftRuleSet, replayRuleSet } from "./rule-set-editor.js";
import {
  createAssessmentDraft,
  createBrand,
  reviewAssessment,
  submitAssessment,
} from "./niche-assessments.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;
type Db = ReturnType<typeof drizzle<typeof schema>>;
class Rollback extends Error {}

const keys = NICHE_FRAMEWORK_V1.sections.flatMap((s) => s.criteria.map((c) => c.key));
const only = (yes: string[]): NicheAnswers =>
  Object.fromEntries(keys.map((k) => [k, yes.includes(k) ? "yes" : "no"]));
const BAND = {
  1: only(keys.filter((k) => !["growth_multi_launch", "brand_own_stores"].includes(k))), // 86
  2: only([
    "fin_100k_3y",
    "fin_50k_2y",
    "fin_forecast_12m",
    "brand_founder",
    "growth_investors",
    "growth_distribution",
  ]), // 59
  3: only(["fin_100k_3y", "fin_50k_2y", "growth_investors"]), // 35
  4: only([]), // 0
};

describeIfDb(
  "niche assessment flows into brands (integration, each test rolls back)",
  () => {
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
          entraObjectId: `nb-${t}`,
          upn: `${t}@nb.example`,
          displayName: name,
          email: `${t}@nb.example`,
        })
        .returning();
      for (const role of authority) {
        await tx
          .insert(schema.roleHolders)
          .values({ roleKey: role, userId: u!.id, effectiveFrom: "2020-01-01" });
      }
      return {
        user: u!,
        session: {
          userId: u!.id,
          accessRoles: access,
          approvalAuthorityRoles: authority,
        } as AuthSession,
      };
    }

    /** Published rule set with the niche routing enabled (rolled back), a published framework, no stray holders. */
    async function setup(tx: Db) {
      await tx
        .delete(schema.roleHolders)
        .where(
          inArray(schema.roleHolders.roleKey, [
            "commercial_director",
            "development_director",
          ]),
        );
      const [rs] = await tx
        .select()
        .from(schema.ruleSets)
        .where(eq(schema.ruleSets.status, "published"));
      await tx
        .update(schema.ruleSets)
        .set({
          payload: addNicheRouting(rs!.payload as RuleSetPayload, { enable: true }),
        })
        .where(eq(schema.ruleSets.id, rs!.id));
      const [fw] = await tx
        .select()
        .from(schema.nicheFrameworks)
        .where(eq(schema.nicheFrameworks.status, "published"));
      if (!fw) {
        await tx.insert(schema.nicheFrameworks).values({
          version: 1,
          status: "published",
          payload: NICHE_FRAMEWORK_V1,
          sourceNote: "test",
          createdBy: rs!.createdBy,
          publishedBy: rs!.createdBy,
          publishedAt: new Date(),
        });
      }
    }

    async function approvedBrand(
      tx: Db,
      am: AuthSession,
      cd: AuthSession,
      band: 1 | 2 | 3 | 4,
    ) {
      const brand = await createBrand(tx, am, { name: `Brand ${tag()}` });
      const d = await createAssessmentDraft(tx, am, { brandId: brand.id });
      const a = await submitAssessment(tx, am, d.id, { answers: BAND[band] });
      const approved = await reviewAssessment(tx, cd, a.id, { decision: "approve" });
      return { brand, assessment: approved };
    }

    function deadline() {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 60);
      return d;
    }
    // A brief that scores comfortably "pending" so niche effects are visible.
    function brief(submittedBy: string, over: Record<string, unknown> = {}) {
      return {
        customerReference: `NB-${tag()}`,
        tier: "C",
        valuePotentialGbp: 20_000,
        newRework: "New",
        briefType: "Exclusive",
        customerApproval: "Direct",
        nicheFfPreApproved: false,
        strategicPriority: false,
        creativeApproach: "Library Only",
        marketingFlag: false,
        ppdFlag: false,
        gcmsFlag: false,
        deadline: deadline(),
        submittedBy,
        ...over,
      } as Parameters<typeof createBrief>[1];
    }
    async function fixture(tx: Db, band: 1 | 2 | 3 | 4) {
      await setup(tx);
      const am = await person(tx, "AM", ["account_manager"]);
      const cd = await person(tx, "CD", ["approver"], ["commercial_director"]);
      const dd = await person(tx, "DD", ["approver"], ["development_director"]);
      const { brand, assessment } = await approvedBrand(tx, am.session, cd.session, band);
      return { am, cd, dd, brand, assessment };
    }
    const requirements = (tx: Db, briefId: string) =>
      tx
        .select()
        .from(schema.approvalRequirements)
        .where(eq(schema.approvalRequirements.briefId, briefId));

    it("band 1: brief is auto-approved via the assessment; rationale and snapshot are stored", async () => {
      await inRollback(async (tx) => {
        const { am, brand, assessment } = await fixture(tx, 1);
        const r = await createBrief(
          tx,
          brief(am.user.id, { valuePotentialGbp: 1, tier: "D", nicheBrandId: brand.id }),
        );
        expect(r.commercialDecision).toBe("auto_approved");
        const [b] = await tx
          .select()
          .from(schema.briefs)
          .where(eq(schema.briefs.id, r.briefId));
        expect(b).toMatchObject({
          nicheFfPreApproved: true,
          nicheRoute: "standard",
          nicheAssessmentId: assessment.id,
          fineFragranceManualFlag: false,
        });
        expect(b!.nicheFfRationale).toContain(assessment.reference);
        const [d] = await tx
          .select()
          .from(schema.decisions)
          .where(eq(schema.decisions.briefId, r.briefId));
        expect(d!.nicheSnapshot).toMatchObject({
          assessmentId: assessment.id,
          reference: assessment.reference,
          score: 86,
          band: "strategic_partner",
          route: "standard",
          frameworkVersion: expect.any(Number),
        });
      });
    });

    it("a later approval of a new assessment never changes an existing brief or decision", async () => {
      await inRollback(async (tx) => {
        const { am, cd, brand, assessment } = await fixture(tx, 1);
        const r = await createBrief(tx, brief(am.user.id, { nicheBrandId: brand.id }));
        const d2 = await createAssessmentDraft(tx, am.session, { brandId: brand.id });
        const a2 = await submitAssessment(tx, am.session, d2.id, { answers: BAND[4] });
        await reviewAssessment(tx, cd.session, a2.id, { decision: "approve" });
        const [b] = await tx
          .select()
          .from(schema.briefs)
          .where(eq(schema.briefs.id, r.briefId));
        const [d] = await tx
          .select()
          .from(schema.decisions)
          .where(eq(schema.decisions.briefId, r.briefId));
        expect(b!.nicheAssessmentId).toBe(assessment.id);
        expect(d!.commercialDecision).toBe("auto_approved");
        expect((d!.nicheSnapshot as { band: string }).band).toBe("strategic_partner");
      });
    });

    it("band 2: raises the Commercial Director requirement; approving it clears the brief and issues the code", async () => {
      await inRollback(async (tx) => {
        const { am, cd, brand } = await fixture(tx, 2);
        const r = await createBrief(
          tx,
          brief(am.user.id, {
            nicheBrandId: brand.id,
            valuePotentialGbp: 400_000,
            tier: "A",
          }),
        );
        const reqs = await requirements(tx, r.briefId);
        const niche = reqs.find((x) => x.requirementType === "niche_growth_partner");
        expect(niche).toMatchObject({
          requiredRoleKey: "commercial_director",
          state: "pending",
        });
        expect(r.commercialDecision).toBe("auto_approved");
        expect(r.approvalCode).toBeNull(); // sign-off outstanding: never a bare auto-approval
        const done = await decideRequirement(tx, {
          requirementId: niche!.id,
          decidedBy: cd.user.id,
          decision: "approve",
        });
        expect(done).toMatchObject({ finalStatus: "approved", codeJustIssued: true });
      });
    });

    it("band 3: a route must be chosen; junior perfumer development raises the Development Director requirement", async () => {
      await inRollback(async (tx) => {
        const { am, brand } = await fixture(tx, 3);
        await expect(
          createBrief(tx, brief(am.user.id, { nicheBrandId: brand.id })),
        ).rejects.toThrow(/route/i);
        const r = await createBrief(
          tx,
          brief(am.user.id, {
            nicheBrandId: brand.id,
            nicheRoute: "junior_perfumer_development",
            nicheRouteRationale: "Founder keen on mentoring",
          }),
        );
        const reqs = await requirements(tx, r.briefId);
        expect(
          reqs.find((x) => x.requirementType === "niche_development_route"),
        ).toMatchObject({ requiredRoleKey: "development_director" });
        const [b] = await tx
          .select()
          .from(schema.briefs)
          .where(eq(schema.briefs.id, r.briefId));
        expect(b).toMatchObject({
          nicheRoute: "junior_perfumer_development",
          nicheRouteRationale: "Founder keen on mentoring",
          nicheFfPreApproved: false,
        });
      });
    });

    it("band 3 with the charging model raises the Commercial Director charging model requirement", async () => {
      await inRollback(async (tx) => {
        const { am, brand } = await fixture(tx, 3);
        const r = await createBrief(
          tx,
          brief(am.user.id, {
            nicheBrandId: brand.id,
            nicheRoute: "charging_model",
            nicheRouteRationale: "Charge for development",
          }),
        );
        const reqs = await requirements(tx, r.briefId);
        expect(
          reqs.find((x) => x.requirementType === "niche_charging_model"),
        ).toMatchObject({ requiredRoleKey: "commercial_director" });
      });
    });

    it("band 4 with decline gives a declined brief; with charging model it is scored normally", async () => {
      await inRollback(async (tx) => {
        const { am, brand } = await fixture(tx, 4);
        const declined = await createBrief(
          tx,
          brief(am.user.id, {
            nicheBrandId: brand.id,
            nicheRoute: "decline",
            nicheRouteRationale: "Not viable",
            valuePotentialGbp: 900_000,
            tier: "A",
          }),
        );
        expect(declined).toMatchObject({
          commercialDecision: "declined",
          finalStatus: "declined",
        });
        const charged = await createBrief(
          tx,
          brief(am.user.id, {
            nicheBrandId: brand.id,
            nicheRoute: "charging_model",
            nicheRouteRationale: "Charge",
            valuePotentialGbp: 900_000,
            tier: "A",
          }),
        );
        expect(charged.commercialDecision).not.toBe("declined");
      });
    });

    it("a rework of a selling product is not declined by a band 4 decline", async () => {
      await inRollback(async (tx) => {
        const { am, brand } = await fixture(tx, 4);
        const r = await createBrief(
          tx,
          brief(am.user.id, {
            nicheBrandId: brand.id,
            nicheRoute: "decline",
            nicheRouteRationale: "Not viable",
            newRework: "Rework (Of Selling)",
          }),
        );
        expect(r.commercialDecision).toBe("auto_approved");
      });
    });

    it("niche brand with no current approved assessment is scored as a standard brief with a warning", async () => {
      await inRollback(async (tx) => {
        await setup(tx);
        const am = await person(tx, "AM", ["account_manager"]);
        const brand = await createBrand(tx, am.session, { name: `Bare ${tag()}` });
        const r = await createBrief(tx, brief(am.user.id, { nicheBrandId: brand.id }));
        expect(r.nicheWarning).toBe("no_current_assessment");
        const [b] = await tx
          .select()
          .from(schema.briefs)
          .where(eq(schema.briefs.id, r.briefId));
        expect(b).toMatchObject({
          nicheBrandId: brand.id,
          nicheAssessmentId: null,
          nicheFfPreApproved: false,
        });
      });
    });

    it("an expired assessment gives the warning and scores as standard", async () => {
      await inRollback(async (tx) => {
        const { am, brand, assessment } = await fixture(tx, 1);
        await tx
          .update(schema.nicheAssessments)
          .set({ validUntil: "2020-01-01" })
          .where(eq(schema.nicheAssessments.id, assessment.id));
        const r = await createBrief(
          tx,
          brief(am.user.id, { nicheBrandId: brand.id, valuePotentialGbp: 1, tier: "D" }),
        );
        expect(r.nicheWarning).toBe("no_current_assessment");
        expect(r.commercialDecision).not.toBe("auto_approved");
      });
    });

    it("rejects tampered client input", async () => {
      await inRollback(async (tx) => {
        const { am, brand } = await fixture(tx, 2);
        const other = await fixture(tx, 1);
        await expect(
          createBrief(
            tx,
            brief(am.user.id, {
              nicheBrandId: brand.id,
              nicheAssessmentId: other.assessment.id,
            }),
          ),
        ).rejects.toThrow(/not current|belong/);
        await expect(
          createBrief(
            tx,
            brief(am.user.id, {
              nicheBrandId: brand.id,
              nicheRoute: "charging_model",
              nicheRouteRationale: "x",
            }),
          ),
        ).rejects.toThrow(/not allowed/);
        await expect(
          createBrief(
            tx,
            brief(am.user.id, {
              nicheFfPreApproved: true,
              nicheFfRationale: "just because",
            }),
          ),
        ).rejects.toThrow(/no longer be ticked/);
        await expect(
          createBrief(
            tx,
            brief(am.user.id, { nicheBrandId: brand.id, nicheFfPreApproved: true }),
          ),
        ).rejects.toThrow(/derived/);
      });
    });

    it("manual fine fragrance path: allowed with a rationale, auto-approves, flagged; blocked when the rule set switches it off", async () => {
      await inRollback(async (tx) => {
        await setup(tx);
        const am = await person(tx, "AM", ["account_manager"]);
        const r = await createBrief(
          tx,
          brief(am.user.id, {
            fineFragranceManualFlag: true,
            nicheFfRationale: "Heritage house, no niche brand",
            valuePotentialGbp: 1,
            tier: "D",
          }),
        );
        expect(r.commercialDecision).toBe("auto_approved");
        const [b] = await tx
          .select()
          .from(schema.briefs)
          .where(eq(schema.briefs.id, r.briefId));
        expect(b).toMatchObject({
          nicheFfPreApproved: true,
          fineFragranceManualFlag: true,
          nicheBrandId: null,
        });
        await expect(
          createBrief(tx, brief(am.user.id, { fineFragranceManualFlag: true })),
        ).rejects.toThrow(/rationale/);

        const [rs] = await tx
          .select()
          .from(schema.ruleSets)
          .where(eq(schema.ruleSets.status, "published"));
        const p = rs!.payload as RuleSetPayload;
        await tx
          .update(schema.ruleSets)
          .set({
            payload: { ...p, nicheAssessment: { allowManualFineFragrance: false } },
          })
          .where(eq(schema.ruleSets.id, rs!.id));
        await expect(
          createBrief(
            tx,
            brief(am.user.id, { fineFragranceManualFlag: true, nicheFfRationale: "x" }),
          ),
        ).rejects.toThrow(/switched off/);
      });
    });

    it("existing behaviour is unchanged for a brief with no niche input", async () => {
      await inRollback(async (tx) => {
        await setup(tx);
        const am = await person(tx, "AM", ["account_manager"]);
        const r = await createBrief(tx, brief(am.user.id));
        const [b] = await tx
          .select()
          .from(schema.briefs)
          .where(eq(schema.briefs.id, r.briefId));
        const [d] = await tx
          .select()
          .from(schema.decisions)
          .where(eq(schema.decisions.briefId, r.briefId));
        expect(b).toMatchObject({
          nicheBrandId: null,
          nicheRoute: null,
          nicheFfPreApproved: false,
        });
        expect(d!.nicheSnapshot).toBeNull();
        expect(r.nicheWarning).toBeNull();
      });
    });

    it("rollout creates an unpublished draft with the niche routing enabled, and its replay changes no historical outcome", async () => {
      await inRollback(async (tx) => {
        const admin = await person(tx, "Admin", ["admin"]);
        const result = await createNicheRoutingDraft(tx, { createdBy: admin.user.id });
        if (result.status !== "created") return; // already published in this database
        const [draft] = await tx
          .select()
          .from(schema.ruleSets)
          .where(eq(schema.ruleSets.id, result.ruleSetId));
        expect(draft!.status).toBe("draft");
        const p = draft!.payload as RuleSetPayload;
        expect(p.routingTable.niche_growth_partner).toEqual({
          role: "commercial_director",
          enabled: true,
        });
        expect(p.routingTable.niche_development_route).toEqual({
          role: "development_director",
          enabled: true,
        });
        expect(p.routingTable.niche_charging_model).toEqual({
          role: "commercial_director",
          enabled: true,
        });
        expect(p.nicheAssessment).toEqual({ allowManualFineFragrance: true });
        const [pub] = await tx
          .select()
          .from(schema.ruleSets)
          .where(eq(schema.ruleSets.status, "published"));
        expect(
          (pub!.payload as RuleSetPayload).routingTable.niche_growth_partner,
        ).toBeUndefined();
        // Compare with an identical draft lacking the niche routing: this
        // database holds older test briefs whose outcomes may already differ
        // from the current rule set, so the claim is "no change caused by niche".
        const plain = await createDraftRuleSet(tx, { createdBy: admin.user.id });
        const baseline = await replayRuleSet(tx, plain.id);
        const replay = await replayRuleSet(tx, result.ruleSetId);
        expect(replay.totalBriefsEvaluated).toBe(baseline.totalBriefsEvaluated);
        expect(replay.transitions.map((t) => t.briefId).sort()).toEqual(
          baseline.transitions.map((t) => t.briefId).sort(),
        );
      });
    });
  },
);
void and;
