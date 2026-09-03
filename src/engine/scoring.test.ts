import { describe, it, expect } from "vitest";
import { computeScore, type RuleSetPayload } from "./scoring.js";
import rulesetV1 from "../db/seed/ruleset-v1.generated.json" with { type: "json" };

const ruleSet = rulesetV1 as unknown as RuleSetPayload;

describe("computeScore", () => {
  it("zeroes every value-derived component when value potential is 0", () => {
    const { total, breakdown } = computeScore(
      {
        customerTier: "B",
        valuePotentialGbp: 0,
        newRework: "New",
        briefType: "Exclusive",
        customerApproval: "Direct",
        strategicPriority: false,
        creativeApproach: "Creation/Unknown",
      },
      ruleSet,
    );
    expect(breakdown.valuePotential).toBe(0);
    expect(breakdown.newRework).toBe(0);
    expect(breakdown.briefType).toBe(0);
    expect(breakdown.customerApproval).toBe(0);
    // Tier weight still applies even with no value.
    expect(breakdown.customerTier).toBe(50);
    expect(total).toBe(50);
  });

  it("zeroes value-derived components for a negative value potential too", () => {
    const { breakdown } = computeScore(
      {
        customerTier: "A/T",
        valuePotentialGbp: -5000,
        newRework: "New",
        briefType: "Exclusive",
        customerApproval: "Direct",
        strategicPriority: false,
        creativeApproach: "Library Only",
      },
      ruleSet,
    );
    expect(breakdown.valuePotential).toBe(0);
  });

  it("matches a hand-computed A/T, £200k, New, Exclusive, Direct, Library Only brief", () => {
    // V = 200. tier=100, value=200, newRework=200*1=200, briefType=200*1=200,
    // customerApproval=200*0.5=100, strategic=0, creative=100.
    // total = 100+200+200+200+100+0+100 = 900
    const { total, breakdown } = computeScore(
      {
        customerTier: "A/T",
        valuePotentialGbp: 200_000,
        newRework: "New",
        briefType: "Exclusive",
        customerApproval: "Direct",
        strategicPriority: false,
        creativeApproach: "Library Only",
      },
      ruleSet,
    );
    expect(breakdown).toEqual({
      customerTier: 100,
      valuePotential: 200,
      newRework: 200,
      briefType: 200,
      customerApproval: 100,
      strategicPriority: 0,
      creativeApproach: 100,
    });
    expect(total).toBe(900);
  });

  it("applies the ProActive brief-type multiplier as negative", () => {
    const { breakdown } = computeScore(
      {
        customerTier: "D",
        valuePotentialGbp: 10_000,
        newRework: "Rework (Non-Selling)",
        briefType: "ProActive",
        customerApproval: "Deferred/Unknown",
        strategicPriority: false,
        creativeApproach: "Creation/Unknown",
      },
      ruleSet,
    );
    // V=10, briefType = 10 * -0.5 = -5
    expect(breakdown.briefType).toBe(-5);
  });

  it("throws rather than silently defaulting on an unknown enum value", () => {
    expect(() =>
      computeScore(
        {
          customerTier: "Z", // not a real tier
          valuePotentialGbp: 1000,
          newRework: "New",
          briefType: "Exclusive",
          customerApproval: "Direct",
          strategicPriority: false,
          creativeApproach: "Library Only",
        },
        ruleSet,
      ),
    ).toThrow(/Unknown customerTier value/);
  });
});
