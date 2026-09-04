import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema.js";
import {
  getVolumeOutcomeMixByMonth,
  getVolumeByTier,
  getVolumeByRequirementType,
  getApprovalRateByRole,
  getScoreDistribution,
  getPreApprovalUsageBySubmitter,
  getShortDeadlineVolumeByMonth,
  getDashboardSummary,
  getExportableBriefRows,
} from "./reporting.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("reporting (integration, against real accumulated data)", () => {
  let sql_: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    sql_ = postgres(databaseUrl!);
    db = drizzle(sql_, { schema });
  });

  afterAll(async () => {
    await sql_.end();
  });

  it("getVolumeOutcomeMixByMonth: totals sum to the actual number of decisions", async () => {
    const rows = await getVolumeOutcomeMixByMonth(db);
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const actualTotalRows = (await db.execute(
      sql`SELECT count(*)::int AS count FROM decisions`,
    )) as unknown as { count: number }[];
    const actualTotal = actualTotalRows[0]!.count;
    expect(total).toBe(actualTotal);
    // Every row's finalStatus must be one of the three real enum values.
    for (const r of rows) {
      expect(["pending", "approved", "declined"]).toContain(r.finalStatus);
    }
  });

  it("getVolumeByTier: totals sum to the actual number of briefs, only real tier values", async () => {
    const rows = await getVolumeByTier(db);
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const actualTotalRows = (await db.execute(
      sql`SELECT count(*)::int AS count FROM briefs`,
    )) as unknown as { count: number }[];
    const actualTotal = actualTotalRows[0]!.count;
    expect(total).toBe(actualTotal);
    for (const r of rows) {
      expect(["A/T", "B", "C", "D"]).toContain(r.dimension);
    }
  });

  it("getVolumeByRequirementType: totals sum to the actual number of requirements raised", async () => {
    const rows = await getVolumeByRequirementType(db);
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const actualTotalRows = (await db.execute(
      sql`SELECT count(*)::int AS count FROM approval_requirements`,
    )) as unknown as { count: number }[];
    const actualTotal = actualTotalRows[0]!.count;
    expect(total).toBe(actualTotal);
  });

  it("getApprovalRateByRole: approval rate is consistent with approved/(approved+rejected), and only counts decided rows", async () => {
    const rows = await getApprovalRateByRole(db);
    for (const r of rows) {
      const decided = r.approvedCount + r.rejectedCount;
      if (decided === 0) {
        expect(r.approvalRate).toBeNull();
        expect(r.medianHoursToDecision).toBeNull();
      } else {
        expect(r.approvalRate).toBeCloseTo(r.approvedCount / decided, 2);
      }
    }
  });

  it("getScoreDistribution: bucket counts sum to the actual number of decisions", async () => {
    const buckets = await getScoreDistribution(db);
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    const actualTotalRows = (await db.execute(
      sql`SELECT count(*)::int AS count FROM decisions`,
    )) as unknown as { count: number }[];
    const actualTotal = actualTotalRows[0]!.count;
    expect(total).toBe(actualTotal);
    // Buckets must be in ascending order.
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i]!.bucketMin).toBeGreaterThan(buckets[i - 1]!.bucketMin);
    }
  });

  it("getPreApprovalUsageBySubmitter: revokedCount never exceeds preApprovalCount", async () => {
    const rows = await getPreApprovalUsageBySubmitter(db);
    for (const r of rows) {
      expect(r.revokedCount).toBeLessThanOrEqual(r.preApprovalCount);
      expect(r.preApprovalCount).toBeGreaterThan(0);
    }
    // We know from earlier phases' testing that at least one submitter
    // has used pre-approval and at least one has revoked one.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.revokedCount > 0)).toBe(true);
  });

  it("getShortDeadlineVolumeByMonth: only counts short_deadline requirement rows", async () => {
    const rows = await getShortDeadlineVolumeByMonth(db);
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const actualTotalRows = (await db.execute(
      sql`SELECT count(*)::int AS count FROM approval_requirements WHERE requirement_type = 'short_deadline'`,
    )) as unknown as { count: number }[];
    const actualTotal = actualTotalRows[0]!.count;
    expect(total).toBe(actualTotal);
  });

  it("getDashboardSummary: assembles all panels without error", async () => {
    const summary = await getDashboardSummary(db);
    expect(summary.volumeOutcomeMixByMonth.length).toBeGreaterThan(0);
    expect(summary.volumeByTier.length).toBeGreaterThan(0);
    expect(summary.scoreDistribution.length).toBeGreaterThan(0);
  });

  it("getExportableBriefRows: row count matches the actual number of briefs with decisions", async () => {
    const rows = await getExportableBriefRows(db);
    const actualTotalRows = (await db.execute(
      sql`SELECT count(*)::int AS count FROM briefs b JOIN decisions d ON d.brief_id = b.id`,
    )) as unknown as { count: number }[];
    const actualTotal = actualTotalRows[0]!.count;
    expect(rows.length).toBe(actualTotal);
    const first = rows[0] as Record<string, unknown>;
    expect(first).toHaveProperty("customerReference");
    expect(first).toHaveProperty("approvalCode");
  });
});
