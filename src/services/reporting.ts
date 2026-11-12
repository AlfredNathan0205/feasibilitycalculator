/**
 * Reporting — Build Prompt §9, "For Admin and Auditor":
 *   - Volume and outcome mix over time, by customer tier and by
 *     requirement type.
 *   - Approval rate and median time-to-decision per approver role.
 *   - Score distribution against the current thresholds.
 *   - Pre-approval usage per submitter, with revocations highlighted.
 *   - Short-deadline volume over time.
 *   - CSV and XLSX export of any filtered view.
 *
 * These are read-only aggregation queries — no authz here either, same
 * convention as the other services (callers check Admin/Auditor first).
 */

import { sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import { todayLondon } from "../engine/niche-assessment.js";

/**
 * The "Account Manager of record" for a brief: the person it was submitted on
 * behalf of when a Sales Coordinator raised it, otherwise whoever submitted it.
 * Every account-manager view groups and filters on this, never on submitted_by
 * alone, so a coordinator's briefs count towards the manager they were for.
 */
const AM_OF_RECORD = sql`coalesce(b.on_behalf_of, b.submitted_by)`;

export interface ReportFilter {
  /** Restrict to briefs whose Account Manager of record is this user. */
  accountManagerId?: string;
}

function amFilter(filter?: ReportFilter): SQL {
  return filter?.accountManagerId
    ? sql`AND ${AM_OF_RECORD} = ${filter.accountManagerId}`
    : sql``;
}

export interface VolumeOutcomeMixRow {
  month: string; // "2026-09"
  finalStatus: string;
  count: number;
}

export async function getVolumeOutcomeMixByMonth(
  db: PostgresJsDatabase<typeof schema>,
  filter?: ReportFilter,
): Promise<VolumeOutcomeMixRow[]> {
  const rows = await db.execute(sql`
    SELECT
      to_char(date_trunc('month', b.submitted_at), 'YYYY-MM') AS month,
      d.final_status AS "finalStatus",
      count(*)::int AS count
    FROM briefs b
    JOIN decisions d ON d.brief_id = b.id
    WHERE true ${amFilter(filter)}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  return rows as unknown as VolumeOutcomeMixRow[];
}

export interface VolumeByDimensionRow {
  dimension: string;
  count: number;
}

export async function getVolumeByTier(
  db: PostgresJsDatabase<typeof schema>,
  filter?: ReportFilter,
): Promise<VolumeByDimensionRow[]> {
  const rows = await db.execute(sql`
    SELECT b.tier AS dimension, count(*)::int AS count
    FROM briefs b
    WHERE true ${amFilter(filter)}
    GROUP BY b.tier
    ORDER BY b.tier
  `);
  return rows as unknown as VolumeByDimensionRow[];
}

export async function getVolumeByRequirementType(
  db: PostgresJsDatabase<typeof schema>,
  filter?: ReportFilter,
): Promise<VolumeByDimensionRow[]> {
  const rows = await db.execute(sql`
    SELECT ar.requirement_type AS dimension, count(*)::int AS count
    FROM approval_requirements ar
    JOIN briefs b ON b.id = ar.brief_id
    WHERE true ${amFilter(filter)}
    GROUP BY ar.requirement_type
    ORDER BY count DESC
  `);
  return rows as unknown as VolumeByDimensionRow[];
}

export interface ApprovalRateByRoleRow {
  requiredRoleKey: string;
  approvedCount: number;
  rejectedCount: number;
  approvalRate: number | null;
  medianHoursToDecision: number | null;
}

export async function getApprovalRateByRole(
  db: PostgresJsDatabase<typeof schema>,
): Promise<ApprovalRateByRoleRow[]> {
  const rows = await db.execute(sql`
    SELECT
      required_role_key AS "requiredRoleKey",
      count(*) FILTER (WHERE state = 'approved')::int AS "approvedCount",
      count(*) FILTER (WHERE state = 'rejected')::int AS "rejectedCount",
      CASE
        WHEN count(*) FILTER (WHERE state IN ('approved','rejected')) = 0 THEN NULL
        ELSE round(
          count(*) FILTER (WHERE state = 'approved')::numeric
          / count(*) FILTER (WHERE state IN ('approved','rejected')),
          3
        )
      END AS "approvalRate",
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (decided_at - created_at)) / 3600.0
      ) FILTER (WHERE state IN ('approved','rejected')) AS "medianHoursToDecision"
    FROM approval_requirements
    GROUP BY required_role_key
    ORDER BY required_role_key
  `);
  return (rows as unknown as ApprovalRateByRoleRow[]).map((r) => ({
    ...r,
    medianHoursToDecision:
      r.medianHoursToDecision === null ? null : Number(r.medianHoursToDecision),
  }));
}

export interface ScoreDistributionBucket {
  bucketLabel: string;
  bucketMin: number;
  count: number;
}

export async function getScoreDistribution(
  db: PostgresJsDatabase<typeof schema>,
  bucketWidth = 25,
  filter?: ReportFilter,
): Promise<ScoreDistributionBucket[]> {
  const rows = await db.execute(sql`
    SELECT
      (floor(d.computed_score / ${bucketWidth}) * ${bucketWidth})::int AS "bucketMin",
      count(*)::int AS count
    FROM decisions d
    JOIN briefs b ON b.id = d.brief_id
    WHERE true ${amFilter(filter)}
    GROUP BY 1
    ORDER BY 1
  `);
  return (rows as unknown as { bucketMin: number; count: number }[]).map((r) => ({
    bucketLabel: `${r.bucketMin}–${r.bucketMin + bucketWidth}`,
    bucketMin: r.bucketMin,
    count: r.count,
  }));
}

export interface PreApprovalUsageRow {
  submitterId: string;
  submitterName: string;
  preApprovalCount: number;
  revokedCount: number;
}

export async function getPreApprovalUsageBySubmitter(
  db: PostgresJsDatabase<typeof schema>,
  filter?: ReportFilter,
): Promise<PreApprovalUsageRow[]> {
  const rows = await db.execute(sql`
    SELECT
      u.id AS "submitterId",
      u.display_name AS "submitterName",
      count(*) FILTER (WHERE ar.state IN ('pre_approved','revoked'))::int AS "preApprovalCount",
      count(*) FILTER (WHERE ar.state = 'revoked')::int AS "revokedCount"
    FROM approval_requirements ar
    JOIN briefs b ON b.id = ar.brief_id
    JOIN users u ON u.id = b.submitted_by
    WHERE ar.state IN ('pre_approved', 'revoked') ${amFilter(filter)}
    GROUP BY u.id, u.display_name
    ORDER BY "preApprovalCount" DESC
  `);
  return rows as unknown as PreApprovalUsageRow[];
}

export interface ShortDeadlineVolumeRow {
  month: string;
  count: number;
}

export async function getShortDeadlineVolumeByMonth(
  db: PostgresJsDatabase<typeof schema>,
  filter?: ReportFilter,
): Promise<ShortDeadlineVolumeRow[]> {
  const rows = await db.execute(sql`
    SELECT
      to_char(date_trunc('month', ar.created_at), 'YYYY-MM') AS month,
      count(*)::int AS count
    FROM approval_requirements ar
    JOIN briefs b ON b.id = ar.brief_id
    WHERE ar.requirement_type = 'short_deadline' ${amFilter(filter)}
    GROUP BY 1
    ORDER BY 1
  `);
  return rows as unknown as ShortDeadlineVolumeRow[];
}

export interface AccountManagerOption {
  id: string;
  name: string;
}

/** People who are the Account Manager of record on at least one brief. */
export async function listAccountManagersWithBriefs(
  db: PostgresJsDatabase<typeof schema>,
): Promise<AccountManagerOption[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT u.id, u.display_name AS name
    FROM briefs b
    JOIN users u ON u.id = ${AM_OF_RECORD}
    ORDER BY u.display_name
  `);
  return rows as unknown as AccountManagerOption[];
}

export interface BriefsByAccountManagerRow {
  accountManagerId: string;
  accountManagerName: string;
  total: number;
  approved: number;
  pending: number;
  declined: number;
  /** Sign-offs still waiting on an approver across this person's briefs. */
  outstandingSignOffs: number;
  valuePotentialGbp: number;
}

export async function getBriefsByAccountManager(
  db: PostgresJsDatabase<typeof schema>,
): Promise<BriefsByAccountManagerRow[]> {
  const rows = await db.execute(sql`
    SELECT
      u.id AS "accountManagerId",
      u.display_name AS "accountManagerName",
      count(*)::int AS total,
      count(*) FILTER (WHERE d.final_status = 'approved')::int AS approved,
      count(*) FILTER (WHERE d.final_status = 'pending')::int AS pending,
      count(*) FILTER (WHERE d.final_status = 'declined')::int AS declined,
      coalesce(sum((
        SELECT count(*) FROM approval_requirements r
        WHERE r.brief_id = b.id AND r.state IN ('pending', 'revoked')
          AND d.final_status = 'pending'
      )), 0)::int AS "outstandingSignOffs",
      coalesce(sum(b.value_potential_gbp), 0)::float8 AS "valuePotentialGbp"
    FROM briefs b
    JOIN decisions d ON d.brief_id = b.id
    JOIN users u ON u.id = ${AM_OF_RECORD}
    GROUP BY u.id, u.display_name
    ORDER BY total DESC, u.display_name
  `);
  return rows as unknown as BriefsByAccountManagerRow[];
}

export interface MonthlyActivityRow {
  month: string; // "2026-11"
  briefs: number;
  valuePotentialGbp: number;
  /** Sign-offs raised that month, by the resource they draw on. */
  marketing: number;
  ppd: number;
  gcms: number;
  creative: number;
  shortDeadline: number;
}

/** Month by month: how many briefs came in, their value, and how much
 * Marketing, PPD, GCMS and Creative time they asked for. */
export async function getMonthlyActivity(
  db: PostgresJsDatabase<typeof schema>,
  filter?: ReportFilter,
): Promise<MonthlyActivityRow[]> {
  const rows = await db.execute(sql`
    SELECT
      to_char(date_trunc('month', b.submitted_at), 'YYYY-MM') AS month,
      count(*)::int AS briefs,
      coalesce(sum(b.value_potential_gbp), 0)::float8 AS "valuePotentialGbp",
      coalesce(sum((SELECT count(*) FROM approval_requirements r
        WHERE r.brief_id = b.id AND r.requirement_type = 'marketing_resource')), 0)::int AS marketing,
      coalesce(sum((SELECT count(*) FROM approval_requirements r
        WHERE r.brief_id = b.id AND r.requirement_type = 'ppd_resource')), 0)::int AS ppd,
      coalesce(sum((SELECT count(*) FROM approval_requirements r
        WHERE r.brief_id = b.id AND r.requirement_type = 'gcms_resource')), 0)::int AS gcms,
      coalesce(sum((SELECT count(*) FROM approval_requirements r
        WHERE r.brief_id = b.id
          AND r.requirement_type IN ('creative_creation', 'creative_starting_point'))), 0)::int AS creative,
      coalesce(sum((SELECT count(*) FROM approval_requirements r
        WHERE r.brief_id = b.id AND r.requirement_type = 'short_deadline')), 0)::int AS "shortDeadline"
    FROM briefs b
    WHERE true ${amFilter(filter)}
    GROUP BY 1
    ORDER BY 1 DESC
  `);
  return rows as unknown as MonthlyActivityRow[];
}

export interface NicheSummary {
  /** Brands by the band of their current (approved, unexpired) assessment. */
  assessmentsByBand: Array<{ band: string; count: number }>;
  awaitingReview: number;
  /** Current assessments expiring within 30 days. */
  expiringSoon: Array<{ brandName: string; reference: string; validUntil: string }>;
  /** Brief outcomes split by niche band, the manual fine fragrance path, or neither. */
  briefOutcomesByNiche: Array<{ path: string; finalStatus: string; count: number }>;
}

export async function getNicheSummary(
  db: PostgresJsDatabase<typeof schema>,
  filter?: ReportFilter,
  today: string = todayLondon(),
): Promise<NicheSummary> {
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 30);
  const soonIso = soon.toISOString().slice(0, 10);
  const byBand = await db.execute(sql`
    SELECT band, count(*)::int AS count FROM (
      SELECT DISTINCT ON (a.brand_id) a.band
      FROM niche_assessments a JOIN niche_brands nb ON nb.id = a.brand_id
      WHERE a.status = 'approved' AND a.valid_until >= ${today} AND nb.active
      ORDER BY a.brand_id, a.reviewed_at DESC
    ) t GROUP BY band ORDER BY band
  `);
  const [awaiting] = (await db.execute(
    sql`SELECT count(*)::int AS n FROM niche_assessments WHERE status = 'submitted'`,
  )) as unknown as Array<{ n: number }>;
  const expiring = await db.execute(sql`
    SELECT nb.name AS "brandName", a.reference, a.valid_until::text AS "validUntil"
    FROM niche_assessments a JOIN niche_brands nb ON nb.id = a.brand_id
    WHERE a.status = 'approved' AND nb.active
      AND a.valid_until >= ${today} AND a.valid_until <= ${soonIso}
      AND NOT EXISTS (SELECT 1 FROM niche_assessments n WHERE n.supersedes_id = a.id)
    ORDER BY a.valid_until
  `);
  const outcomes = await db.execute(sql`
    SELECT
      CASE
        WHEN d.niche_snapshot IS NOT NULL THEN d.niche_snapshot->>'band'
        WHEN b.fine_fragrance_manual_flag THEN 'manual_fine_fragrance'
        ELSE 'none'
      END AS path,
      d.final_status AS "finalStatus",
      count(*)::int AS count
    FROM briefs b JOIN decisions d ON d.brief_id = b.id
    WHERE true ${amFilter(filter)}
    GROUP BY 1, 2 ORDER BY 1, 2
  `);
  return {
    assessmentsByBand: byBand as unknown as NicheSummary["assessmentsByBand"],
    awaitingReview: awaiting?.n ?? 0,
    expiringSoon: expiring as unknown as NicheSummary["expiringSoon"],
    briefOutcomesByNiche: outcomes as unknown as NicheSummary["briefOutcomesByNiche"],
  };
}

export interface DashboardSummary {
  volumeOutcomeMixByMonth: VolumeOutcomeMixRow[];
  volumeByTier: VolumeByDimensionRow[];
  volumeByRequirementType: VolumeByDimensionRow[];
  approvalRateByRole: ApprovalRateByRoleRow[];
  scoreDistribution: ScoreDistributionBucket[];
  preApprovalUsage: PreApprovalUsageRow[];
  shortDeadlineVolumeByMonth: ShortDeadlineVolumeRow[];
  monthlyActivity: MonthlyActivityRow[];
  briefsByAccountManager: BriefsByAccountManagerRow[];
  accountManagers: AccountManagerOption[];
  niche: NicheSummary;
}

/** `filter` narrows every panel about briefs. Approval rate by role is about
 * the approvers, not the briefs, so it always shows the whole team; the
 * by-account-manager table always lists everyone so the view can be switched. */
export async function getDashboardSummary(
  db: PostgresJsDatabase<typeof schema>,
  filter?: ReportFilter,
): Promise<DashboardSummary> {
  const [
    volumeOutcomeMixByMonth,
    volumeByTier,
    volumeByRequirementType,
    approvalRateByRole,
    scoreDistribution,
    preApprovalUsage,
    shortDeadlineVolumeByMonth,
    monthlyActivity,
    briefsByAccountManager,
    accountManagers,
  ] = await Promise.all([
    getVolumeOutcomeMixByMonth(db, filter),
    getVolumeByTier(db, filter),
    getVolumeByRequirementType(db, filter),
    getApprovalRateByRole(db),
    getScoreDistribution(db, 25, filter),
    getPreApprovalUsageBySubmitter(db, filter),
    getShortDeadlineVolumeByMonth(db, filter),
    getMonthlyActivity(db, filter),
    getBriefsByAccountManager(db),
    listAccountManagersWithBriefs(db),
  ]);
  // After the parallel batch, so the dashboard never opens more concurrent queries than before.
  const niche = await getNicheSummary(db, filter);
  return {
    volumeOutcomeMixByMonth,
    volumeByTier,
    volumeByRequirementType,
    approvalRateByRole,
    scoreDistribution,
    preApprovalUsage,
    shortDeadlineVolumeByMonth,
    monthlyActivity,
    briefsByAccountManager,
    accountManagers,
    niche,
  };
}

export async function getExportableBriefRows(
  db: PostgresJsDatabase<typeof schema>,
  filter?: ReportFilter,
) {
  return db.execute(sql`
    SELECT
      b.customer_reference AS "customerReference",
      b.tier,
      b.value_potential_gbp AS "valuePotentialGbp",
      b.new_rework AS "newRework",
      b.brief_type AS "briefType",
      b.customer_approval AS "customerApproval",
      b.creative_approach AS "creativeApproach",
      b.deadline,
      b.submitted_at AS "submittedAt",
      u.display_name AS "submittedBy",
      am.display_name AS "accountManager",
      d.computed_score AS "computedScore",
      d.commercial_decision AS "commercialDecision",
      d.final_status AS "finalStatus",
      d.approval_code AS "approvalCode",
      nb.name AS "nicheBrand",
      d.niche_snapshot->>'reference' AS "nicheAssessmentReference",
      d.niche_snapshot->>'band' AS "nicheBand",
      d.niche_snapshot->>'score' AS "nicheScore",
      b.niche_route AS "nicheRoute",
      b.niche_route_rationale AS "nicheRouteRationale",
      b.fine_fragrance_manual_flag AS "manualFineFragrancePath"
    FROM briefs b
    JOIN decisions d ON d.brief_id = b.id
    LEFT JOIN niche_brands nb ON nb.id = b.niche_brand_id
    JOIN users u ON u.id = b.submitted_by
    JOIN users am ON am.id = ${AM_OF_RECORD}
    WHERE true ${amFilter(filter)}
    ORDER BY b.submitted_at DESC
  `);
}

/** One row per assessment, one column per criterion key (Yes/No), across all framework versions. */
export async function getNicheAssessmentExportRows(
  db: PostgresJsDatabase<typeof schema>,
) {
  const rows = await db.execute(sql`
    SELECT a.reference, nb.name AS brand, f.version AS "frameworkVersion", a.status,
      a.assessment_date::text AS "assessmentDate", assessor.display_name AS assessor,
      a.score, a.band, reviewer.display_name AS reviewer, a.reviewed_at AS "reviewedAt",
      a.valid_until::text AS "validUntil", a.review_comment AS "reviewComment", a.answers
    FROM niche_assessments a
    JOIN niche_brands nb ON nb.id = a.brand_id
    JOIN niche_frameworks f ON f.id = a.framework_id
    JOIN users assessor ON assessor.id = a.assessor_id
    LEFT JOIN users reviewer ON reviewer.id = a.reviewed_by
    ORDER BY a.created_at DESC
  `);
  const list = rows as unknown as Array<
    Record<string, unknown> & { answers: Record<string, string> }
  >;
  const keys = [...new Set(list.flatMap((r) => Object.keys(r.answers ?? {})))].sort();
  return list.map(({ answers, ...rest }) => ({
    ...rest,
    ...Object.fromEntries(keys.map((k) => [k, answers?.[k] ?? ""])),
  }));
}
