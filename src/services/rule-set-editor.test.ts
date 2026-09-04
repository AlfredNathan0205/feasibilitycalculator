import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { createBrief } from "./create-brief.js";
import {
  createDraftRuleSet,
  updateDraftPayload,
  replayRuleSet,
  publishRuleSet,
  listRuleSets,
  ValidationError,
  NotFoundError,
} from "./rule-set-editor.js";
import type { RuleSetPayload } from "../engine/scoring.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("rule-set-editor (integration)", () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let adminId: string;
  let originalPublishedPayload: RuleSetPayload;

  beforeAll(async () => {
    sql = postgres(databaseUrl!);
    db = drizzle(sql, { schema });

    const [admin] = await db
      .insert(schema.users)
      .values({
        entraObjectId: "test-rule-set-editor-admin",
        upn: "rule-set-editor-admin@cpl.example",
        displayName: "Rule Set Editor Test Admin",
        email: "rule-set-editor-admin@cpl.example",
        active: true,
      })
      .onConflictDoUpdate({ target: schema.users.upn, set: { active: true } })
      .returning();
    adminId = admin!.id;

    // Captured so afterAll can restore the published rule set to its
    // original values — several tests below (deliberately) publish
    // altered thresholds to prove publish/replay actually take effect,
    // and every other test file in this suite shares this same database
    // and assumes the "normal" published thresholds.
    const [published] = await db
      .select({ payload: schema.ruleSets.payload })
      .from(schema.ruleSets)
      .where(eq(schema.ruleSets.status, "published"));
    originalPublishedPayload = published!.payload as RuleSetPayload;
  });

  afterAll(async () => {
    const restored = await createDraftRuleSet(db, { createdBy: adminId });
    await updateDraftPayload(db, {
      ruleSetId: restored.id,
      payload: originalPublishedPayload,
    });
    await publishRuleSet(db, { ruleSetId: restored.id, publishedBy: adminId });
    await sql.end();
  });

  function farFutureDate(days = 60) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  it("creates a draft as a clone of the current published payload, at the next version number", async () => {
    const [publishedBefore] = await db
      .select({ version: schema.ruleSets.version, payload: schema.ruleSets.payload })
      .from(schema.ruleSets)
      .where(eq(schema.ruleSets.status, "published"));

    const draft = await createDraftRuleSet(db, { createdBy: adminId });
    expect(draft.version).toBeGreaterThan(publishedBefore!.version);

    const [draftRow] = await db
      .select()
      .from(schema.ruleSets)
      .where(eq(schema.ruleSets.id, draft.id));
    expect(draftRow!.status).toBe("draft");
    expect(draftRow!.payload).toEqual(publishedBefore!.payload);
  });

  it("updateDraftPayload rejects editing a non-draft rule set", async () => {
    const [published] = await db
      .select({ id: schema.ruleSets.id })
      .from(schema.ruleSets)
      .where(eq(schema.ruleSets.status, "published"));

    await expect(
      updateDraftPayload(db, {
        ruleSetId: published!.id,
        payload: {} as RuleSetPayload,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("replay reports a transition when a threshold change flips a real historical brief's decision", async () => {
    // Submit a brief that will land squarely in "pending" under the
    // current published thresholds (score strictly between decline and
    // auto-approve), so tightening the auto-approve threshold below its
    // score will flip it to auto_approved on replay.
    const submitted = await createBrief(db, {
      customerReference: "REPLAY-FLIP-TEST",
      tier: "B", // 50
      valuePotentialGbp: 0,
      newRework: "New",
      briefType: "Exclusive",
      customerApproval: "Direct",
      nicheFfPreApproved: false,
      strategicPriority: false,
      creativeApproach: "Starting Point", // 65 -> total 115, exactly at threshold (pending, since > required)
      marketingFlag: false,
      ppdFlag: false,
      gcmsFlag: false,
      deadline: farFutureDate(),
      submittedBy: adminId,
    });
    expect(submitted.commercialDecision).toBe("pending");
    expect(submitted.score).toBe(115);

    const draft = await createDraftRuleSet(db, { createdBy: adminId });
    const [draftRow] = await db
      .select()
      .from(schema.ruleSets)
      .where(eq(schema.ruleSets.id, draft.id));
    const payload = draftRow!.payload as RuleSetPayload;

    // Lower the auto-approve threshold below 115 so this exact brief flips.
    const loweredPayload: RuleSetPayload = {
      ...payload,
      thresholds: { ...payload.thresholds, autoApproveAbove: 100 },
    };
    await updateDraftPayload(db, { ruleSetId: draft.id, payload: loweredPayload });

    const replay = await replayRuleSet(db, draft.id);
    const match = replay.transitions.find((t) => t.briefId === submitted.briefId);
    expect(match).toBeDefined();
    expect(match!.fromDecision).toBe("pending");
    expect(match!.toDecision).toBe("auto_approved");
    expect(replay.transitionCounts["pending->auto_approved"]).toBeGreaterThan(0);
  });

  it("replay reports no transition for a brief submitted under the SAME rule set the draft clones", async () => {
    // A fresh, self-contained check rather than asserting zero transitions
    // across ALL history — after many publishes over a long test session,
    // old briefs decided under genuinely different past rule-set versions
    // correctly DO show drift against whatever is published now, which is
    // replay doing its job, not a false positive. Scope this test to one
    // brief submitted under the current published rule set, then confirm
    // a same-payload draft doesn't flag it.
    const submitted = await createBrief(db, {
      customerReference: "REPLAY-NO-DRIFT-TEST",
      tier: "A/T",
      valuePotentialGbp: 200_000,
      newRework: "New",
      briefType: "Exclusive",
      customerApproval: "Direct",
      nicheFfPreApproved: false,
      strategicPriority: false,
      creativeApproach: "Library Only",
      marketingFlag: false,
      ppdFlag: false,
      gcmsFlag: false,
      deadline: farFutureDate(),
      submittedBy: adminId,
    });

    const draft = await createDraftRuleSet(db, { createdBy: adminId });
    const replay = await replayRuleSet(db, draft.id);
    expect(replay.transitions.some((t) => t.briefId === submitted.briefId)).toBe(false);
  });

  it("publish supersedes the previously-published rule set and there is always exactly one published row", async () => {
    const before = await listRuleSets(db);
    const publishedBefore = before.filter((r) => r.status === "published");
    expect(publishedBefore).toHaveLength(1);

    const draft = await createDraftRuleSet(db, { createdBy: adminId });
    await publishRuleSet(db, { ruleSetId: draft.id, publishedBy: adminId });

    const after = await listRuleSets(db);
    const publishedAfter = after.filter((r) => r.status === "published");
    expect(publishedAfter).toHaveLength(1);
    expect(publishedAfter[0]!.id).toBe(draft.id);

    const nowSuperseded = after.find((r) => r.id === publishedBefore[0]!.id);
    expect(nowSuperseded!.status).toBe("superseded");
    expect(nowSuperseded!.supersededAt).not.toBeNull();
  });

  it("publishing a non-draft rule set throws ValidationError", async () => {
    const [published] = await db
      .select({ id: schema.ruleSets.id })
      .from(schema.ruleSets)
      .where(eq(schema.ruleSets.status, "published"));

    await expect(
      publishRuleSet(db, { ruleSetId: published!.id, publishedBy: adminId }),
    ).rejects.toThrow(ValidationError);
  });

  it("throws NotFoundError for a nonexistent rule set id", async () => {
    await expect(
      replayRuleSet(db, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(NotFoundError);
    await expect(
      publishRuleSet(db, {
        ruleSetId: "00000000-0000-0000-0000-000000000000",
        publishedBy: adminId,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("a subsequent brief submitted after publish uses the newly-published rule set", async () => {
    const beforePublish = await createDraftRuleSet(db, { createdBy: adminId });
    const [draftRow] = await db
      .select()
      .from(schema.ruleSets)
      .where(eq(schema.ruleSets.id, beforePublish.id));
    const payload = draftRow!.payload as RuleSetPayload;
    const bumpedPayload: RuleSetPayload = {
      ...payload,
      thresholds: { ...payload.thresholds, declineAtOrBelow: 999 }, // absurdly high, so the next submission definitely declines
    };
    await updateDraftPayload(db, { ruleSetId: beforePublish.id, payload: bumpedPayload });
    await publishRuleSet(db, { ruleSetId: beforePublish.id, publishedBy: adminId });

    const result = await createBrief(db, {
      customerReference: "POST-PUBLISH-TEST",
      tier: "A/T",
      valuePotentialGbp: 200_000,
      newRework: "New",
      briefType: "Exclusive",
      customerApproval: "Direct",
      nicheFfPreApproved: false,
      strategicPriority: false,
      creativeApproach: "Library Only",
      marketingFlag: false,
      ppdFlag: false,
      gcmsFlag: false,
      deadline: farFutureDate(),
      submittedBy: adminId,
    });
    expect(result.commercialDecision).toBe("declined"); // would normally auto-approve at score 900
  });
});
