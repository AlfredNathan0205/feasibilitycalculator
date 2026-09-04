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

export type CommercialDecision = "auto_approved" | "pending" | "declined";

export type RequirementType =
  | "short_deadline"
  | "creative_creation"
  | "creative_starting_point"
  | "marketing_resource"
  | "ppd_resource"
  | "gcms_resource"
  | "tier_auto_approval" // disabled by default, §11 item 2
  | "strategic_priority_deferral"; // disabled by default, §11 item 3

export interface RequiredApproval {
  requirementType: RequirementType;
  role: string;
}

export interface DecisionInputs extends ScoringInputs {
  nicheFfPreApproved: boolean;
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
 * Stage A: commercial decision. First match wins (§5):
 *   1. Rework (Of Selling) OR Niche/FF Pre-Approved -> Auto-Approved
 *   2. score <= decline threshold -> Declined
 *   3. score > auto threshold -> Auto-Approved
 *   4. otherwise -> Pending
 */
export function computeStageA(
  inputs: DecisionInputs,
  ruleSet: RuleSetPayload,
): StageAResult {
  const { total, breakdown } = computeScore(inputs, ruleSet);

  let commercialDecision: CommercialDecision;
  if (inputs.newRework === "Rework (Of Selling)" || inputs.nicheFfPreApproved) {
    commercialDecision = "auto_approved";
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

  // Creative: creation — Creation/Unknown and tier is not A/T.
  if (inputs.creativeApproach === "Creation/Unknown" && inputs.customerTier !== "A/T") {
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

  // Disabled-by-default alternate for "tier raises an automatic approval
  // requirement" (§11 item 2) is DELIBERATELY NOT WIRED IN HERE.
  //
  // The spec's item 2 assumes a distinguishable "tier T" separate from tier
  // A. But the live workbook's actual data-validation list for the tier
  // dropdown (Calculator!B2, validated against Reference!$A$2:$A$5) only
  // offers "A/T" as a single combined value — there is no separate "T" input
  // anywhere in the live model to test. Guessing that "A/T" should stand in
  // for "T" here would be silently picking a behaviour the spec explicitly
  // warns against (§15 "How to handle uncertainty"). See
  // docs/open-questions.md — this requirement type exists in the enum and
  // the routing table (disabled) so the schema doesn't need to change once
  // the real answer is known, but no code path currently raises it.

  return requirements;
}
