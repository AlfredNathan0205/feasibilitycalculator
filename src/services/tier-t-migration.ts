import { desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import type { RuleSetPayload } from "../engine/scoring.js";
import { withTierT } from "../engine/tiers.js";
import { createDraftRuleSet, updateDraftPayload } from "./rule-set-editor.js";

type Db = PostgresJsDatabase<typeof schema>;

export type TierTMigrationResult =
  | { status: "created"; ruleSetId: string; version: number }
  | { status: "already_published"; version: number };

/**
 * Creates a DRAFT rule set that splits the merged "A/T" tier into A and T
 * and enables the tier-T Commercial Director approval. It deliberately does
 * not publish: an Admin reviews it in the rule set editor, runs the replay
 * against historical briefs, and publishes it, exactly as for any other
 * rule set change.
 */
export async function createTierTDraft(
  db: Db,
  input: { createdBy: string },
): Promise<TierTMigrationResult> {
  const [published] = await db
    .select()
    .from(schema.ruleSets)
    .where(eq(schema.ruleSets.status, "published"))
    .orderBy(desc(schema.ruleSets.version))
    .limit(1);
  if (!published) throw new Error("No published rule set exists to base a draft on");

  const payload = published.payload as RuleSetPayload;
  if ("T" in payload.tierWeights) {
    return { status: "already_published", version: published.version };
  }

  const draft = await createDraftRuleSet(db, input);
  await updateDraftPayload(db, { ruleSetId: draft.id, payload: withTierT(payload) });
  return { status: "created", ruleSetId: draft.id, version: draft.version };
}
