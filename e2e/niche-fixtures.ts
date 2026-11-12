/**
 * Direct-to-database fixtures for the niche e2e specs: make sure the published
 * rule set has the niche routing, and create approved assessments of a chosen
 * band without clicking through the 14 questions each time. The assessment
 * form itself is covered by niche-assess-and-approve.spec.ts.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema.js";
import type { AuthSession } from "../src/auth/authz.js";
import { createNicheRoutingDraft } from "../src/services/niche-rollout.js";
import { publishRuleSet } from "../src/services/rule-set-editor.js";
import {
  createAssessmentDraft,
  createBrand,
  reviewAssessment,
  submitAssessment,
} from "../src/services/niche-assessments.js";
import {
  scoreNicheAssessment,
  type NicheAnswers,
  type NicheBand,
  type NicheFrameworkPayload,
} from "../src/engine/niche-assessment.js";

export function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set for the niche e2e fixtures");
  const sql = postgres(url);
  return { sql, db: drizzle(sql, { schema }) };
}

type Db = ReturnType<typeof connect>["db"];

export async function sessionFor(db: Db, upn: string): Promise<AuthSession> {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.upn, upn));
  if (!u) throw new Error(`No user ${upn}; run the dev test user seed`);
  const holders = await db
    .select()
    .from(schema.roleHolders)
    .where(eq(schema.roleHolders.userId, u.id));
  const authority = holders.map((h) => h.roleKey).filter((k) => k !== "admin");
  const access = authority.length > 0 ? ["approver"] : [];
  const role = upn.startsWith("am@")
    ? ["account_manager"]
    : upn.startsWith("admin@")
      ? ["admin"]
      : [];
  return {
    userId: u.id,
    accessRoles: [...access, ...role],
    approvalAuthorityRoles: authority,
  };
}

export async function ensureNicheRoutingPublished(db: Db) {
  const admin = await sessionFor(db, "admin@cpl.example");
  const r = await createNicheRoutingDraft(db, { createdBy: admin.userId });
  if (r.status === "created") {
    await publishRuleSet(db, { ruleSetId: r.ruleSetId, publishedBy: admin.userId });
  }
}

/** Yes answers, in framework order, until the score lands inside the wanted band. */
export function answersForBand(fw: NicheFrameworkPayload, want: NicheBand): NicheAnswers {
  const keys = fw.sections.flatMap((s) => s.criteria.map((c) => c.key));
  const answers: NicheAnswers = Object.fromEntries(keys.map((k) => [k, "no"]));
  if (want === "charge_or_decline") return answers;
  for (const k of keys) {
    if (scoreNicheAssessment(answers, fw).band === want) return answers;
    answers[k] = "yes";
    if (scoreNicheAssessment(answers, fw).band === want) return answers;
  }
  if (scoreNicheAssessment(answers, fw).band !== want) {
    throw new Error(`Could not build answers for band ${want}`);
  }
  return answers;
}

/** A brand with a current approved assessment of the wanted band. Returns the brand name. */
export async function brandWithApprovedAssessment(
  db: Db,
  band: NicheBand,
  label: string,
) {
  const am = await sessionFor(db, "am@cpl.example");
  const cd = await sessionFor(db, "cd@cpl.example");
  const [fw] = await db
    .select()
    .from(schema.nicheFrameworks)
    .where(eq(schema.nicheFrameworks.status, "published"));
  const name = `E2E ${label} ${Date.now()}`;
  const brand = await createBrand(db, am, { name });
  const draft = await createAssessmentDraft(db, am, { brandId: brand.id });
  const a = await submitAssessment(db, am, draft.id, {
    answers: answersForBand(fw!.payload as NicheFrameworkPayload, band),
  });
  await reviewAssessment(db, cd, a.id, { decision: "approve" });
  return { name, brandId: brand.id, assessmentId: a.id };
}
