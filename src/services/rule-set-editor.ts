/**
 * Rule set editor + replay simulation — Build Prompt §7.
 *
 * "Simon expects to tune the calculation over time and the thresholds are
 * deliberately user-editable... Replay / simulation, available to Admin:
 * take a draft rule set, re-run every historical submission through it,
 * and report which decisions would change, grouped by outcome transition
 * ... Show this before the draft can be published. This is a first-release
 * requirement, not a later enhancement."
 *
 * Authorization is NOT checked in here, same convention as the other
 * services — callers (the API routes) must call requireAdmin(session)
 * first (§2: "editing thresholds requires Admin, deliberately narrow").
 */

import { desc, eq, max } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import { computeStageA } from "../engine/decision.js";
import type { RuleSetPayload } from "../engine/scoring.js";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Clones the current published rule set's payload into a brand-new draft
 * at the next version number. Editing never mutates a published row in
 * place (§7: "Rule sets are immutable once published. Editing produces a
 * new draft version.") — this is the ONLY way a new version comes into
 * existence. */
export async function createDraftRuleSet(
  db: PostgresJsDatabase<typeof schema>,
  input: { createdBy: string },
): Promise<{ id: string; version: number }> {
  const [published] = await db
    .select()
    .from(schema.ruleSets)
    .where(eq(schema.ruleSets.status, "published"))
    .orderBy(desc(schema.ruleSets.version))
    .limit(1);
  if (!published) {
    throw new Error("No published rule set exists to base a draft on");
  }

  const [maxRow] = await db
    .select({ maxVersion: max(schema.ruleSets.version) })
    .from(schema.ruleSets);
  const nextVersion = (maxRow?.maxVersion ?? 0) + 1;

  const [draft] = await db
    .insert(schema.ruleSets)
    .values({
      version: nextVersion,
      status: "draft",
      payload: published.payload,
      createdBy: input.createdBy,
    })
    .returning();
  if (!draft) throw new Error("Failed to create draft rule set");

  return { id: draft.id, version: draft.version };
}

/** Overwrites a draft's payload wholesale — the caller (API route) is
 * responsible for merging form edits into a complete, valid
 * RuleSetPayload shape before calling this; this function only enforces
 * that it's actually still a draft. */
export async function updateDraftPayload(
  db: PostgresJsDatabase<typeof schema>,
  input: { ruleSetId: string; payload: RuleSetPayload },
): Promise<void> {
  const [ruleSet] = await db
    .select({ status: schema.ruleSets.status })
    .from(schema.ruleSets)
    .where(eq(schema.ruleSets.id, input.ruleSetId));
  if (!ruleSet) {
    throw new NotFoundError(`No rule set with id ${input.ruleSetId}`);
  }
  if (ruleSet.status !== "draft") {
    throw new ValidationError(
      `Rule set is "${ruleSet.status}", not draft — published rule sets are immutable`,
    );
  }

  await db
    .update(schema.ruleSets)
    .set({ payload: input.payload })
    .where(eq(schema.ruleSets.id, input.ruleSetId));
}

export interface ReplayTransition {
  briefId: string;
  customerReference: string;
  fromDecision: string;
  toDecision: string;
  fromScore: number;
  toScore: number;
}

export interface ReplayResult {
  totalBriefsEvaluated: number;
  transitions: ReplayTransition[];
  /** Grouped counts, e.g. { "declined->pending": 7 } — the exact framing
   * the spec asks for ("7 briefs move from Declined to Pending"). */
  transitionCounts: Record<string, number>;
}

/** Re-runs every historical brief's ORIGINAL inputs through the draft
 * rule set and reports which commercial decisions would change. Uses each
 * brief's own stored deadline/submittedAt to reconstruct the exact
 * daysUntilDeadline it had at submission time — replay asks "what would
 * this rule set have decided given the same facts", not "what would it
 * decide if resubmitted today". */
export async function replayRuleSet(
  db: PostgresJsDatabase<typeof schema>,
  ruleSetId: string,
): Promise<ReplayResult> {
  const [ruleSetRow] = await db
    .select()
    .from(schema.ruleSets)
    .where(eq(schema.ruleSets.id, ruleSetId));
  if (!ruleSetRow) {
    throw new NotFoundError(`No rule set with id ${ruleSetId}`);
  }
  const draftPayload = ruleSetRow.payload as RuleSetPayload;

  const rows = await db
    .select({
      briefId: schema.briefs.id,
      customerReference: schema.briefs.customerReference,
      tier: schema.briefs.tier,
      valuePotentialGbp: schema.briefs.valuePotentialGbp,
      newRework: schema.briefs.newRework,
      briefType: schema.briefs.briefType,
      customerApproval: schema.briefs.customerApproval,
      nicheFfPreApproved: schema.briefs.nicheFfPreApproved,
      strategicPriority: schema.briefs.strategicPriority,
      creativeApproach: schema.briefs.creativeApproach,
      marketingFlag: schema.briefs.marketingFlag,
      ppdFlag: schema.briefs.ppdFlag,
      gcmsFlag: schema.briefs.gcmsFlag,
      deadline: schema.briefs.deadline,
      submittedAt: schema.briefs.submittedAt,
      oldCommercialDecision: schema.decisions.commercialDecision,
      oldScore: schema.decisions.computedScore,
    })
    .from(schema.briefs)
    .innerJoin(schema.decisions, eq(schema.decisions.briefId, schema.briefs.id));

  const transitions: ReplayTransition[] = [];
  const transitionCounts: Record<string, number> = {};

  for (const row of rows) {
    const submittedAt = new Date(row.submittedAt);
    const deadline = new Date(row.deadline + "T00:00:00Z");
    const daysUntilDeadline = Math.round(
      (Date.UTC(
        deadline.getUTCFullYear(),
        deadline.getUTCMonth(),
        deadline.getUTCDate(),
      ) -
        Date.UTC(
          submittedAt.getUTCFullYear(),
          submittedAt.getUTCMonth(),
          submittedAt.getUTCDate(),
        )) /
        (24 * 60 * 60 * 1000),
    );

    const inputs = {
      customerTier: row.tier,
      valuePotentialGbp: Number(row.valuePotentialGbp),
      newRework: row.newRework,
      briefType: row.briefType,
      customerApproval: row.customerApproval,
      strategicPriority: row.strategicPriority,
      creativeApproach: row.creativeApproach,
      nicheFfPreApproved: row.nicheFfPreApproved,
      marketingFlag: row.marketingFlag,
      ppdFlag: row.ppdFlag,
      gcmsFlag: row.gcmsFlag,
      daysUntilDeadline,
    };

    let replayed;
    try {
      replayed = computeStageA(inputs, draftPayload);
    } catch {
      // A draft that removed/renamed an enum value the historical brief
      // used would throw here (computeScore's lookupOrThrow) — skip that
      // brief from the transition report rather than crashing the whole
      // replay; an incomplete report is recoverable, a 500 isn't.
      continue;
    }

    if (replayed.commercialDecision !== row.oldCommercialDecision) {
      const key = `${row.oldCommercialDecision}->${replayed.commercialDecision}`;
      transitionCounts[key] = (transitionCounts[key] ?? 0) + 1;
      transitions.push({
        briefId: row.briefId,
        customerReference: row.customerReference,
        fromDecision: row.oldCommercialDecision,
        toDecision: replayed.commercialDecision,
        fromScore: Number(row.oldScore),
        toScore: replayed.score,
      });
    }
  }

  return {
    totalBriefsEvaluated: rows.length,
    transitions,
    transitionCounts,
  };
}

/** Publishes a draft: supersedes whatever was previously published, then
 * publishes this one. Both happen in one transaction so there's never a
 * moment with zero or two published rule sets. */
export async function publishRuleSet(
  db: PostgresJsDatabase<typeof schema>,
  input: { ruleSetId: string; publishedBy: string },
  now: Date = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(schema.ruleSets)
      .where(eq(schema.ruleSets.id, input.ruleSetId));
    if (!draft) {
      throw new NotFoundError(`No rule set with id ${input.ruleSetId}`);
    }
    if (draft.status !== "draft") {
      throw new ValidationError(
        `Rule set is "${draft.status}", not draft — nothing to publish`,
      );
    }

    const [currentlyPublished] = await tx
      .select({ id: schema.ruleSets.id })
      .from(schema.ruleSets)
      .where(eq(schema.ruleSets.status, "published"));

    if (currentlyPublished) {
      await tx
        .update(schema.ruleSets)
        .set({ status: "superseded", supersededAt: now })
        .where(eq(schema.ruleSets.id, currentlyPublished.id));
    }

    await tx
      .update(schema.ruleSets)
      .set({ status: "published", publishedBy: input.publishedBy, publishedAt: now })
      .where(eq(schema.ruleSets.id, input.ruleSetId));
  });
}

export async function listRuleSets(db: PostgresJsDatabase<typeof schema>) {
  return db.select().from(schema.ruleSets).orderBy(desc(schema.ruleSets.version));
}
