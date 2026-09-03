/**
 * Static role definitions. Per Build Prompt §2, the five access roles are
 * defined as Entra app roles and mirrored here; the approval-authority roles
 * are the "known role mapping so far" table, also from §2. Commercial
 * Director and Development Director are included as roles (people can be
 * assigned to them today) even though exactly what each authorises is still
 * pending Pauline Holmes's guidance (§12 item 1) — that's a routing-table
 * question, not a "does this role exist" question.
 */
export const rolesSeed = [
  // --- Access roles (Entra app roles, mirrored on sign-in) ---
  {
    key: "account_manager",
    displayName: "Account Manager",
    category: "access" as const,
    description:
      "Create and submit briefs, view own briefs, see outcomes and Approval Codes.",
  },
  {
    key: "sales_coordinator",
    displayName: "Sales Coordinator",
    category: "access" as const,
    description:
      "Everything an Account Manager can do, plus submit on behalf of a named Account Manager.",
  },
  {
    key: "approver",
    displayName: "Approver",
    category: "access" as const,
    description:
      "Approve or reject requirements assigned to their role(s), add comments.",
  },
  {
    key: "auditor",
    displayName: "Auditor",
    category: "access" as const,
    description:
      "Read-only access to all briefs, decisions, audit trail, and reports. No mutation.",
  },
  {
    key: "admin",
    displayName: "Admin",
    category: "access" as const,
    description:
      "Manage rule sets and thresholds, manage the role-to-person mapping. Deliberately narrow — a small named group, not everyone with access (§12 item 4, still to be confirmed).",
  },

  // --- Approval-authority roles (used by the routing table) ---
  {
    key: "divisional_head_marketing",
    displayName: "Divisional Head of Marketing",
    category: "approval_authority" as const,
    description: "Approves marketing resource requirements.",
  },
  {
    key: "ppd_manager",
    displayName: "PPD Manager",
    category: "approval_authority" as const,
    description: "Approves PPD resource requirements.",
  },
  {
    key: "analytical_manager",
    displayName: "Analytical Manager",
    category: "approval_authority" as const,
    description: "Approves GCMS / GC analytical resource requirements.",
  },
  {
    key: "development_director",
    displayName: "Development Director",
    category: "approval_authority" as const,
    description:
      "Provisionally assigned to creative approach and short deadline requirements, pending Pauline Holmes's routing guidance (§12 item 1).",
  },
  {
    key: "commercial_director",
    displayName: "Commercial Director",
    category: "approval_authority" as const,
    description:
      "Provisionally assigned to commercial deferrals; also the target of the two disabled routing rules (tier-raises-approval, strategic-priority-defers) (§11 items 2, 3).",
  },
];
