/**
 * Pure derivation of a brief's niche inputs — build spec §6.3, §6.4, §6.6, §6.8.
 *
 * The submitter no longer ticks "Niche / FF pre-approved". The flag is derived
 * from a current approved niche assessment (band 1) or from the separately
 * labelled manual fine fragrance path. Nothing the client says about the band
 * is trusted: the caller passes the assessment it looked up itself.
 */
import type { NicheBand, NicheFrameworkPayload, NicheRoute } from "./niche-assessment.js";

export interface CurrentAssessmentFacts {
  id: string;
  reference: string;
  band: NicheBand;
  score: number;
  validUntil: string;
  frameworkVersion: number;
  framework: NicheFrameworkPayload;
}

export interface NicheBriefInput {
  /** The submitter said the brief is for a niche brand. */
  nicheBrandSelected: boolean;
  /** Server-side lookup of the brand's current approved assessment, or null. */
  current: CurrentAssessmentFacts | null;
  /** Assessment id the client believes is in force (must match `current`). */
  clientAssessmentId?: string | null;
  route?: NicheRoute | null;
  routeRationale?: string | null;
  manualFineFragrance: boolean;
  manualRationale?: string | null;
  /** Rule set payload flag nicheAssessment.allowManualFineFragrance (default true). */
  allowManualFineFragrance: boolean;
  /** What the client sent for niche_ff_pre_approved; only the manual path may set it. */
  clientNicheFfPreApproved: boolean;
}

export interface NicheSnapshot {
  assessmentId: string;
  reference: string;
  frameworkVersion: number;
  score: number;
  band: NicheBand;
  route: NicheRoute;
  validUntil: string;
}

export type NicheBriefDerivation =
  | {
      ok: true;
      nicheFfPreApproved: boolean;
      nicheFfRationale: string | null;
      nicheBand: NicheBand | null;
      nicheRoute: NicheRoute | null;
      nicheRouteRationale: string | null;
      fineFragranceManualFlag: boolean;
      snapshot: NicheSnapshot | null;
      /** Set when a niche brand was chosen but has no current approved assessment. */
      warning: "no_current_assessment" | null;
    }
  | { ok: false; error: string };

const fail = (error: string): NicheBriefDerivation => ({ ok: false, error });

export function deriveNicheForBrief(input: NicheBriefInput): NicheBriefDerivation {
  const route = input.route ?? null;
  const routeRationale = input.routeRationale?.trim() || null;

  if (input.nicheBrandSelected && input.manualFineFragrance) {
    return fail(
      "Choose either a niche brand or the fine fragrance manual path, not both",
    );
  }

  // --- Manual fine fragrance path (not a niche brand) ---------------------
  if (!input.nicheBrandSelected) {
    if (route || routeRationale || input.clientAssessmentId) {
      return fail("A niche route or assessment can only be set for a niche brand");
    }
    if (input.manualFineFragrance) {
      if (!input.allowManualFineFragrance) {
        return fail(
          "The manual fine fragrance path is switched off in the current rule set",
        );
      }
      const rationale = input.manualRationale?.trim();
      if (!rationale) {
        return fail(
          "A rationale is required for the Fine Fragrance pre-approved (not a niche brand) path",
        );
      }
      return {
        ok: true,
        nicheFfPreApproved: true,
        nicheFfRationale: rationale,
        nicheBand: null,
        nicheRoute: null,
        nicheRouteRationale: null,
        fineFragranceManualFlag: true,
        snapshot: null,
        warning: null,
      };
    }
    if (input.clientNicheFfPreApproved) {
      return fail(
        "Niche / FF pre-approved can no longer be ticked directly: select a niche brand with a current approved assessment, or use the fine fragrance manual path",
      );
    }
    return {
      ok: true,
      nicheFfPreApproved: false,
      nicheFfRationale: null,
      nicheBand: null,
      nicheRoute: null,
      nicheRouteRationale: null,
      fineFragranceManualFlag: false,
      snapshot: null,
      warning: null,
    };
  }

  // --- Niche brand selected ----------------------------------------------
  if (input.clientNicheFfPreApproved) {
    return fail(
      "Niche / FF pre-approved is derived from the assessment and cannot be set directly",
    );
  }
  const cur = input.current;
  if (!cur) {
    if (input.clientAssessmentId) {
      return fail(
        "The assessment does not belong to the selected brand or is not current",
      );
    }
    if (route || routeRationale) {
      return fail(
        "A route can only be chosen for a brand with a current approved assessment",
      );
    }
    return {
      ok: true,
      nicheFfPreApproved: false,
      nicheFfRationale: null,
      nicheBand: null,
      nicheRoute: null,
      nicheRouteRationale: null,
      fineFragranceManualFlag: false,
      snapshot: null,
      warning: "no_current_assessment",
    };
  }
  if (input.clientAssessmentId && input.clientAssessmentId !== cur.id) {
    return fail("The assessment does not belong to the selected brand or is not current");
  }

  const band = cur.framework.bands.find((b) => b.key === cur.band);
  if (!band) return fail(`Framework has no band "${cur.band}"`);

  let chosen: NicheRoute;
  let chosenRationale: string | null = null;
  if (band.allowedRoutes.length === 1 && band.defaultRoute === band.allowedRoutes[0]) {
    // Bands 1 and 2: automatic "standard" route, no choice shown.
    if (route && route !== band.defaultRoute) {
      return fail(`Route "${route}" is not allowed for this assessment band`);
    }
    chosen = band.defaultRoute;
  } else {
    if (!route) return fail("Choose a route for this brand's assessment band");
    if (!band.allowedRoutes.includes(route)) {
      return fail(`Route "${route}" is not allowed for this assessment band`);
    }
    if (!routeRationale) return fail("A rationale is required for the chosen route");
    chosen = route;
    chosenRationale = routeRationale;
  }

  const preApproved = cur.band === "strategic_partner";
  const label = band.shortLabel.replace(/\s*·\s*/g, " ");
  return {
    ok: true,
    nicheFfPreApproved: preApproved,
    nicheFfRationale: preApproved
      ? `Niche Brand Assessment ${cur.reference}, score ${cur.score}/${cur.framework.maxScore}, ${label}, valid until ${cur.validUntil}`
      : null,
    nicheBand: cur.band,
    nicheRoute: chosen,
    nicheRouteRationale: chosenRationale,
    fineFragranceManualFlag: false,
    snapshot: {
      assessmentId: cur.id,
      reference: cur.reference,
      frameworkVersion: cur.frameworkVersion,
      score: cur.score,
      band: cur.band,
      route: chosen,
      validUntil: cur.validUntil,
    },
    warning: null,
  };
}
