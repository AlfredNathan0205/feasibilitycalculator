import { describe, it, expect } from "vitest";
import { computeStageA, computeStageB, type DecisionInputs } from "./decision.js";
import type { RuleSetPayload } from "./scoring.js";
import { withTierT } from "./tiers.js";
import rulesetV1 from "../db/seed/ruleset-v1.generated.json" with { type: "json" };

const ruleSet = rulesetV1 as unknown as RuleSetPayload;

function baseInputs(overrides: Partial<DecisionInputs> = {}): DecisionInputs {
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
    ...overrides,
  };
}

describe("computeStageA — commercial decision ladder (§5)", () => {
  it("Rework (Of Selling) is always auto-approved regardless of score", () => {
    const result = computeStageA(
      baseInputs({
        newRework: "Rework (Of Selling)",
        valuePotentialGbp: 0, // would otherwise score very low
        creativeApproach: "Creation/Unknown",
        customerTier: "D",
      }),
      ruleSet,
    );
    expect(result.commercialDecision).toBe("auto_approved");
  });

  it("Niche/FF pre-approved is always auto-approved regardless of score", () => {
    const result = computeStageA(
      baseInputs({
        nicheFfPreApproved: true,
        valuePotentialGbp: 0,
        creativeApproach: "Creation/Unknown",
        customerTier: "D",
      }),
      ruleSet,
    );
    expect(result.commercialDecision).toBe("auto_approved");
  });

  it("a score of exactly the decline threshold (30) is declined, not pending", () => {
    // tier D=10, New (mult 1), Competitive (mult 0), Deferred/Unknown (mult 0),
    // Creation/Unknown=0, no strategic priority.
    // V = 10000/1000 = 10. total = 10 (tier) + 10 (valuePotential) + 10*1 (newRework)
    //   + 10*0 (briefType) + 10*0 (customerApproval) + 0 + 0 = 30 exactly.
    const inputs = baseInputs({
      customerTier: "D",
      valuePotentialGbp: 10_000,
      newRework: "New",
      briefType: "Competitive",
      customerApproval: "Deferred/Unknown",
      creativeApproach: "Creation/Unknown",
    });
    const result = computeStageA(inputs, ruleSet);
    expect(result.score).toBe(30);
    expect(result.commercialDecision).toBe("declined"); // 30 <= 30, per §3 "Exactly 30 is a decline"
  });

  it("score strictly greater than the auto-approve threshold is auto-approved", () => {
    const result = computeStageA(
      baseInputs({
        customerTier: "A/T", // 100
        valuePotentialGbp: 1000, // V=1, negligible
        creativeApproach: "Library Only", // 100
      }),
      ruleSet,
    );
    expect(result.score).toBeGreaterThan(ruleSet.thresholds.autoApproveAbove);
    expect(result.commercialDecision).toBe("auto_approved");
  });

  it("a mid-range score with no override falls to pending", () => {
    const result = computeStageA(
      baseInputs({
        customerTier: "B", // 50
        valuePotentialGbp: 0,
        creativeApproach: "Starting Point", // 65
      }),
      ruleSet,
    );
    expect(result.score).toBe(115); // == threshold, not > threshold
    expect(result.commercialDecision).toBe("pending");
  });

  it("is monotonic in value potential for a fixed qualitative combination", () => {
    const scores = [0, 1000, 50_000, 200_000].map(
      (v) => computeStageA(baseInputs({ valuePotentialGbp: v }), ruleSet).score,
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]!);
    }
  });

  it("is pure and deterministic: equal inputs and rule set always yield equal output", () => {
    const inputs = baseInputs({ customerTier: "D", valuePotentialGbp: 35_000 });
    const a = computeStageA(inputs, ruleSet);
    const b = computeStageA(inputs, ruleSet);
    expect(a).toEqual(b);
  });
});

describe("computeStageB — required approvals (§5), independent of Stage A", () => {
  it("raises short_deadline whenever the deadline is within the configured window, even on an auto-approved brief", () => {
    const inputs = baseInputs({
      newRework: "Rework (Of Selling)", // auto-approved commercially
      daysUntilDeadline: 7, // within 14-day window
    });
    const stageA = computeStageA(inputs, ruleSet);
    const requirements = computeStageB(inputs, ruleSet);
    expect(stageA.commercialDecision).toBe("auto_approved");
    expect(requirements.some((r) => r.requirementType === "short_deadline")).toBe(true);
  });

  it("does not raise short_deadline outside the window", () => {
    const requirements = computeStageB(baseInputs({ daysUntilDeadline: 15 }), ruleSet);
    expect(requirements.some((r) => r.requirementType === "short_deadline")).toBe(false);
  });

  it("raises creative_creation for Creation/Unknown on any non-A/T tier", () => {
    for (const tier of ["B", "C", "D"]) {
      const requirements = computeStageB(
        baseInputs({ customerTier: tier, creativeApproach: "Creation/Unknown" }),
        ruleSet,
      );
      expect(requirements.some((r) => r.requirementType === "creative_creation")).toBe(
        true,
      );
    }
  });

  it("does not raise creative_creation for A/T tier", () => {
    const requirements = computeStageB(
      baseInputs({ customerTier: "A/T", creativeApproach: "Creation/Unknown" }),
      ruleSet,
    );
    expect(requirements.some((r) => r.requirementType === "creative_creation")).toBe(
      false,
    );
  });

  it("raises creative_starting_point only for tier C or D, not A/T or B", () => {
    expect(
      computeStageB(
        baseInputs({ customerTier: "C", creativeApproach: "Starting Point" }),
        ruleSet,
      ).some((r) => r.requirementType === "creative_starting_point"),
    ).toBe(true);
    expect(
      computeStageB(
        baseInputs({ customerTier: "B", creativeApproach: "Starting Point" }),
        ruleSet,
      ).some((r) => r.requirementType === "creative_starting_point"),
    ).toBe(false);
  });

  it("resource requirements always fire, including for A/T tier (workbook's suppression is removed, §11 item 2)", () => {
    const requirements = computeStageB(
      baseInputs({ customerTier: "A/T", marketingFlag: true, ppdFlag: true }),
      ruleSet,
    );
    expect(requirements.some((r) => r.requirementType === "marketing_resource")).toBe(
      true,
    );
    expect(requirements.some((r) => r.requirementType === "ppd_resource")).toBe(true);
  });

  it("GCMS/analytical resource requirement fires when flagged, including for A/T tier — genuinely never exercised before (real gap, not just a coverage nitpick)", () => {
    const requirements = computeStageB(
      baseInputs({ customerTier: "A/T", gcmsFlag: true }),
      ruleSet,
    );
    const gcmsRequirement = requirements.find(
      (r) => r.requirementType === "gcms_resource",
    );
    expect(gcmsRequirement).toBeDefined();
    expect(gcmsRequirement!.role).toBe("analytical_manager");
  });

  describe("tier T (Target account)", () => {
    const tierTRuleSet = withTierT(ruleSet);

    it("raises a Commercial Director approval for tier T", () => {
      const requirements = computeStageB(baseInputs({ customerTier: "T" }), tierTRuleSet);
      expect(requirements).toEqual([
        { requirementType: "tier_auto_approval", role: "commercial_director" },
      ]);
    });

    it("does not raise it for tier A, the legacy merged A/T value, or any other tier", () => {
      for (const customerTier of ["A", "A/T", "B", "C", "D"]) {
        const requirements = computeStageB(baseInputs({ customerTier }), tierTRuleSet);
        expect(
          requirements.some((r) => r.requirementType === "tier_auto_approval"),
          customerTier,
        ).toBe(false);
      }
    });

    it("does nothing under a rule set that has not enabled it", () => {
      // v1 has the routing entry disabled; T is not even a known tier there.
      const requirements = computeStageB(baseInputs({ customerTier: "T" }), ruleSet);
      expect(requirements).toEqual([]);
    });

    it("treats T like A for the creative-creation rule (neither raises it)", () => {
      const inputs = { creativeApproach: "Creation/Unknown" };
      const types = (customerTier: string) =>
        computeStageB(baseInputs({ ...inputs, customerTier }), tierTRuleSet).map(
          (r) => r.requirementType,
        );
      expect(types("A")).not.toContain("creative_creation");
      expect(types("T")).not.toContain("creative_creation");
      expect(types("B")).toContain("creative_creation");
    });

    it("a high-scoring tier T brief is commercially auto-approved but still needs the Commercial Director", () => {
      const inputs = baseInputs({ customerTier: "T", valuePotentialGbp: 200_000 });
      expect(computeStageA(inputs, tierTRuleSet).commercialDecision).toBe(
        "auto_approved",
      );
      expect(computeStageB(inputs, tierTRuleSet)).toHaveLength(1);
    });
  });

  it("strategic priority does NOT raise a requirement under the current rule set (the alternate is disabled by default, §11 item 3)", () => {
    const requirements = computeStageB(baseInputs({ strategicPriority: true }), ruleSet);
    expect(
      requirements.some((r) => r.requirementType === "strategic_priority_deferral"),
    ).toBe(false);
  });
});
