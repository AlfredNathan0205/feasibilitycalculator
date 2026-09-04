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

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";

export interface VolumeOutcomeMixRow {
  month: string; // "2026-09"
  finalStatus: string;
  count: number;
}

export async function getVolumeOutcomeMixByMonth(
  db: PostgresJsDatabase<typeof schema>,
): Promise<VolumeOutcomeMixRow[]> {
  const rows = await db.execute(sql`
    SELECT
      to_char(date_trunc('month', b.submitted_at), 'YYYY-MM') AS month,
      d.final_status AS "finalStatus",
      count(*)::int AS count
    FROM briefs b
    JOIN decisions d ON d.brief_id = b.id
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
): Promise<VolumeByDimensionRow[]> {
  const rows = await db.execute(sql`
    SELECT tier AS dimension, count(*)::int AS count
    FROM briefs
    GROUP BY tier
    ORDER BY tier
  `);
  return rows as unknown as VolumeByDimensionRow[];
}

export async function getVolumeByRequirementType(
  db: PostgresJsDatabase<typeof schema>,
): Promise<VolumeByDimensionRow[]> {
  const rows = await db.execute(sql`
    SELECT requirement_type AS dimension, count(*)::int AS count
    FROM approval_requirements
    GROUP BY requirement_type
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
): Promise<ScoreDistributionBucket[]> {
  const rows = await db.execute(sql`
    SELECT
      (floor(computed_score / ${bucketWidth}) * ${bucketWidth})::int AS "bucketMin",
      count(*)::int AS count
    FROM decisions
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
    WHERE ar.state IN ('pre_approved', 'revoked')
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
): Promise<ShortDeadlineVolumeRow[]> {
  const rows = await db.execute(sql`
    SELECT
      to_char(date_trunc('month', ar.created_at), 'YYYY-MM') AS month,
      count(*)::int AS count
    FROM approval_requirements ar
    WHERE ar.requirement_type = 'short_deadline'
    GROUP BY 1
    ORDER BY 1
  `);
  return rows as unknown as ShortDeadlineVolumeRow[];
}

export interface DashboardSummary {
  volumeOutcomeMixByMonth: VolumeOutcomeMixRow[];
  volumeByTier: VolumeByDimensionRow[];
  volumeByRequirementType: VolumeByDimensionRow[];
  approvalRateByRole: ApprovalRateByRoleRow[];
  scoreDistribution: ScoreDistributionBucket[];
  preApprovalUsage: PreApprovalUsageRow[];
  shortDeadlineVolumeByMonth: ShortDeadlineVolumeRow[];
}

export async function getDashboardSummary(
  db: PostgresJsDatabase<typeof schema>,
): Promise<DashboardSummary> {
  const [
    volumeOutcomeMixByMonth,
    volumeByTier,
    volumeByRequirementType,
    approvalRateByRole,
    scoreDistribution,
    preApprovalUsage,
    shortDeadlineVolumeByMonth,
  ] = await Promise.all([
    getVolumeOutcomeMixByMonth(db),
    getVolumeByTier(db),
    getVolumeByRequirementType(db),
    getApprovalRateByRole(db),
    getScoreDistribution(db),
    getPreApprovalUsageBySubmitter(db),
    getShortDeadlineVolumeByMonth(db),
  ]);
  return {
    volumeOutcomeMixByMonth,
    volumeByTier,
    volumeByRequirementType,
    approvalRateByRole,
    scoreDistribution,
    preApprovalUsage,
    shortDeadlineVolumeByMonth,
  };
}

export async function getExportableBriefRows(db: PostgresJsDatabase<typeof schema>) {
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
      d.computed_score AS "computedScore",
      d.commercial_decision AS "commercialDecision",
      d.final_status AS "finalStatus",
      d.approval_code AS "approvalCode"
    FROM briefs b
    JOIN decisions d ON d.brief_id = b.id
    JOIN users u ON u.id = b.submitted_by
    ORDER BY b.submitted_at DESC
  `);
}
