import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import type { RuleSetPayload } from "../engine/scoring.js";
import { createTierTDraft } from "./tier-t-migration.js";
import { createDraftRuleSet, replayRuleSet } from "./rule-set-editor.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("createTierTDraft (integration)", () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let adminId: string;
  let draftId: string | undefined;

  beforeAll(async () => {
    sql = postgres(databaseUrl!);
    db = drizzle(sql, { schema });
    const [u] = await db
      .insert(schema.users)
      .values({
        entraObjectId: "test-tier-t-admin",
        upn: "tier-t-admin@cpl.example",
        displayName: "Tier T Test Admin",
        email: "tier-t-admin@cpl.example",
        active: true,
      })
      .onConflictDoUpdate({ target: schema.users.upn, set: { active: true } })
      .returning();
    adminId = u!.id;
  });

  afterAll(async () => {
    // Never publish in this test (that would change shared state for every
    // other test file); just remove the draft it created.
    if (draftId) await db.delete(schema.ruleSets).where(eq(schema.ruleSets.id, draftId));
    await sql.end();
  });

  it("creates an unpublished draft that defines A and T, and leaves the published rule set untouched", async () => {
    const [before] = await db
      .select()
      .from(schema.ruleSets)
      .where(eq(schema.ruleSets.status, "published"));
    const beforePayload = before!.payload as RuleSetPayload;
    if ("T" in beforePayload.tierWeights) return; // already migrated in this database

    const result = await createTierTDraft(db, { createdBy: adminId });
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    draftId = result.ruleSetId;

    const [draft] = await db
      .select()
      .from(schema.ruleSets)
      .where(eq(schema.ruleSets.id, draftId));
    expect(draft!.status).toBe("draft");
    const payload = draft!.payload as RuleSetPayload;
    expect(payload.tierWeights).toMatchObject({ A: 100, T: 100 });
    expect(payload.routingTable["tier_auto_approval"]?.enabled).toBe(true);

    const [after] = await db
      .select()
      .from(schema.ruleSets)
      .where(eq(schema.ruleSets.status, "published"));
    expect(after!.id).toBe(before!.id);
    expect((after!.payload as RuleSetPayload).tierWeights).toEqual(
      beforePayload.tierWeights,
    );
  });

  it("changes no historical commercial decision beyond what a plain copy of the published rule set already does", async () => {
    if (!draftId) return;
    // Other tests in this shared database can leave history that already
    // disagrees with the published rule set, so compare against a plain
    // clone rather than asserting zero transitions outright.
    const plain = await createDraftRuleSet(db, { createdBy: adminId });
    try {
      const withT = await replayRuleSet(db, draftId);
      const without = await replayRuleSet(db, plain.id);
      expect(withT.totalBriefsEvaluated).toBeGreaterThan(0);
      expect(withT.totalBriefsEvaluated).toBe(without.totalBriefsEvaluated);
      expect(withT.transitions).toEqual(without.transitions);
    } finally {
      await db.delete(schema.ruleSets).where(eq(schema.ruleSets.id, plain.id));
    }
  });
});
