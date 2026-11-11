/**
 * Pure decision engine — Build Prompt §5 "The decision ladder".
 *
 * This replaces the workbook's single deeply-nested E16 formula with an
 * explicit, ordered, individually testable sequence, per §5's instruction.
 *
 * CRITICAL STRUCTURAL DIFFERENCE FROM THE WORKBOOK (§11 items 3 and 4,
 * flagged in the spec as "the single most important structural difference
 * from the workbook"): Stage A (the commercial decision) is computed purely
 * from score + new/rework + niche/FF — it does NOT fold in short-deadline or
 * creative-resourcing requirements the way the workbook's E16 does. Those are
 * Stage B concerns and never change the commercial decision text. A brief can
 * be commercially Auto-Approved and still have resource sign-offs
 * outstanding; the two are reported separately (§5 Stage D; §9 "The UI must
 * never show a bare Auto-Approved when resource sign-offs are outstanding").
 */

import type { RuleSetPayload, ScoringInputs } from "./scoring.js";
import { computeScore } from "./scoring.js";
import { canonicalTier, isTierAOrT } from "./tiers.js";
import type { NicheBand, NicheRoute } from "./niche-assessment.js";

export type CommercialDecision = "auto_approved" | "pending" | "declined";

export type RequirementType =
  | "short_deadline"
  | "creative_creation"
  | "creative_starting_point"
  | "marketing_resource"
  | "ppd_resource"
  | "gcms_resource"
  | "tier_auto_approval" // tier T: Commercial Director approval (enabled by the tier-T rule set)
  | "strategic_priority_deferral" // disabled by default, §11 item 3
  | "niche_growth_partner" // niche band 2: Commercial Director sign-off
  | "niche_development_route" // junior perfumer / passion project route: Development Director
  | "niche_charging_model"; // charging model route: Commercial Director

export interface RequiredApproval {
  requirementType: RequirementType;
  role: string;
}

export interface DecisionInputs extends ScoringInputs {
  nicheFfPreApproved: boolean;
  /** Band of the current approved niche assessment at submission; null/absent
   * for every brief that does not involve a niche assessment (including every
   * row of the parity golden dataset). */
  nicheBand?: NicheBand | null;
  /** Route chosen on the brief; "standard" for bands 1 and 2. */
  nicheRoute?: NicheRoute | null;
  marketingFlag: boolean;
  ppdFlag: boolean;
  gcmsFlag: boolean;
  /** Days between submission and the brief's deadline. Must be > 0 — a
   * deadline on or before today is a form-level validation error (§5),
   * not something this pure function decides; callers validate that before
   * calling in. */
  daysUntilDeadline: number;
}

export interface StageAResult {
  commercialDecision: CommercialDecision;
  score: number;
  scoreBreakdown: ReturnType<typeof computeScore>["breakdown"];
}

/**
 * Stage A: commercial decision. First match wins (§5, niche spec §6.5):
 *   1. Rework (Of Selling) OR Niche/FF Pre-Approved -> Auto-Approved
 *   2. Niche band charge_or_decline with route "decline" -> Declined
 *      (below rule 1, so a rework of a selling product is never declined by a
 *      niche assessment)
 *   3. score <= decline threshold -> Declined
 *   4. score > auto threshold -> Auto-Approved
 *   5. otherwise -> Pending
 */
export function computeStageA(
  inputs: DecisionInputs,
  ruleSet: RuleSetPayload,
): StageAResult {
  const { total, breakdown } = computeScore(inputs, ruleSet);

  let commercialDecision: CommercialDecision;
  if (inputs.newRework === "Rework (Of Selling)" || inputs.nicheFfPreApproved) {
    commercialDecision = "auto_approved";
  } else if (
    inputs.nicheBand === "charge_or_decline" &&
    inputs.nicheRoute === "decline"
  ) {
    commercialDecision = "declined";
  } else if (total <= ruleSet.thresholds.declineAtOrBelow) {
    // Exactly the threshold is a decline (§3: "Exactly 30 is a decline").
    commercialDecision = "declined";
  } else if (total > ruleSet.thresholds.autoApproveAbove) {
    commercialDecision = "auto_approved";
  } else {
    commercialDecision = "pending";
  }

  return { commercialDecision, score: total, scoreBreakdown: breakdown };
}

/**
 * Stage B: required approvals. Computed entirely independently of Stage A
 * (§5: "Compute these independently of Stage A[/the commercial decision]").
 * Only the routing-table-enabled requirement types are returned; the two
 * disabled-by-default alternates (§11 items 2, 3) are evaluated too so they
 * can be turned on without touching this function, but are filtered out
 * downstream by the caller checking ruleSet.routingTable[...].enabled.
 */
export function computeStageB(
  inputs: DecisionInputs,
  ruleSet: RuleSetPayload,
): RequiredApproval[] {
  const requirements: RequiredApproval[] = [];

  const addIfEnabled = (type: RequirementType) => {
    const routing = ruleSet.routingTable[type];
    if (routing?.enabled) {
      requirements.push({ requirementType: type, role: routing.role });
    }
  };

  // Short deadline: always raised regardless of score or auto-approval,
  // specifically so a run of urgent projects can't quietly overload
  // development (§5). Not suppressible by pre-approval at raise time — the
  // override happens later, per requirement, in Stage C.
  if (inputs.daysUntilDeadline <= ruleSet.deadlineWindowDays) {
    addIfEnabled("short_deadline");
  }

  // Creative: creation — Creation/Unknown and tier is not A or T (tier T behaves
  // like A here, as the merged workbook value did; legacy "A/T" is tier A).
  if (
    inputs.creativeApproach === "Creation/Unknown" &&
    !isTierAOrT(inputs.customerTier)
  ) {
    addIfEnabled("creative_creation");
  }

  // Creative: starting point — Starting Point and tier is C or D.
  if (
    inputs.creativeApproach === "Starting Point" &&
    (inputs.customerTier === "C" || inputs.customerTier === "D")
  ) {
    addIfEnabled("creative_starting_point");
  }

  // Resource requests always require approval — the workbook's A/T
  // suppression is removed (§11 item 2; §5 "Confirmed rules that must not
  // be softened").
  if (inputs.marketingFlag) addIfEnabled("marketing_resource");
  if (inputs.ppdFlag) addIfEnabled("ppd_resource");
  if (inputs.gcmsFlag) addIfEnabled("gcms_resource");

  // Disabled-by-default alternate for strategic priority (§11 item 3) — only
  // fires if a future rule set enables it.
  if (inputs.strategicPriority) addIfEnabled("strategic_priority_deferral");

  // Tier T (Target account): always goes to the Commercial Director, because
  // it is likely to be proactive work. Tier A does not. Enabled by the rule
  // set that introduces tier T; until then the routing entry is disabled and
  // addIfEnabled skips it.
  if (canonicalTier(inputs.customerTier) === "T") addIfEnabled("tier_auto_approval");

  // Niche brand assessment requirements (niche spec §6.7). Raised only when the
  // rule set enables them, so published rule sets without these entries behave
  // exactly as before.
  if (inputs.nicheBand === "growth_partner") addIfEnabled("niche_growth_partner");
  if (
    inputs.nicheRoute === "junior_perfumer_development" ||
    inputs.nicheRoute === "perfumer_passion_project"
  ) {
    addIfEnabled("niche_development_route");
  }
  if (inputs.nicheRoute === "charging_model") addIfEnabled("niche_charging_model");

  return requirements;
}
