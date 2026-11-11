/**
 * Rule set rollout for the Niche Brand Assessment (spec §4.8, §9).
 *
 * Pure: adds the three niche requirement types to a rule set payload. Existing
 * published rule sets get them as `enabled: false`; the new draft gets them
 * `enabled: true` (roles per decision D1) plus nicheAssessment.allowManualFineFragrance.
 */
import type { RuleSetPayload } from "./scoring.js";

export const NICHE_REQUIREMENT_ROLES = {
  niche_growth_partner: "commercial_director",
  niche_development_route: "development_director",
  niche_charging_model: "commercial_director",
} as const;

export function addNicheRouting(
  payload: RuleSetPayload,
  opts: { enable: boolean },
): RuleSetPayload {
  const routingTable = { ...payload.routingTable };
  for (const [type, role] of Object.entries(NICHE_REQUIREMENT_ROLES)) {
    routingTable[type] = { role, enabled: opts.enable };
  }
  return {
    ...payload,
    routingTable,
    nicheAssessment: payload.nicheAssessment ?? { allowManualFineFragrance: true },
  };
}

export function hasNicheRouting(payload: RuleSetPayload): boolean {
  return Object.keys(NICHE_REQUIREMENT_ROLES).every((t) => t in payload.routingTable);
}
