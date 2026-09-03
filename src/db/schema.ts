/**
 * CPL Project Feasibility Calculator — database schema (Drizzle ORM / PostgreSQL)
 *
 * Implements Build Prompt §8 "Data model", read together with:
 *  - §2 Roles and permissions (role-to-person mapping is data, not code)
 *  - §3 Scoring model (rule sets are versioned and immutable once published)
 *  - §6 Approval Code (format + normalisation live in the application layer;
 *    the DB only enforces uniqueness)
 *  - §7 Rule versioning and replay (decisions carry a hard FK to the exact
 *    rule set version that produced them; rule sets are never mutated after
 *    publish, only superseded)
 *
 * Two things are enforced here, not just in the app, per the spec's explicit
 * instruction ("Enforce at the database level as well as in the form" / "Enforce
 * with a database trigger, not just application discipline"):
 *   1. Rationale fields are NOT NULL whenever their trigger flag is set
 *      (niche_ff_rationale, strategic_priority_rationale) via CHECK constraints.
 *   2. audit_events is append-only: UPDATE/DELETE are revoked from the
 *      application role and blocked by a trigger, so even a bug in the app
 *      layer cannot rewrite history. See migrations/0001_audit_immutability.sql.
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  jsonb,
  timestamp,
  date,
  inet,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Distinguishes the five Entra-issued access-control roles (§2 "Roles and
 * permissions" table: AccountManager / SalesCoordinator / Approver / Auditor /
 * Admin) from the business "approval authority" roles used purely for routing
 * (Divisional Head of Marketing, PPD Manager, Analytical Manager, Development
 * Director, Commercial Director, plus whatever Pauline's guidance adds later).
 * Both live in the same `roles` table because routing rules, replay, and the
 * approver queue all need to join against role keys uniformly — but they are
 * populated and governed differently: access roles come from the Entra app
 * registration's app roles and are mirrored in on sign-in; approval-authority
 * roles are pure application data maintained by Admin.
 */
export const roleCategoryEnum = pgEnum("role_category", [
  "access",
  "approval_authority",
]);

export const ruleSetStatusEnum = pgEnum("rule_set_status", [
  "draft",
  "published",
  "superseded",
]);

export const commercialDecisionEnum = pgEnum("commercial_decision", [
  "auto_approved",
  "pending",
  "declined",
]);

export const finalStatusEnum = pgEnum("final_status", [
  "pending",
  "approved",
  "declined",
]);

/**
 * §5 Stage B trigger list, plus the two disabled-by-default routing rules
 * documented in §11 items 2 and 3 (tier-raises-approval, strategic-priority
 * defers-to-commercial). Both are represented here so the routing table can
 * reference them without a schema change if Simon later asks to enable them —
 * the spec is explicit that a routing rule can be "available, currently
 * disabled" rather than absent.
 */
export const requirementTypeEnum = pgEnum("requirement_type", [
  "short_deadline",
  "creative_creation",
  "creative_starting_point",
  "marketing_resource",
  "ppd_resource",
  "gcms_resource",
  "tier_auto_approval", // disabled by default — §11 item 2
  "strategic_priority_deferral", // disabled by default — §11 item 3
]);

export const requirementStateEnum = pgEnum("requirement_state", [
  "pending",
  "approved",
  "rejected",
  "pre_approved",
  "revoked",
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "email",
]);

export const notificationDeliveryStatusEnum = pgEnum(
  "notification_delivery_status",
  ["queued", "sent", "failed"],
);

// ---------------------------------------------------------------------------
// users — mirrored from Entra on sign-in (§8)
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entraObjectId: text("entra_object_id").notNull(),
    upn: text("upn").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("users_entra_object_id_key").on(t.entraObjectId),
    uniqueIndex("users_upn_key").on(t.upn),
  ],
);

// ---------------------------------------------------------------------------
// roles — role key, display name, description (§8)
// ---------------------------------------------------------------------------

export const roles = pgTable("roles", {
  key: text("key").primaryKey(),
  displayName: text("display_name").notNull(),
  description: text("description").notNull().default(""),
  category: roleCategoryEnum("category").notNull(),
});

// ---------------------------------------------------------------------------
// role_holders — role, user, effective from, effective to (§8, §2)
// Supports multiple concurrent holders and handovers without losing history:
// no uniqueness constraint on (role, user) or on "current" holder, since
// leavers/cover means more than one person can hold a role at once and the
// full history must remain queryable, not just the latest row.
// ---------------------------------------------------------------------------

export const roleHolders = pgTable(
  "role_holders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roleKey: text("role_key")
      .notNull()
      .references(() => roles.key),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"), // NULL = still current
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("role_holders_role_key_idx").on(t.roleKey),
    index("role_holders_user_id_idx").on(t.userId),
    check(
      "role_holders_effective_range_ck",
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// rule_sets — version, status, full payload, publish metadata (§7, §8)
// Immutable once published: the application layer must never UPDATE a
// published row's `payload`; editing produces a new draft version instead.
// ---------------------------------------------------------------------------

export const ruleSets = pgTable(
  "rule_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: integer("version").notNull(),
    status: ruleSetStatusEnum("status").notNull().default("draft"),
    /**
     * Tier weights, all multipliers, creative-approach scores, thresholds,
     * the deadline window in days, and the routing table — see
     * seed/generate-ruleset-v1.ts for the exact shape, which is generated
     * from the workbook's Reference sheet rather than hand-typed.
     */
    payload: jsonb("payload").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedBy: uuid("published_by").references(() => users.id),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("rule_sets_version_key").on(t.version)],
);

// ---------------------------------------------------------------------------
// briefs — submission identity and inputs (§8)
// Rationale fields are NOT NULL whenever their trigger flag is TRUE — enforced
// here with CHECK constraints per the spec's instruction that a blank must be
// "impossible rather than merely discouraged", not just a form validation.
// ---------------------------------------------------------------------------

export const briefs = pgTable(
  "briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerReference: text("customer_reference").notNull(),
    // Manual dropdown for v1 (§11 item 5) — free text here, constrained by
    // the application against the rule set's tier list. A customer table /
    // tier lookup can replace this later without migrating existing briefs.
    tier: text("tier").notNull(),
    valuePotentialGbp: numeric("value_potential_gbp", {
      precision: 14,
      scale: 2,
    }).notNull(),
    newRework: text("new_rework").notNull(),
    briefType: text("brief_type").notNull(),
    customerApproval: text("customer_approval").notNull(),

    nicheFfPreApproved: boolean("niche_ff_pre_approved").notNull().default(false),
    nicheFfRationale: text("niche_ff_rationale"),

    strategicPriority: boolean("strategic_priority").notNull().default(false),
    strategicPriorityRationale: text("strategic_priority_rationale"),

    creativeApproach: text("creative_approach").notNull(),

    marketingFlag: boolean("marketing_flag").notNull().default(false),
    ppdFlag: boolean("ppd_flag").notNull().default(false),
    gcmsFlag: boolean("gcms_flag").notNull().default(false),

    deadline: date("deadline").notNull(),

    pvReference: text("pv_reference"),

    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => users.id),
    // Set when a SalesCoordinator submits for a named Account Manager (§2).
    // The brief's owner for notification purposes is submittedBy... no —
    // per spec the *owner* for notifications is the Account Manager, and
    // submittedBy always records who physically submitted it. When
    // onBehalfOf is set, onBehalfOf is the Account Manager of record and is
    // who gets notified; submittedBy is retained purely for the audit trail.
    onBehalfOf: uuid("on_behalf_of").references(() => users.id),

    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("briefs_submitted_by_idx").on(t.submittedBy),
    index("briefs_tier_idx").on(t.tier),
    check(
      "briefs_niche_ff_rationale_ck",
      sql`${t.nicheFfPreApproved} = false OR (${t.nicheFfRationale} IS NOT NULL AND length(btrim(${t.nicheFfRationale})) > 0)`,
    ),
    check(
      "briefs_strategic_priority_rationale_ck",
      sql`${t.strategicPriority} = false OR (${t.strategicPriorityRationale} IS NOT NULL AND length(btrim(${t.strategicPriorityRationale})) > 0)`,
    ),
    check("briefs_deadline_future_ck", sql`${t.deadline} > CURRENT_DATE`),
  ],
);

// ---------------------------------------------------------------------------
// decisions — brief, rule set version, computed score, breakdown, outcome (§8)
// Historical decisions are never recalculated: this row plus its
// score_breakdown JSONB fully explains the outcome without touching the
// scoring engine again, even after rule_sets changes.
// ---------------------------------------------------------------------------

export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    briefId: uuid("brief_id")
      .notNull()
      .references(() => briefs.id),
    ruleSetId: uuid("rule_set_id")
      .notNull()
      .references(() => ruleSets.id),
    computedScore: numeric("computed_score", { precision: 14, scale: 4 }).notNull(),
    // Per-component contribution, e.g. { customerTier: 100, valuePotential: 35,
    // newRework: 35, briefType: 35, customerApproval: 17.5, strategicPriority: 0,
    // creativeApproach: 65 } — one entry per §3 component, so any historical
    // score is explainable line by line without recalculation.
    scoreBreakdown: jsonb("score_breakdown").notNull(),
    commercialDecision: commercialDecisionEnum("commercial_decision").notNull(),
    finalStatus: finalStatusEnum("final_status").notNull().default("pending"),
    approvalCode: text("approval_code"),
    codeIssuedAt: timestamp("code_issued_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("decisions_brief_id_key").on(t.briefId), // one live decision per brief
    uniqueIndex("decisions_approval_code_key").on(t.approvalCode),
    index("decisions_rule_set_id_idx").on(t.ruleSetId),
    check(
      "decisions_code_only_when_approved_ck",
      sql`${t.approvalCode} IS NULL OR ${t.finalStatus} = 'approved'`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// approval_requirements (§8, §5, §6 Stage C)
// ---------------------------------------------------------------------------

export const approvalRequirements = pgTable(
  "approval_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    briefId: uuid("brief_id")
      .notNull()
      .references(() => briefs.id),
    decisionId: uuid("decision_id")
      .notNull()
      .references(() => decisions.id),
    requirementType: requirementTypeEnum("requirement_type").notNull(),
    requiredRoleKey: text("required_role_key")
      .notNull()
      .references(() => roles.key),
    // Snapshot of who held requiredRoleKey at decision time — resolved via
    // role_holders' effective range so a later handover cannot silently
    // change who was accountable for a past decision.
    assignedHolderId: uuid("assigned_holder_id").references(() => users.id),
    state: requirementStateEnum("state").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    // Mandatory when state = 'rejected' (§9 Approver queue: "Rejection
    // comments are mandatory").
    comment: text("comment"),

    // --- Stage C: prior approval override fields ---
    preApprovalNominatedManagerId: uuid(
      "pre_approval_nominated_manager_id",
    ).references(() => users.id),
    preApprovalSubmitterComment: text("pre_approval_submitter_comment"),
    revokeTokenHash: text("revoke_token_hash"),
    revokeWindowExpiresAt: timestamp("revoke_window_expires_at", {
      withTimezone: true,
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("approval_requirements_decision_id_idx").on(t.decisionId),
    index("approval_requirements_state_idx").on(t.state),
    index("approval_requirements_required_role_key_idx").on(t.requiredRoleKey),
    uniqueIndex("approval_requirements_revoke_token_hash_key").on(
      t.revokeTokenHash,
    ),
    check(
      "approval_requirements_rejection_comment_ck",
      sql`${t.state} <> 'rejected' OR (${t.comment} IS NOT NULL AND length(btrim(${t.comment})) > 0)`,
    ),
    check(
      "approval_requirements_pre_approval_fields_ck",
      sql`${t.state} <> 'pre_approved' OR (
        ${t.preApprovalNominatedManagerId} IS NOT NULL
        AND ${t.preApprovalSubmitterComment} IS NOT NULL
        AND length(btrim(${t.preApprovalSubmitterComment})) > 0
      )`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// audit_events — append-only (§8). INSERT-only for the application role;
// see migrations/0001_audit_immutability.sql for the REVOKE + trigger that
// makes this a database-enforced guarantee, not just a convention.
// ---------------------------------------------------------------------------

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id), // NULL for system actions
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    requestCorrelationId: uuid("request_correlation_id").notNull(),
    ip: inet("ip"),
  },
  (t) => [
    index("audit_events_entity_idx").on(t.entityType, t.entityId),
    index("audit_events_actor_id_idx").on(t.actorId),
    index("audit_events_occurred_at_idx").on(t.occurredAt),
  ],
);

// ---------------------------------------------------------------------------
// notifications (§8, §6 Stage C revoke notifications)
// ---------------------------------------------------------------------------

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id),
    channel: notificationChannelEnum("channel").notNull().default("email"),
    template: text("template").notNull(),
    payload: jsonb("payload").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveryStatus: notificationDeliveryStatusEnum("delivery_status")
      .notNull()
      .default("queued"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notifications_recipient_id_idx").on(t.recipientId),
    index("notifications_delivery_status_idx").on(t.deliveryStatus),
  ],
);
