import { desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import type { RuleSetPayload } from "../engine/scoring.js";
import { addNicheRouting, hasNicheRouting } from "../engine/niche-rollout.js";
import { createDraftRuleSet, updateDraftPayload } from "./rule-set-editor.js";

type Db = PostgresJsDatabase<typeof schema>;

export type NicheRolloutResult =
  | { status: "created"; ruleSetId: string; version: number }
  | { status: "already_published"; version: number };

/**
 * Creates a DRAFT rule set that adds the three niche requirement types
 * (enabled, with the roles agreed in decision D1) and the
 * nicheAssessment.allowManualFineFragrance switch. Same approach as
 * createTierTDraft: it does not publish. An Admin reviews it in the rule set
 * editor, replays it against historical briefs (none carry niche inputs, so
 * nothing changes) and publishes it. Published rule sets stay immutable, so
 * existing ones simply lack these entries, which the engine treats as off.
 */
export async function createNicheRoutingDraft(
  db: Db,
  input: { createdBy: string },
): Promise<NicheRolloutResult> {
  const [published] = await db
    .select()
    .from(schema.ruleSets)
    .where(eq(schema.ruleSets.status, "published"))
    .orderBy(desc(schema.ruleSets.version))
    .limit(1);
  if (!published) throw new Error("No published rule set exists to base a draft on");

  const payload = published.payload as RuleSetPayload;
  if (hasNicheRouting(payload) && payload.routingTable.niche_growth_partner?.enabled) {
    return { status: "already_published", version: published.version };
  }
  const draft = await createDraftRuleSet(db, input);
  await updateDraftPayload(db, {
    ruleSetId: draft.id,
    payload: addNicheRouting(payload, { enable: true }),
  });
  return { status: "created", ruleSetId: draft.id, version: draft.version };
}
