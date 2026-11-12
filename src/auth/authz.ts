/**
 * Authorization layer — Build Prompt §2 "Roles and permissions".
 *
 * "All server-side data access must go through a single authorisation layer.
 * Never trust a role claim read on the client."
 *
 * Everything here is PURE: it takes an already-resolved `AuthSession` (roles
 * resolved server-side from role_holders — see resolve-session-roles.ts —
 * never from a client-supplied claim) and plain data, and returns a
 * decision. No I/O, no DB, no framework dependency, so every role boundary
 * in §2 can be unit tested directly without a running server, a database,
 * or a real Entra tenant.
 */

export interface AuthSession {
  userId: string;
  /** Access-role keys currently held (account_manager, sales_coordinator,
   * approver, auditor, admin) — resolved server-side, e.g. in the NextAuth
   * jwt callback via resolveSessionRoles(). */
  accessRoles: string[];
  /** Approval-authority role keys currently held (e.g. ppd_manager,
   * analytical_manager) — also resolved server-side via role_holders. Empty
   * for someone who isn't an approver for anything. */
  approvalAuthorityRoles: string[];
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function hasAccessRole(session: AuthSession, roleKey: string): boolean {
  return session.accessRoles.includes(roleKey);
}

export function requireAccessRole(session: AuthSession, roleKey: string): void {
  if (!hasAccessRole(session, roleKey)) {
    throw new AuthorizationError(
      `User ${session.userId} does not hold required access role "${roleKey}"`,
    );
  }
}

/**
 * §2: "Editing thresholds requires Admin. This is a deliberately narrow
 * permission." A thin, explicitly-named wrapper rather than callers
 * remembering the string "admin" — the narrowness is meant to be visible
 * at the call site.
 */
export function requireAdmin(session: AuthSession): void {
  requireAccessRole(session, "admin");
}

/**
 * §2: "An approver may never approve a requirement that is not assigned to
 * their role." Requires BOTH the general "approver" access role AND the
 * specific approval-authority role the requirement names — holding one
 * without the other is not sufficient (e.g. someone who is a PPD Manager
 * but hasn't been granted the Approver access role at all shouldn't be able
 * to act, and someone with the Approver access role but not this specific
 * authority role can't act on requirements outside their remit).
 */
export function canActOnRequirement(
  session: AuthSession,
  requirement: { requiredRoleKey: string },
): boolean {
  return (
    hasAccessRole(session, "approver") &&
    session.approvalAuthorityRoles.includes(requirement.requiredRoleKey)
  );
}

export function requireCanActOnRequirement(
  session: AuthSession,
  requirement: { requiredRoleKey: string },
): void {
  if (!canActOnRequirement(session, requirement)) {
    throw new AuthorizationError(
      `User ${session.userId} cannot act on a requirement requiring "${requirement.requiredRoleKey}"`,
    );
  }
}

export type SelfApprovalCheck =
  | { conflicted: false }
  | {
      conflicted: true;
      /** Which identity on the brief created the conflict — useful for the
       * audit trail entry the spec requires ("flag it in the audit
       * trail"). */
      reason: "submitter" | "on_behalf_of_account_manager";
    };

/**
 * §2: "An approver may not approve a brief they themselves submitted.
 * Reassign to their line manager role and flag it in the audit trail."
 *
 * Checked against BOTH `submittedBy` (whoever physically submitted it —
 * could be the Account Manager or a Sales Coordinator acting for them) and
 * `onBehalfOf` (the Account Manager of record, per §2's on-behalf-of rule).
 * The spec's own wording only says "submitted", but the evident purpose is
 * conflict-of-interest, not literal keystroke attribution — an Account
 * Manager who had a Sales Coordinator submit on their behalf has exactly
 * the same conflict approving their own brief as if they'd typed it in
 * themselves. This is a considered reading of intent, not a coin-flip on an
 * open question, so it's implemented directly rather than punted to
 * docs/open-questions.md.
 *
 * RESOLVED (CPL, Nov 2026): there is no line-manager relationship in the
 * data model, and CPL's approvers do not normally submit briefs. The agreed
 * handling is to escalate to an Admin and record it in the audit trail, not
 * to reassign to a line manager. This function only DETECTS the conflict;
 * shouldEscalateRequirement and requireCanDecideRequirement implement the
 * escalation.
 */
export function checkSelfApproval(
  session: AuthSession,
  brief: { submittedBy: string; onBehalfOf: string | null },
): SelfApprovalCheck {
  if (brief.submittedBy === session.userId) {
    return { conflicted: true, reason: "submitter" };
  }
  if (brief.onBehalfOf !== null && brief.onBehalfOf === session.userId) {
    return { conflicted: true, reason: "on_behalf_of_account_manager" };
  }
  return { conflicted: false };
}

/**
 * Combines the requirement-authority check and the self-approval check into
 * the single gate a "decide this approval requirement" action should call.
 * Throws with a specific, distinguishable reason in each failure case so
 * callers (and their tests) don't have to re-derive why an attempt was
 * rejected.
 *
 * Escalated requirements (every holder of the required role is the
 * submitter, or the Account Manager the brief was submitted for) are decided
 * by an Admin instead of the role's holders. The Admin is still subject to
 * the self-approval check, so an Admin who submitted the brief can't decide
 * it either. This resolves docs/open-questions.md item 2 as "escalate to
 * Admin and record it in the audit trail".
 */
export function requireCanDecideRequirement(
  session: AuthSession,
  brief: { submittedBy: string; onBehalfOf: string | null },
  requirement: { requiredRoleKey: string; escalated?: boolean },
): void {
  if (requirement.escalated) {
    requireAdmin(session);
  } else {
    requireCanActOnRequirement(session, requirement);
  }
  const selfApproval = checkSelfApproval(session, brief);
  if (selfApproval.conflicted) {
    throw new AuthorizationError(
      `User ${session.userId} cannot decide this requirement: self-approval conflict (${selfApproval.reason}).`,
    );
  }
}

/**
 * True when a requirement should be escalated to Admin at creation time:
 * it has at least one current holder, and every one of them is the person
 * who submitted the brief or the Account Manager it was submitted for.
 * With no holders at all it is NOT escalated (that is a role-mapping gap an
 * Admin should fix, not a conflict), and with any unconflicted holder it is
 * left with that holder.
 */
export function shouldEscalateRequirement(
  holderIds: string[],
  brief: { submittedBy: string; onBehalfOf: string | null },
): boolean {
  if (holderIds.length === 0) return false;
  return holderIds.every((id) => id === brief.submittedBy || id === brief.onBehalfOf);
}

/**
 * General Manager veto (CPL, Nov 2026): the holder of `general_manager` may
 * veto any open requirement on any brief, regardless of which role it is
 * routed to. Like every approval action it also needs the Approver access
 * role. The veto is a power to block, never a step a brief waits on.
 */
export function canVeto(session: AuthSession): boolean {
  return (
    hasAccessRole(session, "approver") &&
    session.approvalAuthorityRoles.includes("general_manager")
  );
}

export function requireCanVeto(session: AuthSession): void {
  if (!canVeto(session)) {
    throw new AuthorizationError(
      `User ${session.userId} does not hold the veto authority`,
    );
  }
}

/**
 * Sales leadership oversight (CPL, Nov 2026): the General Manager and the
 * Commercial Director / Sales Director (an approver holding `commercial_director`)
 * may see every brief and the dashboard, to keep an eye on the teams' work.
 * They do not see the audit trail, and exports stay with Admin and Auditor.
 */
export function hasLeadershipView(session: AuthSession): boolean {
  return (
    canVeto(session) ||
    (hasAccessRole(session, "approver") &&
      session.approvalAuthorityRoles.includes("commercial_director"))
  );
}

/** Who may open the Dashboard: Admin, Auditor and sales leadership. */
export function canViewDashboard(session: AuthSession): boolean {
  return (
    hasAccessRole(session, "admin") ||
    hasAccessRole(session, "auditor") ||
    hasLeadershipView(session)
  );
}

// ---------------------------------------------------------------------------
// Niche Brand Assessment (build spec §8). Pure, like everything above.
// The Auditor can view but never mutate: no mutating function here admits the
// auditor role on its own.
// ---------------------------------------------------------------------------

/** Role that reviews niche assessments when the framework does not say otherwise. */
export const DEFAULT_NICHE_REVIEWER_ROLE = "commercial_director";

/** Holds the Approver access role AND the framework's reviewer authority role. */
export function holdsNicheReviewerRole(
  session: AuthSession,
  reviewerRoleKey: string = DEFAULT_NICHE_REVIEWER_ROLE,
): boolean {
  return (
    hasAccessRole(session, "approver") &&
    session.approvalAuthorityRoles.includes(reviewerRoleKey)
  );
}

/** View brands and assessments: AM, SC, reviewer-role approver, Auditor, Admin. */
export function canViewNiche(session: AuthSession, reviewerRoleKey?: string): boolean {
  return (
    hasAccessRole(session, "account_manager") ||
    hasAccessRole(session, "sales_coordinator") ||
    hasAccessRole(session, "auditor") ||
    hasAccessRole(session, "admin") ||
    holdsNicheReviewerRole(session, reviewerRoleKey)
  );
}

/** Create or edit a brand, and create / edit own draft / submit / withdraw an assessment. */
export function canEditNiche(session: AuthSession): boolean {
  return (
    hasAccessRole(session, "account_manager") ||
    hasAccessRole(session, "sales_coordinator") ||
    hasAccessRole(session, "admin")
  );
}

/** Deactivate or merge brands. */
export function canManageNicheBrands(session: AuthSession): boolean {
  return hasAccessRole(session, "admin");
}

/** Manage framework versions, replay and publish. */
export function canManageNicheFrameworks(session: AuthSession): boolean {
  return hasAccessRole(session, "admin");
}

/**
 * Review (approve or reject) an assessment. Never the assessor. A normal
 * assessment is reviewed by an Approver holding the framework's reviewer role;
 * an escalated one (the assessor is the only reviewer) by an Admin.
 */
export function canReviewNicheAssessment(
  session: AuthSession,
  assessment: { assessorId: string; escalated: boolean },
  reviewerRoleKey?: string,
): boolean {
  if (assessment.assessorId === session.userId) return false;
  return assessment.escalated
    ? hasAccessRole(session, "admin")
    : holdsNicheReviewerRole(session, reviewerRoleKey);
}

export function requireCanReviewNicheAssessment(
  session: AuthSession,
  assessment: { assessorId: string; escalated: boolean },
  reviewerRoleKey?: string,
): void {
  if (!canReviewNicheAssessment(session, assessment, reviewerRoleKey)) {
    throw new AuthorizationError(
      `User ${session.userId} cannot review this niche assessment`,
    );
  }
}
