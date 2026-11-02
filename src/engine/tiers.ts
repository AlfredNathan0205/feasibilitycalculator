import type { RuleSetPayload } from "./scoring.js";

/**
 * Customer tiers.
 *
 * The original workbook offered one merged option, "A/T". CPL has confirmed
 * these are two different things: A is an ordinary tier-A customer, and T is
 * a Target account, where the brief is likely proactive work and must always
 * go to the Commercial Director for approval.
 *
 * Briefs submitted before the split carry the legacy value "A/T". That value
 * is still understood everywhere and behaves as tier A (which is how the
 * workbook treated it), so historical decisions and replays keep working.
 */
export const LEGACY_MERGED_TIER = "A/T";

/** Maps the legacy merged value onto tier A; every other value is unchanged. */
export function canonicalTier(tier: string): string {
  return tier === LEGACY_MERGED_TIER ? "A" : tier;
}

/** True for tier A, tier T, and the legacy merged value. */
export function isTierAOrT(tier: string): boolean {
  const t = canonicalTier(tier);
  return t === "A" || t === "T";
}

/**
 * Finds which key of a rule set's tier table applies to `tier`, so an old
 * rule set (which only has "A/T") and a new one (which has "A" and "T") both
 * work for a brief carrying either spelling of tier A. Tier T is deliberately
 * NOT aliased to anything: until a rule set that defines T is published, T is
 * an unknown tier rather than being silently scored as something else.
 * Returns undefined when nothing matches.
 */
export function resolveTierKey(
  table: Record<string, number>,
  tier: string,
): string | undefined {
  if (tier in table) return tier;
  const canonical = canonicalTier(tier);
  if (canonical === "A") {
    if ("A" in table) return "A";
    if (LEGACY_MERGED_TIER in table) return LEGACY_MERGED_TIER;
  }
  return undefined;
}

/**
 * Returns a copy of a rule set payload that splits the merged "A/T" tier into
 * separate A and T tiers and turns on the tier-T approval requirement.
 *
 * - A keeps the merged tier's weight, so every existing score is unchanged.
 * - T is given the same weight as A. This follows the workbook's own note
 *   "T = A (100)" and is an assumption CPL should confirm; it can be changed
 *   in the rule set editor before the draft is published.
 * - tier_auto_approval is enabled and stays routed to the Commercial Director.
 *
 * Idempotent: a payload that already has a T tier is returned unchanged.
 */
export function withTierT(payload: RuleSetPayload): RuleSetPayload {
  if ("T" in payload.tierWeights) return payload;
  const legacyWeight = payload.tierWeights[LEGACY_MERGED_TIER];
  const tierWeights: Record<string, number> = {};
  for (const [tier, weight] of Object.entries(payload.tierWeights)) {
    if (tier === LEGACY_MERGED_TIER) {
      tierWeights["A"] = weight;
      tierWeights["T"] = weight;
    } else {
      tierWeights[tier] = weight;
    }
  }
  if (legacyWeight === undefined) {
    throw new Error(`Rule set has no "${LEGACY_MERGED_TIER}" tier to split`);
  }
  const existing = payload.routingTable["tier_auto_approval"];
  return {
    ...payload,
    tierWeights,
    routingTable: {
      ...payload.routingTable,
      tier_auto_approval: {
        role: existing?.role ?? "commercial_director",
        enabled: true,
      },
    },
  };
}
