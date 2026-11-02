import { describe, expect, it } from "vitest";
import { computeScore, type RuleSetPayload } from "./scoring.js";
import { canonicalTier, isTierAOrT, resolveTierKey, withTierT } from "./tiers.js";
import rulesetV1 from "../db/seed/ruleset-v1.generated.json" with { type: "json" };

const v1 = rulesetV1 as unknown as RuleSetPayload;

describe("canonicalTier / isTierAOrT", () => {
  it("maps the legacy merged value to A and leaves everything else alone", () => {
    expect(canonicalTier("A/T")).toBe("A");
    for (const t of ["A", "T", "B", "C", "D"]) expect(canonicalTier(t)).toBe(t);
  });

  it("recognises A, T and the legacy value, and nothing else", () => {
    for (const t of ["A", "T", "A/T"]) expect(isTierAOrT(t)).toBe(true);
    for (const t of ["B", "C", "D", "X"]) expect(isTierAOrT(t)).toBe(false);
  });
});

describe("resolveTierKey", () => {
  it("finds exact keys", () => {
    expect(resolveTierKey({ B: 50 }, "B")).toBe("B");
  });

  it("lets tier A resolve to the legacy A/T key in an old rule set, and the reverse", () => {
    expect(resolveTierKey({ "A/T": 100 }, "A")).toBe("A/T");
    expect(resolveTierKey({ A: 100, T: 100 }, "A/T")).toBe("A");
  });

  it("never aliases T: it is unknown until a rule set defines it", () => {
    expect(resolveTierKey({ "A/T": 100 }, "T")).toBeUndefined();
    expect(resolveTierKey({ B: 50 }, "A")).toBeUndefined();
  });
});

describe("withTierT", () => {
  const split = withTierT(v1);

  it("splits A/T into A and T with the same weight, leaving other tiers alone", () => {
    expect(split.tierWeights).toEqual({ A: 100, T: 100, B: 50, C: 25, D: 10 });
    expect(split.tierWeights).not.toHaveProperty("A/T");
  });

  it("enables the tier-T routing entry for the Commercial Director", () => {
    expect(split.routingTable["tier_auto_approval"]).toEqual({
      role: "commercial_director",
      enabled: true,
    });
  });

  it("does not mutate its input and is idempotent", () => {
    expect(v1.tierWeights).toHaveProperty("A/T");
    expect(withTierT(split)).toBe(split);
  });

  it("keeps every existing score identical: legacy A/T, A and T all score the same as v1's A/T", () => {
    const base = {
      valuePotentialGbp: 80_000,
      newRework: "New",
      briefType: "Exclusive",
      customerApproval: "Direct",
      strategicPriority: false,
      creativeApproach: "Library Only",
    };
    const before = computeScore({ ...base, customerTier: "A/T" }, v1).total;
    expect(computeScore({ ...base, customerTier: "A" }, v1).total).toBe(before);
    for (const customerTier of ["A/T", "A", "T"]) {
      expect(computeScore({ ...base, customerTier }, split).total).toBe(before);
    }
  });

  it("makes T an unknown tier under the old rule set", () => {
    expect(() =>
      computeScore(
        {
          customerTier: "T",
          valuePotentialGbp: 1,
          newRework: "New",
          briefType: "Exclusive",
          customerApproval: "Direct",
          strategicPriority: false,
          creativeApproach: "Library Only",
        },
        v1,
      ),
    ).toThrow(/Unknown customerTier/);
  });

  it("falls back to the commercial_director role when the routing entry is missing, and rejects a rule set with no A/T to split", () => {
    const rest = { ...v1.routingTable };
    delete rest["tier_auto_approval"];
    const noEntry = withTierT({ ...v1, routingTable: rest });
    expect(noEntry.routingTable["tier_auto_approval"]).toEqual({
      role: "commercial_director",
      enabled: true,
    });
    expect(() => withTierT({ ...v1, tierWeights: { B: 50 } })).toThrow(/no "A\/T" tier/);
  });
});
