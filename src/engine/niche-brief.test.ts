import { describe, expect, it } from "vitest";
import {
  deriveNicheForBrief,
  type CurrentAssessmentFacts,
  type NicheBriefInput,
} from "./niche-brief.js";
import { NICHE_FRAMEWORK_V1 } from "./niche-framework-v1.js";
import type { NicheBand } from "./niche-assessment.js";

const cur = (
  band: NicheBand,
  over: Partial<CurrentAssessmentFacts> = {},
): CurrentAssessmentFacts => ({
  id: "a1",
  reference: "NBA-2026-0042",
  band,
  score: 86,
  validUntil: "2027-11-11",
  frameworkVersion: 1,
  framework: NICHE_FRAMEWORK_V1,
  ...over,
});
const base = (over: Partial<NicheBriefInput> = {}): NicheBriefInput => ({
  nicheBrandSelected: true,
  current: cur("strategic_partner"),
  manualFineFragrance: false,
  allowManualFineFragrance: true,
  clientNicheFfPreApproved: false,
  ...over,
});
const ok = (d: ReturnType<typeof deriveNicheForBrief>) => {
  if (!d.ok) throw new Error(d.error);
  return d;
};

describe("deriveNicheForBrief: the §6.3 derivation table", () => {
  it("niche brand, current band 1: pre-approved with the generated rationale", () => {
    const d = ok(deriveNicheForBrief(base()));
    expect(d).toMatchObject({
      nicheFfPreApproved: true,
      nicheBand: "strategic_partner",
      nicheRoute: "standard",
      fineFragranceManualFlag: false,
    });
    expect(d.nicheFfRationale).toBe(
      "Niche Brand Assessment NBA-2026-0042, score 86/100, Niche Tier 1 Strategic Partner, valid until 2027-11-11",
    );
    expect(d.snapshot).toEqual({
      assessmentId: "a1",
      reference: "NBA-2026-0042",
      frameworkVersion: 1,
      score: 86,
      band: "strategic_partner",
      route: "standard",
      validUntil: "2027-11-11",
    });
  });
  it("niche brand, any other band: not pre-approved, no rationale", () => {
    const d = ok(
      deriveNicheForBrief(base({ current: cur("growth_partner", { score: 60 }) })),
    );
    expect(d).toMatchObject({
      nicheFfPreApproved: false,
      nicheFfRationale: null,
      nicheBand: "growth_partner",
      nicheRoute: "standard",
    });
  });
  it("niche brand, no current approved assessment: standard brief with a warning", () => {
    const d = ok(deriveNicheForBrief(base({ current: null })));
    expect(d).toMatchObject({
      nicheFfPreApproved: false,
      nicheFfRationale: null,
      nicheBand: null,
      nicheRoute: null,
      snapshot: null,
      warning: "no_current_assessment",
    });
  });
  it("not a niche brand, manual fine fragrance path: pre-approved with the submitter's rationale", () => {
    const d = ok(
      deriveNicheForBrief(
        base({
          nicheBrandSelected: false,
          current: null,
          manualFineFragrance: true,
          manualRationale: " Heritage house ",
        }),
      ),
    );
    expect(d).toMatchObject({
      nicheFfPreApproved: true,
      nicheFfRationale: "Heritage house",
      fineFragranceManualFlag: true,
      nicheBand: null,
    });
  });
  it("neither: not pre-approved", () => {
    const d = ok(deriveNicheForBrief(base({ nicheBrandSelected: false, current: null })));
    expect(d).toMatchObject({
      nicheFfPreApproved: false,
      nicheFfRationale: null,
      fineFragranceManualFlag: false,
    });
  });
});

describe("deriveNicheForBrief: routes (§6.4) and tamper checks (§6.8)", () => {
  it("band 3 needs a route from its allowed set plus a rationale", () => {
    const c = cur("development_opportunity", { score: 40 });
    expect(deriveNicheForBrief(base({ current: c }))).toMatchObject({ ok: false });
    expect(
      deriveNicheForBrief(base({ current: c, route: "decline", routeRationale: "x" })),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/not allowed/) });
    expect(
      deriveNicheForBrief(base({ current: c, route: "charging_model" })),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/rationale/) });
    const d = ok(
      deriveNicheForBrief(
        base({
          current: c,
          route: "perfumer_passion_project",
          routeRationale: "Founder is a perfumer",
        }),
      ),
    );
    expect(d).toMatchObject({
      nicheRoute: "perfumer_passion_project",
      nicheRouteRationale: "Founder is a perfumer",
      nicheFfPreApproved: false,
    });
  });
  it("band 4 allows charging_model or decline only", () => {
    const c = cur("charge_or_decline", { score: 10 });
    expect(
      ok(
        deriveNicheForBrief(
          base({ current: c, route: "decline", routeRationale: "Not viable" }),
        ),
      ).nicheRoute,
    ).toBe("decline");
    expect(
      deriveNicheForBrief(
        base({ current: c, route: "junior_perfumer_development", routeRationale: "x" }),
      ),
    ).toMatchObject({ ok: false });
  });
  it("band 1 and 2 reject any route other than standard", () => {
    expect(
      deriveNicheForBrief(base({ route: "charging_model", routeRationale: "x" })),
    ).toMatchObject({ ok: false });
    expect(ok(deriveNicheForBrief(base({ route: "standard" }))).nicheRoute).toBe(
      "standard",
    );
  });
  it("rejects a client-supplied pre-approval with neither an assessment nor the manual flag", () => {
    expect(
      deriveNicheForBrief(
        base({
          nicheBrandSelected: false,
          current: null,
          clientNicheFfPreApproved: true,
        }),
      ),
    ).toMatchObject({ ok: false });
    expect(deriveNicheForBrief(base({ clientNicheFfPreApproved: true }))).toMatchObject({
      ok: false,
    });
  });
  it("rejects an assessment id that is not the current one, or one sent with no current assessment", () => {
    expect(
      deriveNicheForBrief(base({ clientAssessmentId: "someone-elses" })),
    ).toMatchObject({ ok: false });
    expect(
      deriveNicheForBrief(base({ current: null, clientAssessmentId: "a1" })),
    ).toMatchObject({ ok: false });
    expect(
      ok(deriveNicheForBrief(base({ clientAssessmentId: "a1" }))).snapshot?.assessmentId,
    ).toBe("a1");
  });
  it("manual path needs a rationale and can be switched off by the rule set", () => {
    const m = base({
      nicheBrandSelected: false,
      current: null,
      manualFineFragrance: true,
    });
    expect(deriveNicheForBrief({ ...m, manualRationale: " " })).toMatchObject({
      ok: false,
    });
    expect(
      deriveNicheForBrief({
        ...m,
        manualRationale: "Heritage",
        allowManualFineFragrance: false,
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/switched off/) });
  });
  it("cannot combine a niche brand with the manual path, or set a route without a niche brand", () => {
    expect(
      deriveNicheForBrief(base({ manualFineFragrance: true, manualRationale: "x" })),
    ).toMatchObject({ ok: false });
    expect(
      deriveNicheForBrief(
        base({ nicheBrandSelected: false, current: null, route: "decline" }),
      ),
    ).toMatchObject({ ok: false });
  });
});
