import { describe, expect, it } from "vitest";
import { NICHE_FRAMEWORK_V1 as fw } from "./niche-framework-v1.js";
import {
  allowedRoutesFor,
  bandForScore,
  isAssessmentCurrent,
  scoreNicheAssessment,
  validateNicheFramework,
  type NicheAnswers,
  type NicheFrameworkPayload,
} from "./niche-assessment.js";

const keys = fw.sections.flatMap((s) => s.criteria.map((c) => c.key));
const all = (v: "yes" | "no"): NicheAnswers =>
  Object.fromEntries(keys.map((k) => [k, v]));
const clone = (): NicheFrameworkPayload => structuredClone(fw);

describe("bands", () => {
  it.each([
    [0, "charge_or_decline"],
    [34, "charge_or_decline"],
    [35, "development_opportunity"],
    [54, "development_opportunity"],
    [55, "growth_partner"],
    [79, "growth_partner"],
    [80, "strategic_partner"],
    [100, "strategic_partner"],
  ] as const)("score %i -> %s", (s, b) => {
    expect(bandForScore(s, fw)).toBe(b);
  });
});

describe("scoring", () => {
  it("all yes = 100, all no = 0, section maxima 40/30/30", () => {
    const y = scoreNicheAssessment(all("yes"), fw);
    expect(y.score).toBe(100);
    expect(y.band).toBe("strategic_partner");
    expect(y.sectionScores).toEqual({
      financial_value: { score: 40, max: 40 },
      brand_image_pr: { score: 30, max: 30 },
      growth_potential: { score: 30, max: 30 },
    });
    expect(scoreNicheAssessment(all("no"), fw)).toMatchObject({
      score: 0,
      band: "charge_or_decline",
    });
  });
  it("section scores sum to the total", () => {
    const a = {
      ...all("no"),
      fin_100k_3y: "yes",
      brand_founder: "yes",
      growth_investors: "yes",
    } as NicheAnswers;
    const r = scoreNicheAssessment(a, fw);
    expect(Object.values(r.sectionScores).reduce((t, s) => t + s.score, 0)).toBe(r.score);
    expect(r.score).toBe(35);
  });
  it("incomplete: score computed, band null, progress is answered over total", () => {
    const r = scoreNicheAssessment({ fin_100k_3y: "yes", fin_50k_2y: "no" }, fw);
    expect(r).toMatchObject({
      complete: false,
      answeredCount: 2,
      totalCount: 14,
      score: 14,
      band: null,
    });
  });
  it("throws on unknown key and on invalid value", () => {
    expect(() => scoreNicheAssessment({ nope: "yes" }, fw)).toThrow(/Unknown criterion/);
    expect(() => scoreNicheAssessment({ fin_trading: "maybe" as never }, fw)).toThrow(
      /Invalid answer/,
    );
  });
});

describe("validateNicheFramework", () => {
  it("v1 is valid", () =>
    expect(validateNicheFramework(fw, ["commercial_director"])).toEqual([]));
  it("duplicate keys", () => {
    const f = clone();
    f.sections[0]!.criteria[1]!.key = f.sections[0]!.criteria[0]!.key;
    expect(validateNicheFramework(f).join()).toMatch(/Duplicate criterion/);
  });
  it("non-integer and negative weights", () => {
    const f = clone();
    f.sections[0]!.criteria[0]!.weight = 1.5;
    f.sections[0]!.criteria[1]!.weight = -1;
    expect(validateNicheFramework(f).join()).toMatch(/non-negative integer/);
  });
  it("maxScore must equal the sum of weights", () => {
    const f = clone();
    f.maxScore = 99;
    expect(validateNicheFramework(f).join()).toMatch(/maxScore/);
  });
  it("band ordering, lowest minScore 0 and duplicates", () => {
    const f = clone();
    f.bands[3]!.minScore = 5;
    expect(validateNicheFramework(f).join()).toMatch(/lowest band/);
    const g = clone();
    g.bands[1]!.minScore = 80;
    expect(validateNicheFramework(g).join()).toMatch(/descending/);
    const h = clone();
    [h.bands[0], h.bands[1]] = [h.bands[1]!, h.bands[0]!];
    expect(validateNicheFramework(h).join()).toMatch(/descending/);
  });
  it("every band key exactly once", () => {
    const f = clone();
    f.bands[1]!.key = "strategic_partner";
    expect(validateNicheFramework(f).join()).toMatch(/exactly once/);
  });
  it("reviewer role must be an approval-authority role", () => {
    expect(validateNicheFramework(fw, ["general_manager"]).join()).toMatch(
      /reviewerRoleKey/,
    );
  });
});

describe("isAssessmentCurrent", () => {
  const a = { status: "approved", validUntil: "2027-11-11" };
  it("day before, on and after valid_until", () => {
    expect(isAssessmentCurrent(a, "2027-11-10")).toBe(true);
    expect(isAssessmentCurrent(a, "2027-11-11")).toBe(true);
    expect(isAssessmentCurrent(a, "2027-11-12")).toBe(false);
  });
  it("only approved assessments are current", () => {
    expect(
      isAssessmentCurrent(
        { status: "submitted", validUntil: "2099-01-01" },
        "2026-11-11",
      ),
    ).toBe(false);
    expect(
      isAssessmentCurrent({ status: "approved", validUntil: null }, "2026-11-11"),
    ).toBe(false);
  });
});

describe("allowedRoutesFor", () => {
  it("matches the v1 route table", () => {
    expect(allowedRoutesFor("strategic_partner", fw)).toEqual(["standard"]);
    expect(allowedRoutesFor("growth_partner", fw)).toEqual(["standard"]);
    expect(allowedRoutesFor("development_opportunity", fw)).toEqual([
      "charging_model",
      "junior_perfumer_development",
      "perfumer_passion_project",
    ]);
    expect(allowedRoutesFor("charge_or_decline", fw)).toEqual([
      "charging_model",
      "decline",
    ]);
  });
});
