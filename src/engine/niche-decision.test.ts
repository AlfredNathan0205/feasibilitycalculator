import { describe, expect, it } from "vitest";
import { computeStageA, computeStageB, type DecisionInputs } from "./decision.js";
import type { RuleSetPayload } from "./scoring.js";
import { addNicheRouting } from "./niche-rollout.js";
import rulesetV1 from "../db/seed/ruleset-v1.generated.json" with { type: "json" };

const published = rulesetV1 as unknown as RuleSetPayload;
const enabled = addNicheRouting(published, { enable: true });

function inputs(over: Partial<DecisionInputs> = {}): DecisionInputs {
  return {
    customerTier: "B",
    valuePotentialGbp: 50_000,
    newRework: "New",
    briefType: "Exclusive",
    customerApproval: "Direct",
    strategicPriority: false,
    creativeApproach: "Library Only",
    nicheFfPreApproved: false,
    marketingFlag: false,
    ppdFlag: false,
    gcmsFlag: false,
    daysUntilDeadline: 60,
    ...over,
  };
}
const low = {
  customerTier: "D",
  valuePotentialGbp: 10_000,
  briefType: "Competitive",
  customerApproval: "Deferred/Unknown",
  creativeApproach: "Creation/Unknown",
};
const high = {};

describe("Stage A with a niche assessment (spec §6.5)", () => {
  it("band 1 (pre-approved flag derived) gives auto approval", () => {
    const r = computeStageA(
      inputs({
        ...low,
        nicheFfPreApproved: true,
        nicheBand: "strategic_partner",
        nicheRoute: "standard",
      }),
      enabled,
    );
    expect(r.commercialDecision).toBe("auto_approved");
  });
  it("band 4 with route decline gives declined even when the score would pass", () => {
    const r = computeStageA(
      inputs({ ...high, nicheBand: "charge_or_decline", nicheRoute: "decline" }),
      enabled,
    );
    expect(r.score).toBeGreaterThan(enabled.thresholds.declineAtOrBelow);
    expect(r.commercialDecision).toBe("declined");
  });
  it("Rework (Of Selling) still wins over a band 4 decline", () => {
    const r = computeStageA(
      inputs({
        newRework: "Rework (Of Selling)",
        nicheBand: "charge_or_decline",
        nicheRoute: "decline",
      }),
      enabled,
    );
    expect(r.commercialDecision).toBe("auto_approved");
  });
  it("band 4 with charging model falls through to the normal score", () => {
    const pass = computeStageA(
      inputs({ ...high, nicheBand: "charge_or_decline", nicheRoute: "charging_model" }),
      enabled,
    );
    const same = computeStageA(inputs({ ...high }), enabled);
    expect(pass.commercialDecision).toBe(same.commercialDecision);
    const fail = computeStageA(
      inputs({ ...low, nicheBand: "charge_or_decline", nicheRoute: "charging_model" }),
      enabled,
    );
    expect(fail.commercialDecision).toBe(
      computeStageA(inputs({ ...low }), enabled).commercialDecision,
    );
  });
  it("band 2 and band 3 fall through to the normal score", () => {
    for (const [band, route] of [
      ["growth_partner", "standard"],
      ["development_opportunity", "junior_perfumer_development"],
    ] as const) {
      expect(
        computeStageA(inputs({ ...high, nicheBand: band, nicheRoute: route }), enabled),
      ).toEqual(computeStageA(inputs({ ...high }), enabled));
    }
  });
  it("null/absent niche inputs change nothing", () => {
    expect(computeStageA(inputs({ nicheBand: null, nicheRoute: null }), enabled)).toEqual(
      computeStageA(inputs(), enabled),
    );
  });
});

describe("Stage B niche requirements (spec §6.7)", () => {
  const types = (i: DecisionInputs, rs = enabled) =>
    computeStageB(i, rs).map((r) => `${r.requirementType}:${r.role}`);
  it("band 2 raises the Commercial Director requirement", () => {
    expect(
      types(inputs({ nicheBand: "growth_partner", nicheRoute: "standard" })),
    ).toContain("niche_growth_partner:commercial_director");
  });
  it("junior perfumer development and passion project raise the Development Director requirement", () => {
    for (const route of [
      "junior_perfumer_development",
      "perfumer_passion_project",
    ] as const) {
      expect(
        types(inputs({ nicheBand: "development_opportunity", nicheRoute: route })),
      ).toContain("niche_development_route:development_director");
    }
  });
  it("charging model raises the Commercial Director requirement", () => {
    expect(
      types(inputs({ nicheBand: "charge_or_decline", nicheRoute: "charging_model" })),
    ).toContain("niche_charging_model:commercial_director");
  });
  it("nothing is raised for band 1, decline, or no niche inputs", () => {
    const niche = (t: string[]) => t.filter((x) => x.startsWith("niche_"));
    expect(
      niche(types(inputs({ nicheBand: "strategic_partner", nicheRoute: "standard" }))),
    ).toEqual([]);
    expect(
      niche(types(inputs({ nicheBand: "charge_or_decline", nicheRoute: "decline" }))),
    ).toEqual([]);
    expect(niche(types(inputs()))).toEqual([]);
  });
  it("not raised when the rule set has them disabled or absent (existing published rule sets)", () => {
    const i = inputs({ nicheBand: "growth_partner", nicheRoute: "standard" });
    expect(types(i, published).filter((x) => x.startsWith("niche_"))).toEqual([]);
    const off = addNicheRouting(published, { enable: false });
    expect(types(i, off).filter((x) => x.startsWith("niche_"))).toEqual([]);
  });
  it("niche requirements sit beside the resource sign-offs, independent of Stage A", () => {
    const t = types(
      inputs({ nicheBand: "growth_partner", nicheRoute: "standard", ppdFlag: true }),
    );
    expect(t).toEqual(
      expect.arrayContaining([
        "ppd_resource:ppd_manager",
        "niche_growth_partner:commercial_director",
      ]),
    );
  });
});
