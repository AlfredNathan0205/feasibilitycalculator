/**
 * Niche framework v1 seed — ported verbatim from
 * CPL_Niche_Brand_Assessment_V5_1_single_comment_box.html (build spec §2.2–2.3, §4.4).
 */
import type { NicheFrameworkPayload } from "./niche-assessment.js";

export const NICHE_FRAMEWORK_V1_SOURCE_NOTE =
  "Ported from CPL_Niche_Brand_Assessment_V5_1_single_comment_box.html";

export const NICHE_FRAMEWORK_V1: NicheFrameworkPayload = {
  sections: [
    {
      key: "financial_value",
      title: "Financial Value",
      description: "Assess the commercial viability and revenue potential of the brand.",
      criteria: [
        {
          key: "fin_100k_3y",
          text: "Chance of becoming £100K+ account within 2-3 years",
          weight: 14,
          helpText: "A brand likely to reach £100K will usually also meet the £50K test.",
        },
        {
          key: "fin_50k_2y",
          text: "Chance of becoming £50K+ account within 2 years",
          weight: 9,
        },
        {
          key: "fin_forecast_12m",
          text: "Able to provide a clear 12-month volume forecast",
          weight: 5,
        },
        {
          key: "fin_supports_strategic",
          text: "Would working with this brand support other strategic accounts?",
          weight: 5,
        },
        { key: "fin_trading", text: "Currently trading in the market?", weight: 4 },
        {
          key: "fin_moq_10kg",
          text: "Agreeing to minimum 10kg PO orders with surcharge",
          weight: 3,
        },
      ],
    },
    {
      key: "brand_image_pr",
      title: "Brand Image & PR",
      description:
        "Evaluate strategic brand fit, differentiation and reputation potential.",
      criteria: [
        {
          key: "brand_differentiation",
          text: "Do they offer market concept differentiation (first mover/unique proposition)?",
          weight: 5,
        },
        {
          key: "brand_pr",
          text: "Current press credibility or future PR potential?",
          weight: 5,
        },
        {
          key: "brand_cpl_technology",
          text: "Can they support a CPL technology?",
          weight: 5,
        },
        {
          key: "brand_founder",
          text: "Credible founder with fragrance/beauty industry experience?",
          weight: 9,
        },
        { key: "brand_own_stores", text: "Do they have own-brand stores?", weight: 6 },
      ],
    },
    {
      key: "growth_potential",
      title: "Growth Potential",
      description: "Assess future expansion opportunities and long-term scalability.",
      criteria: [
        {
          key: "growth_distribution",
          text: "Strong current or future distribution/expansion plan?",
          weight: 10,
        },
        {
          key: "growth_multi_launch",
          text: "Do they have multi-launch ambitions?",
          weight: 8,
        },
        { key: "growth_investors", text: "Investor(s) behind the business?", weight: 12 },
      ],
    },
  ],
  bands: [
    {
      key: "strategic_partner",
      minScore: 80,
      label: "Tier 1 - Strategic Niche Partner",
      shortLabel: "Niche Tier 1 · Strategic Partner",
      colour: "#28a745",
      allowedRoutes: ["standard"],
      defaultRoute: "standard",
    },
    {
      key: "growth_partner",
      minScore: 55,
      label: "Tier 2 - Growth Niche Partner",
      shortLabel: "Niche Tier 2 · Growth Partner",
      colour: "#FFC107",
      allowedRoutes: ["standard"],
      defaultRoute: "standard",
    },
    {
      key: "development_opportunity",
      minScore: 35,
      label:
        "Charging Model / Junior Perfumer Development Opportunity / Perfumer Passion Project",
      shortLabel: "Development Opportunity",
      colour: "#FD7E14",
      allowedRoutes: [
        "charging_model",
        "junior_perfumer_development",
        "perfumer_passion_project",
      ],
      defaultRoute: null,
    },
    {
      key: "charge_or_decline",
      minScore: 0,
      label: "Charging Model / Decline",
      shortLabel: "Charge or Decline",
      colour: "#DC3545",
      allowedRoutes: ["charging_model", "decline"],
      defaultRoute: null,
    },
  ],
  maxScore: 100,
  validityMonths: 12,
  expiryReminderDays: 30,
  reviewerRoleKey: "commercial_director",
};
