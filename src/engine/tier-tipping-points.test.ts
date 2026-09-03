import { describe, it, expect } from "vitest";
import { computeTierTippingPoints } from "./tier-tipping-points.js";
import type { RuleSetPayload } from "./scoring.js";
import rulesetV1 from "../db/seed/ruleset-v1.generated.json" with { type: "json" };

const ruleSet = rulesetV1 as unknown as RuleSetPayload;

describe("computeTierTippingPoints (§10 build artefact)", () => {
  it("matches the figures the spec says Simon has already been shown and accepted", () => {
    const table = computeTierTippingPoints(ruleSet);
    const byTier = Object.fromEntries(
      table.map((t) => [t.tier, t.tippingPointGbp]),
    );
    // Spec: "around £30k for A/T, £130k for B, £180k for C and £210k for D."
    // Checked to the nearest £1000 rather than exact £, since the spec's own
    // wording is approximate ("around").
    expect(Math.round(byTier["A/T"]! / 1000)).toBe(30);
    expect(Math.round(byTier["B"]! / 1000)).toBe(130);
    expect(Math.round(byTier["C"]! / 1000)).toBe(180);
    expect(Math.round(byTier["D"]! / 1000)).toBe(210);
  });

  it("is monotonically decreasing tipping point as tier weight increases", () => {
    // Higher tier weight (A/T=100) should need less value to tip than a
    // lower tier weight (D=10), since less of the gap has to be closed by V.
    const table = computeTierTippingPoints(ruleSet);
    const byTier = Object.fromEntries(
      table.map((t) => [t.tier, t.tippingPointGbp]),
    );
    expect(byTier["A/T"]!).toBeLessThan(byTier["B"]!);
    expect(byTier["B"]!).toBeLessThan(byTier["C"]!);
    expect(byTier["C"]!).toBeLessThan(byTier["D"]!);
  });
});
