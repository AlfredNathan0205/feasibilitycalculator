/**
 * Pure scoring engine — Build Prompt §3 "The scoring model".
 *
 * No I/O. Given a brief's raw inputs and a rule set payload (the JSONB shape
 * produced by generate-ruleset-v1.ts), returns the total score and a
 * component-by-component breakdown so any historical score can be explained
 * line by line without recalculation (§3, final paragraph).
 *
 * The workbook sums 7 cells (Calculator!D2,D3,D4,D5,D6,D8,D9) even though the
 * spec's prose says "six components" while its own table lists seven rows
 * (Customer tier, Value potential, New/Rework, Brief type, Customer approval,
 * Strategic priority, Creative approach). This engine matches the workbook —
 * and the spec's own table — rather than the "six" in the prose, since the
 * workbook is the ground truth the parity harness checks against.
 */

export interface RuleSetPayload {
  tierWeights: Record<string, number>;
  newReworkMultipliers: Record<string, number>;
  briefTypeMultipliers: Record<string, number>;
  customerApprovalMultipliers: Record<string, number>;
  creativeApproachScores: Record<string, number>;
  strategicPriorityBonus: number;
  thresholds: { autoApproveAbove: number; declineAtOrBelow: number };
  deadlineWindowDays: number;
  routingTable: Record<string, { role: string; enabled: boolean }>;
}

export interface ScoringInputs {
  customerTier: string; // "A/T" | "B" | "C" | "D"
  valuePotentialGbp: number;
  newRework: string; // "New" | "Rework (Of Selling)" | "Rework (Non-Selling)"
  briefType: string; // "Exclusive" | "Competitive" | "ProActive"
  customerApproval: string; // "Direct" | "Deferred/Unknown"
  strategicPriority: boolean;
  creativeApproach: string; // "Library Only" | "Starting Point" | "Creation/Unknown"
}

export interface ScoreBreakdown {
  customerTier: number;
  valuePotential: number;
  newRework: number;
  briefType: number;
  customerApproval: number;
  strategicPriority: number;
  creativeApproach: number;
}

export interface ScoreResult {
  total: number;
  breakdown: ScoreBreakdown;
}

function lookupOrThrow(
  table: Record<string, number>,
  key: string,
  tableName: string,
): number {
  if (!(key in table)) {
    throw new Error(`Unknown ${tableName} value: "${key}"`);
  }
  return table[key]!;
}

export function computeScore(
  inputs: ScoringInputs,
  ruleSet: RuleSetPayload,
): ScoreResult {
  const customerTier = lookupOrThrow(
    ruleSet.tierWeights,
    inputs.customerTier,
    "customerTier",
  );

  // V = value_potential_gbp / 1000, applied only when value_potential_gbp > 0;
  // otherwise every value-derived component is zero (§3).
  const valueApplies = inputs.valuePotentialGbp > 0;
  const v = valueApplies ? inputs.valuePotentialGbp / 1000 : 0;

  const valuePotential = valueApplies ? v : 0;

  const newRework = valueApplies
    ? v * lookupOrThrow(ruleSet.newReworkMultipliers, inputs.newRework, "newRework")
    : 0;

  const briefType = valueApplies
    ? v * lookupOrThrow(ruleSet.briefTypeMultipliers, inputs.briefType, "briefType")
    : 0;

  const customerApproval = valueApplies
    ? v *
      lookupOrThrow(
        ruleSet.customerApprovalMultipliers,
        inputs.customerApproval,
        "customerApproval",
      )
    : 0;

  const strategicPriority = inputs.strategicPriority ? ruleSet.strategicPriorityBonus : 0;

  const creativeApproach = lookupOrThrow(
    ruleSet.creativeApproachScores,
    inputs.creativeApproach,
    "creativeApproach",
  );

  const breakdown: ScoreBreakdown = {
    customerTier,
    valuePotential,
    newRework,
    briefType,
    customerApproval,
    strategicPriority,
    creativeApproach,
  };

  const total =
    breakdown.customerTier +
    breakdown.valuePotential +
    breakdown.newRework +
    breakdown.briefType +
    breakdown.customerApproval +
    breakdown.strategicPriority +
    breakdown.creativeApproach;

  return { total, breakdown };
}
