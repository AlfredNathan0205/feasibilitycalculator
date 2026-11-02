import { and, desc, eq, exists, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import type { AuthSession } from "../auth/authz.js";

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Which briefs a signed-in user may see. Pure and exported so the rule is
 * testable without a database:
 *  - Admin and Auditor see every brief (Auditor's whole job is lookup).
 *  - Everyone else sees briefs they submitted or that were submitted on
 *    their behalf, plus — for approvers — briefs holding a requirement
 *    routed to an approval-authority role they currently hold.
 *  - Anyone with none of those gets nothing.
 */
export type BriefScope =
  { kind: "all" } | { kind: "restricted"; userId: string; approvalRoles: string[] };

export function briefScopeFor(session: AuthSession): BriefScope {
  if (session.accessRoles.includes("admin") || session.accessRoles.includes("auditor")) {
    return { kind: "all" };
  }
  return {
    kind: "restricted",
    userId: session.userId,
    approvalRoles: session.accessRoles.includes("approver")
      ? session.approvalAuthorityRoles
      : [],
  };
}

function scopeCondition(scope: BriefScope): SQL | undefined {
  if (scope.kind === "all") return undefined;
  const own = or(
    eq(schema.briefs.submittedBy, scope.userId),
    eq(schema.briefs.onBehalfOf, scope.userId),
  )!;
  if (scope.approvalRoles.length === 0) return own;
  return or(
    own,
    exists(
      sql`(select 1 from ${schema.approvalRequirements} r
           where r.brief_id = ${schema.briefs.id}
           and r.required_role_key in (${sql.join(
             scope.approvalRoles.map((r) => sql`${r}`),
             sql`, `,
           )}))`,
    ),
  )!;
}

export interface BriefListFilters {
  /** Free text, matched against customer reference and PV reference. */
  q?: string;
  status?: "pending" | "approved" | "declined";
  tier?: string;
  page?: number;
  pageSize?: number;
}

export interface BriefListRow {
  id: string;
  customerReference: string;
  tier: string;
  valuePotentialGbp: string;
  deadline: string;
  submittedAt: Date;
  submitterName: string | null;
  computedScore: string;
  commercialDecision: "auto_approved" | "pending" | "declined";
  finalStatus: "pending" | "approved" | "declined";
  approvalCode: string | null;
  outstandingRequirements: number;
}

export interface BriefListResult {
  rows: BriefListRow[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** Escape LIKE wildcards so a search for "100%" matches literally. */
function likeTerm(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listBriefs(
  db: Db,
  scope: BriefScope,
  filters: BriefListFilters = {},
): Promise<BriefListResult> {
  const pageSize = Math.min(
    Math.max(filters.pageSize ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );
  const page = Math.max(filters.page ?? 1, 1);

  const conditions: (SQL | undefined)[] = [scopeCondition(scope)];
  const q = filters.q?.trim();
  if (q) {
    const term = likeTerm(q);
    conditions.push(
      or(
        ilike(schema.briefs.customerReference, term),
        ilike(schema.briefs.pvReference, term),
      ),
    );
  }
  if (filters.status) conditions.push(eq(schema.decisions.finalStatus, filters.status));
  if (filters.tier) conditions.push(eq(schema.briefs.tier, filters.tier));
  const where = and(...conditions);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.briefs)
    .innerJoin(schema.decisions, eq(schema.decisions.briefId, schema.briefs.id))
    .where(where);

  const rows = await db
    .select({
      id: schema.briefs.id,
      customerReference: schema.briefs.customerReference,
      tier: schema.briefs.tier,
      valuePotentialGbp: schema.briefs.valuePotentialGbp,
      deadline: schema.briefs.deadline,
      submittedAt: schema.briefs.submittedAt,
      submitterName: schema.users.displayName,
      computedScore: schema.decisions.computedScore,
      commercialDecision: schema.decisions.commercialDecision,
      finalStatus: schema.decisions.finalStatus,
      approvalCode: schema.decisions.approvalCode,
      outstandingRequirements: sql<number>`(
        select count(*)::int from ${schema.approvalRequirements} r
        where r.brief_id = ${schema.briefs.id}
        and r.state in ('pending', 'revoked'))`,
    })
    .from(schema.briefs)
    .innerJoin(schema.decisions, eq(schema.decisions.briefId, schema.briefs.id))
    .innerJoin(schema.users, eq(schema.users.id, schema.briefs.submittedBy))
    .where(where)
    .orderBy(desc(schema.briefs.submittedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { rows, total: countRow?.total ?? 0, page, pageSize };
}

export interface BriefDetail {
  brief: typeof schema.briefs.$inferSelect;
  submitterName: string | null;
  onBehalfOfName: string | null;
  decision: typeof schema.decisions.$inferSelect;
  ruleSetVersion: number | null;
  requirements: {
    id: string;
    requirementType: string;
    requiredRoleKey: string;
    state: string;
    decidedByName: string | null;
    decidedAt: Date | null;
    comment: string | null;
    preApprovalNominatedManagerName: string | null;
    preApprovalSubmitterComment: string | null;
  }[];
  /** Only populated for Admin/Auditor — the audit trail is not shown to
   * ordinary submitters or approvers. */
  auditEvents: {
    id: string;
    action: string;
    entityType: string;
    actorName: string | null;
    occurredAt: Date;
    after: unknown;
  }[];
}

/** Returns null both when the brief doesn't exist and when it exists but the
 * scope can't see it — deliberately indistinguishable, so IDs can't be probed. */
export async function getBriefDetail(
  db: Db,
  scope: BriefScope,
  briefId: string,
): Promise<BriefDetail | null> {
  const visible = await db
    .select({ id: schema.briefs.id })
    .from(schema.briefs)
    .where(and(eq(schema.briefs.id, briefId), scopeCondition(scope)));
  if (visible.length === 0) return null;

  const [brief] = await db
    .select()
    .from(schema.briefs)
    .where(eq(schema.briefs.id, briefId));
  const [decision] = await db
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.briefId, briefId));
  if (!brief || !decision) return null;

  const userIds = [brief.submittedBy, brief.onBehalfOf].filter((x): x is string => !!x);
  const requirementRows = await db
    .select()
    .from(schema.approvalRequirements)
    .where(eq(schema.approvalRequirements.briefId, briefId))
    .orderBy(schema.approvalRequirements.createdAt);
  for (const r of requirementRows) {
    if (r.decidedBy) userIds.push(r.decidedBy);
    if (r.preApprovalNominatedManagerId) userIds.push(r.preApprovalNominatedManagerId);
  }
  const userRows = userIds.length
    ? await db
        .select({ id: schema.users.id, displayName: schema.users.displayName })
        .from(schema.users)
        .where(inArray(schema.users.id, [...new Set(userIds)]))
    : [];
  const nameOf = (id: string | null) =>
    id ? (userRows.find((u) => u.id === id)?.displayName ?? null) : null;

  const [ruleSet] = await db
    .select({ version: schema.ruleSets.version })
    .from(schema.ruleSets)
    .where(eq(schema.ruleSets.id, decision.ruleSetId));

  let auditEvents: BriefDetail["auditEvents"] = [];
  if (scope.kind === "all") {
    const entityIds = [briefId, ...requirementRows.map((r) => r.id)];
    const events = await db
      .select({
        id: schema.auditEvents.id,
        action: schema.auditEvents.action,
        entityType: schema.auditEvents.entityType,
        actorName: schema.users.displayName,
        occurredAt: schema.auditEvents.occurredAt,
        after: schema.auditEvents.after,
      })
      .from(schema.auditEvents)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditEvents.actorId))
      .where(inArray(schema.auditEvents.entityId, entityIds))
      .orderBy(schema.auditEvents.occurredAt);
    auditEvents = events;
  }

  return {
    brief,
    submitterName: nameOf(brief.submittedBy),
    onBehalfOfName: nameOf(brief.onBehalfOf),
    decision,
    ruleSetVersion: ruleSet?.version ?? null,
    requirements: requirementRows.map((r) => ({
      id: r.id,
      requirementType: r.requirementType,
      requiredRoleKey: r.requiredRoleKey,
      state: r.state,
      decidedByName: nameOf(r.decidedBy),
      decidedAt: r.decidedAt,
      comment: r.comment,
      preApprovalNominatedManagerName: nameOf(r.preApprovalNominatedManagerId),
      preApprovalSubmitterComment: r.preApprovalSubmitterComment,
    })),
    auditEvents,
  };
}
