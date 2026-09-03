CREATE TYPE "public"."commercial_decision" AS ENUM('auto_approved', 'pending', 'declined');--> statement-breakpoint
CREATE TYPE "public"."final_status" AS ENUM('pending', 'approved', 'declined');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('email');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."requirement_state" AS ENUM('pending', 'approved', 'rejected', 'pre_approved', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."requirement_type" AS ENUM('short_deadline', 'creative_creation', 'creative_starting_point', 'marketing_resource', 'ppd_resource', 'gcms_resource', 'tier_auto_approval', 'strategic_priority_deferral');--> statement-breakpoint
CREATE TYPE "public"."role_category" AS ENUM('access', 'approval_authority');--> statement-breakpoint
CREATE TYPE "public"."rule_set_status" AS ENUM('draft', 'published', 'superseded');--> statement-breakpoint
CREATE TABLE "approval_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"requirement_type" "requirement_type" NOT NULL,
	"required_role_key" text NOT NULL,
	"assigned_holder_id" uuid,
	"state" "requirement_state" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"comment" text,
	"pre_approval_nominated_manager_id" uuid,
	"pre_approval_submitter_comment" text,
	"revoke_token_hash" text,
	"revoke_window_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_requirements_rejection_comment_ck" CHECK ("approval_requirements"."state" <> 'rejected' OR ("approval_requirements"."comment" IS NOT NULL AND length(btrim("approval_requirements"."comment")) > 0)),
	CONSTRAINT "approval_requirements_pre_approval_fields_ck" CHECK ("approval_requirements"."state" <> 'pre_approved' OR (
        "approval_requirements"."pre_approval_nominated_manager_id" IS NOT NULL
        AND "approval_requirements"."pre_approval_submitter_comment" IS NOT NULL
        AND length(btrim("approval_requirements"."pre_approval_submitter_comment")) > 0
      ))
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_correlation_id" uuid NOT NULL,
	"ip" "inet"
);
--> statement-breakpoint
CREATE TABLE "briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_reference" text NOT NULL,
	"tier" text NOT NULL,
	"value_potential_gbp" numeric(14, 2) NOT NULL,
	"new_rework" text NOT NULL,
	"brief_type" text NOT NULL,
	"customer_approval" text NOT NULL,
	"niche_ff_pre_approved" boolean DEFAULT false NOT NULL,
	"niche_ff_rationale" text,
	"strategic_priority" boolean DEFAULT false NOT NULL,
	"strategic_priority_rationale" text,
	"creative_approach" text NOT NULL,
	"marketing_flag" boolean DEFAULT false NOT NULL,
	"ppd_flag" boolean DEFAULT false NOT NULL,
	"gcms_flag" boolean DEFAULT false NOT NULL,
	"deadline" date NOT NULL,
	"pv_reference" text,
	"submitted_by" uuid NOT NULL,
	"on_behalf_of" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "briefs_niche_ff_rationale_ck" CHECK ("briefs"."niche_ff_pre_approved" = false OR ("briefs"."niche_ff_rationale" IS NOT NULL AND length(btrim("briefs"."niche_ff_rationale")) > 0)),
	CONSTRAINT "briefs_strategic_priority_rationale_ck" CHECK ("briefs"."strategic_priority" = false OR ("briefs"."strategic_priority_rationale" IS NOT NULL AND length(btrim("briefs"."strategic_priority_rationale")) > 0)),
	CONSTRAINT "briefs_deadline_future_ck" CHECK ("briefs"."deadline" > CURRENT_DATE)
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"computed_score" numeric(14, 4) NOT NULL,
	"score_breakdown" jsonb NOT NULL,
	"commercial_decision" "commercial_decision" NOT NULL,
	"final_status" "final_status" DEFAULT 'pending' NOT NULL,
	"approval_code" text,
	"code_issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_code_only_when_approved_ck" CHECK ("decisions"."approval_code" IS NULL OR "decisions"."final_status" = 'approved')
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"channel" "notification_channel" DEFAULT 'email' NOT NULL,
	"template" text NOT NULL,
	"payload" jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"delivery_status" "notification_delivery_status" DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_holders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_holders_effective_range_ck" CHECK ("role_holders"."effective_to" IS NULL OR "role_holders"."effective_to" >= "role_holders"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"key" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" "role_category" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"status" "rule_set_status" DEFAULT 'draft' NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entra_object_id" text NOT NULL,
	"upn" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_requirements" ADD CONSTRAINT "approval_requirements_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requirements" ADD CONSTRAINT "approval_requirements_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requirements" ADD CONSTRAINT "approval_requirements_required_role_key_roles_key_fk" FOREIGN KEY ("required_role_key") REFERENCES "public"."roles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requirements" ADD CONSTRAINT "approval_requirements_assigned_holder_id_users_id_fk" FOREIGN KEY ("assigned_holder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requirements" ADD CONSTRAINT "approval_requirements_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requirements" ADD CONSTRAINT "approval_requirements_pre_approval_nominated_manager_id_users_id_fk" FOREIGN KEY ("pre_approval_nominated_manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_on_behalf_of_users_id_fk" FOREIGN KEY ("on_behalf_of") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_rule_set_id_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_holders" ADD CONSTRAINT "role_holders_role_key_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."roles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_holders" ADD CONSTRAINT "role_holders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_sets" ADD CONSTRAINT "rule_sets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_sets" ADD CONSTRAINT "rule_sets_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_requirements_decision_id_idx" ON "approval_requirements" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "approval_requirements_state_idx" ON "approval_requirements" USING btree ("state");--> statement-breakpoint
CREATE INDEX "approval_requirements_required_role_key_idx" ON "approval_requirements" USING btree ("required_role_key");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requirements_revoke_token_hash_key" ON "approval_requirements" USING btree ("revoke_token_hash");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_events_actor_id_idx" ON "audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "briefs_submitted_by_idx" ON "briefs" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX "briefs_tier_idx" ON "briefs" USING btree ("tier");--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_brief_id_key" ON "decisions" USING btree ("brief_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_approval_code_key" ON "decisions" USING btree ("approval_code");--> statement-breakpoint
CREATE INDEX "decisions_rule_set_id_idx" ON "decisions" USING btree ("rule_set_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_id_idx" ON "notifications" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "notifications_delivery_status_idx" ON "notifications" USING btree ("delivery_status");--> statement-breakpoint
CREATE INDEX "role_holders_role_key_idx" ON "role_holders" USING btree ("role_key");--> statement-breakpoint
CREATE INDEX "role_holders_user_id_idx" ON "role_holders" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_sets_version_key" ON "rule_sets" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "users_entra_object_id_key" ON "users" USING btree ("entra_object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_upn_key" ON "users" USING btree ("upn");