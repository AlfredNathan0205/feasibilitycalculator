import { describe, expect, it } from "vitest";
import { loadV51Reference } from "../../parity/niche/v51-reference.js";
import { NICHE_FRAMEWORK_V1 as fw } from "./niche-framework-v1.js";
import {
  scoreNicheAssessment,
  type NicheAnswers,
  type NicheBand,
} from "./niche-assessment.js";

const bandOfLabel = (label: string): NicheBand => {
  if (label.startsWith("Tier 1")) return "strategic_partner";
  if (label.startsWith("Tier 2")) return "growth_partner";
  if (label.startsWith("Charging Model / Junior")) return "development_opportunity";
  if (label === "Charging Model / Decline") return "charge_or_decline";
  throw new Error(`Unmapped V5.1 label: ${label}`);
};

describe("V5.1 parity (hard gate)", () => {
  const ref = loadV51Reference();
  const keys = fw.sections.flatMap((s) => s.criteria.map((c) => c.key));

  it("framework v1 criteria, order, text and weights match the original HTML", () => {
    const seed = fw.sections.flatMap((s) => s.criteria);
    expect(seed.map((c) => c.text)).toEqual(ref.criteria.map((c) => c.text));
    expect(seed.map((c) => c.weight)).toEqual(ref.criteria.map((c) => c.weight));
    expect(keys.length).toBe(14);
  });

  it("matches V5.1 score and band for all 2^14 = 16,384 answer combinations", () => {
    let n = 0;
    for (let mask = 0; mask < 1 << 14; mask++) {
      const ticked = keys.map((_, i) => Boolean(mask & (1 << i)));
      const answers: NicheAnswers = {};
      keys.forEach((k, i) => {
        answers[k] = ticked[i] ? "yes" : "no";
      });
      const expected = ref.calc(ticked);
      const actual = scoreNicheAssessment(answers, fw);
      if (
        actual.score !== expected.score ||
        actual.band !== bandOfLabel(expected.label)
      ) {
        throw new Error(
          `Mismatch at mask ${mask}: ${JSON.stringify({ expected, actual })}`,
        );
      }
      n++;
    }
    expect(n).toBe(16384);
  });

  it("expected deviation: incomplete returns band null where V5.1 shows a band", () => {
    const r = scoreNicheAssessment({}, fw);
    expect(r.band).toBeNull();
    expect(r.complete).toBe(false);
    expect(r.answeredCount).toBe(0);
    expect(ref.calc(keys.map(() => false)).label).toBe("Charging Model / Decline");
  });
});
