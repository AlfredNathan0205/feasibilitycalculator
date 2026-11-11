export const REQUIREMENT_LABELS: Record<string, string> = {
  short_deadline: "Short deadline",
  creative_creation: "Creative approach (Creation)",
  creative_starting_point: "Creative approach (Starting Point)",
  marketing_resource: "Marketing resource",
  ppd_resource: "PPD resource",
  gcms_resource: "GCMS / analytical resource",
  tier_auto_approval: "Tier T auto-approval",
  niche_growth_partner: "Niche Tier 2 sign-off",
  niche_development_route: "Niche development route",
  niche_charging_model: "Niche charging model",
};

/** Always paired with the band name so a bare "Tier 1" is never shown (it would
 * be confused with customer tiers A, T, B, C, D). */
export const NICHE_BAND_LABELS: Record<string, string> = {
  strategic_partner: "Niche Tier 1 · Strategic Partner",
  growth_partner: "Niche Tier 2 · Growth Partner",
  development_opportunity: "Development Opportunity",
  charge_or_decline: "Charge or Decline",
};

export const NICHE_ROUTE_LABELS: Record<string, string> = {
  standard: "Standard",
  charging_model: "Charging model",
  junior_perfumer_development: "Junior perfumer development",
  perfumer_passion_project: "Perfumer passion project",
  decline: "Decline",
};

export const NICHE_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Awaiting review",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const NICHE_AUDIT_LABELS: Record<string, string> = {
  "niche_assessment.created": "Draft created",
  "niche_assessment.updated": "Draft saved",
  "niche_assessment.submitted": "Submitted for review",
  "niche_assessment.withdrawn": "Withdrawn",
  "niche_assessment.escalated_to_admin":
    "Escalated to Admin (assessor is the only reviewer)",
  "niche_assessment.approved": "Approved",
  "niche_assessment.rejected": "Rejected",
  "niche_assessment.superseded": "Superseded by a newer assessment",
};

export const REQUIREMENT_STATE_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  pre_approved: "Pre-approved",
  revoked: "Revoked",
};

export const COMMERCIAL_LABELS: Record<string, string> = {
  auto_approved: "Auto-approved",
  pending: "Needs approval",
  declined: "Declined",
};
