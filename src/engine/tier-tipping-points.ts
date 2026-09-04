/**
 * Tier tipping-point table — Build Prompt §10, final paragraph.
 *
 * "For each customer tier, the value at which a brief auto-approves even
 * when every qualitative signal is negative (proactive, deferred approval,
 * non-selling rework) ... they are emergent consequences of an uncapped
 * value score interacting with multiplicative factors, so they must be
 * visible and regenerated whenever the rule set changes rather than
 * rediscovered in production."
 *
 * Worst-case qualitative combination: New/Rework = "Rework (Non-Selling)"
 * (multiplier 0), Brief Type = "ProActive" (multiplier -0.5), Customer
 * Approval = "Deferred/Unknown" (multiplier 0), Creative Approach =
 * "Creation/Unknown" (score 0), Strategic Priority = false, and NOT a
 * Rework (Of Selling) / Niche-FF override (since that would auto-approve
 * regardless of value, which isn't the "emergent from score" case being
 * illustrated here).
 *
 * With this combination: score = tierWeight + V + V*0 + V*(-0.5) + V*0
 *                                = tierWeight + 0.5V
 * Solve tierWeight + 0.5V > autoApproveAbove for V, then convert back to
 * value_potential_gbp (V = value / 1000).
 */

import { computeStageA } from "./decision.js";
import type { RuleSetPayload } from "./scoring.js";
import rulesetV1 from "../db/seed/ruleset-v1.generated.json" with { type: "json" };

export interface TippingPoint {
  tier: string;
  /** Smallest £ value potential (to the nearest £1) at which this
   * worst-case-qualitative brief auto-approves. */
  tippingPointGbp: number;
}

export function computeTierTippingPoints(ruleSet: RuleSetPayload): TippingPoint[] {
  const tiers = Object.keys(ruleSet.tierWeights);
  const results: TippingPoint[] = [];

  for (const tier of tiers) {
    // Binary search for the smallest integer £ value that auto-approves.
    // (Simple linear formula would work given the model is linear in V, but
    // searching against the actual engine — rather than re-deriving the
    // algebra here — means this stays correct even if computeStageA's rules
    // change shape in a future rule-set version.)
    let lo = 0;
    let hi = 10_000_000; // generous upper bound
    // First confirm hi actually auto-approves; if not, this tier can't tip
    // within a sane range and something's wrong with the rule set.
    const worstCase = (value: number) =>
      computeStageA(
        {
          customerTier: tier,
          valuePotentialGbp: value,
          newRework: "Rework (Non-Selling)",
          briefType: "ProActive",
          customerApproval: "Deferred/Unknown",
          strategicPriority: false,
          creativeApproach: "Creation/Unknown",
          nicheFfPreApproved: false,
          marketingFlag: false,
          ppdFlag: false,
          gcmsFlag: false,
          daysUntilDeadline: 60,
        },
        ruleSet,
      ).commercialDecision;

    if (worstCase(hi) !== "auto_approved") {
      throw new Error(
        `Tier ${tier} does not auto-approve even at £${hi} under the worst-case qualitative combination — rule set may have changed shape.`,
      );
    }

    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (worstCase(mid) === "auto_approved") {
        hi = mid;
      } else {
        lo = mid;
      }
    }

    results.push({ tier, tippingPointGbp: hi });
  }

  return results;
}

/* v8 ignore start -- CLI entry point guard; only runs when this file is
 * executed directly (`tsx src/engine/tier-tipping-points.ts`), never when
 * imported by tests or application code. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const ruleSet = rulesetV1 as unknown as RuleSetPayload;
  const table = computeTierTippingPoints(ruleSet);
  console.log("Tier tipping points (worst-case qualitative signals):");
  console.table(table);
}
/* v8 ignore stop */
