/**
 * Pure Niche Brand Assessment engine — build spec §5.
 *
 * No I/O, no db or next imports. Scores a set of Yes/No answers against a
 * versioned framework payload (§4.4). Ported from the V5.1 standalone tool
 * (parity/niche/CPL_Niche_Brand_Assessment_V5_1.html); parity is proven for
 * all 2^14 answer combinations in niche-parity.test.ts.
 */

export type NicheBand =
  | "strategic_partner"
  | "growth_partner"
  | "development_opportunity"
  | "charge_or_decline";

export const NICHE_BANDS: readonly NicheBand[] = [
  "strategic_partner",
  "growth_partner",
  "development_opportunity",
  "charge_or_decline",
];

export type NicheRoute =
  | "standard"
  | "charging_model"
  | "junior_perfumer_development"
  | "perfumer_passion_project"
  | "decline";

export const NICHE_ROUTES: readonly NicheRoute[] = [
  "standard",
  "charging_model",
  "junior_perfumer_development",
  "perfumer_passion_project",
  "decline",
];

export interface NicheFrameworkPayload {
  sections: Array<{
    key: string;
    title: string;
    description: string;
    criteria: Array<{
      key: string; // stable, never reused for a different question
      text: string;
      weight: number; // integer >= 0
      helpText?: string;
    }>;
  }>;
  bands: Array<{
    key: NicheBand;
    minScore: number; // inclusive lower bound
    label: string;
    shortLabel: string;
    colour: string;
    allowedRoutes: NicheRoute[];
    defaultRoute: NicheRoute | null;
  }>;
  maxScore: number;
  validityMonths: number;
  expiryReminderDays: number;
  reviewerRoleKey: string;
}

export type NicheAnswer = "yes" | "no";
export type NicheAnswers = Record<string, NicheAnswer>;

export interface NicheScoreResult {
  complete: boolean;
  answeredCount: number;
  totalCount: number;
  /** Sum of weights for "yes"; computed even when incomplete. */
  score: number;
  sectionScores: Record<string, { score: number; max: number }>;
  /** null until every criterion is answered (V5.1 defect 3). */
  band: NicheBand | null;
}

export function scoreNicheAssessment(
  answers: NicheAnswers,
  fw: NicheFrameworkPayload,
): NicheScoreResult {
  const known = new Set(fw.sections.flatMap((s) => s.criteria.map((c) => c.key)));
  for (const [key, value] of Object.entries(answers)) {
    if (!known.has(key)) throw new Error(`Unknown criterion key: "${key}"`);
    if (value !== "yes" && value !== "no") {
      throw new Error(`Invalid answer for "${key}": "${String(value)}"`);
    }
  }

  let score = 0;
  let answeredCount = 0;
  let totalCount = 0;
  const sectionScores: NicheScoreResult["sectionScores"] = {};
  for (const section of fw.sections) {
    let sectionScore = 0;
    let sectionMax = 0;
    for (const c of section.criteria) {
      totalCount += 1;
      sectionMax += c.weight;
      const a = answers[c.key];
      if (a !== undefined) answeredCount += 1;
      if (a === "yes") sectionScore += c.weight;
    }
    sectionScores[section.key] = { score: sectionScore, max: sectionMax };
    score += sectionScore;
  }
  const complete = answeredCount === totalCount;
  return {
    complete,
    answeredCount,
    totalCount,
    score,
    sectionScores,
    band: complete ? bandForScore(score, fw) : null,
  };
}

/** First band, ordered highest first, whose minScore <= score. */
export function bandForScore(score: number, fw: NicheFrameworkPayload): NicheBand {
  const ordered = [...fw.bands].sort((a, b) => b.minScore - a.minScore);
  for (const b of ordered) if (score >= b.minScore) return b.key;
  throw new Error(`No band for score ${score}`);
}

/** Validation on save and publish (§4.4). Empty array means valid. */
export function validateNicheFramework(
  fw: NicheFrameworkPayload,
  approvalAuthorityRoleKeys?: readonly string[],
): string[] {
  const errors: string[] = [];

  const keys = fw.sections.flatMap((s) => s.criteria.map((c) => c.key));
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dupes.length)
    errors.push(`Duplicate criterion keys: ${[...new Set(dupes)].join(", ")}`);

  for (const s of fw.sections) {
    for (const c of s.criteria) {
      if (!Number.isInteger(c.weight) || c.weight < 0) {
        errors.push(`Weight for "${c.key}" must be a non-negative integer`);
      }
    }
  }

  const sum = fw.sections.reduce(
    (t, s) =>
      t + s.criteria.reduce((u, c) => u + (Number.isFinite(c.weight) ? c.weight : 0), 0),
    0,
  );
  if (fw.maxScore !== sum)
    errors.push(`maxScore (${fw.maxScore}) must equal the sum of weights (${sum})`);

  const mins = fw.bands.map((b) => b.minScore);
  const sorted = fw.bands.every(
    (b, i) => i === 0 || fw.bands[i - 1]!.minScore > b.minScore,
  );
  if (!sorted)
    errors.push("Bands must be ordered by minScore descending with no duplicates");
  if (mins.length === 0 || Math.min(...mins) !== 0)
    errors.push("The lowest band must have minScore 0");
  if (mins.some((m) => !Number.isInteger(m) || m < 0 || m > fw.maxScore)) {
    errors.push("Band minScore values must be integers between 0 and maxScore");
  }

  const bandKeys = fw.bands.map((b) => b.key);
  for (const k of NICHE_BANDS) {
    const n = bandKeys.filter((x) => x === k).length;
    if (n !== 1) errors.push(`Band "${k}" must appear exactly once (found ${n})`);
  }
  if (bandKeys.some((k) => !NICHE_BANDS.includes(k))) errors.push("Unknown band key");

  if (
    approvalAuthorityRoleKeys &&
    !approvalAuthorityRoleKeys.includes(fw.reviewerRoleKey)
  ) {
    errors.push(
      `reviewerRoleKey "${fw.reviewerRoleKey}" is not an approval-authority role`,
    );
  }
  if (!Number.isInteger(fw.validityMonths) || fw.validityMonths <= 0) {
    errors.push("validityMonths must be a positive integer");
  }
  if (!Number.isInteger(fw.expiryReminderDays) || fw.expiryReminderDays < 0) {
    errors.push("expiryReminderDays must be a non-negative integer");
  }
  return errors;
}

/**
 * An approved assessment is current while today <= valid_until.
 * Dates are ISO yyyy-mm-dd (Europe/London); compared as dates, not timestamps.
 */
export function isAssessmentCurrent(
  a: { status: string; validUntil: string | null },
  today: string,
): boolean {
  return a.status === "approved" && a.validUntil !== null && a.validUntil >= today;
}

export function allowedRoutesFor(
  band: NicheBand,
  fw: NicheFrameworkPayload,
): NicheRoute[] {
  const b = fw.bands.find((x) => x.key === band);
  if (!b) throw new Error(`Unknown band: "${band}"`);
  return [...b.allowedRoutes];
}

/** Today's date as ISO yyyy-mm-dd in Europe/London. */
export function todayLondon(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Add whole months to an ISO date, clamping to month end (31 Jan + 1 = 28/29 Feb). */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, last);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/** Lowercased, trimmed, internal whitespace collapsed (brand de-duplication key). */
export function normaliseBrandName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
