CREATE TYPE "public"."niche_assessment_status" AS ENUM('draft', 'submitted', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."niche_band" AS ENUM('strategic_partner', 'growth_partner', 'development_opportunity', 'charge_or_decline');--> statement-breakpoint
CREATE TYPE "public"."niche_framework_status" AS ENUM('draft', 'published', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."niche_route" AS ENUM('standard', 'charging_model', 'junior_perfumer_development', 'perfumer_passion_project', 'decline');--> statement-breakpoint
ALTER TYPE "public"."requirement_type" ADD VALUE 'niche_growth_partner';--> statement-breakpoint
ALTER TYPE "public"."requirement_type" ADD VALUE 'niche_development_route';--> statement-breakpoint
ALTER TYPE "public"."requirement_type" ADD VALUE 'niche_charging_model';--> statement-breakpoint
CREATE TABLE "niche_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"brand_id" uuid NOT NULL,
	"framework_id" uuid NOT NULL,
	"status" "niche_assessment_status" DEFAULT 'draft' NOT NULL,
	"assessor_id" uuid NOT NULL,
	"assessment_date" date NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" integer,
	"section_scores" jsonb,
	"band" "niche_band",
	"reviewer_comment" text,
	"submitted_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_comment" text,
	"escalated_at" timestamp with time zone,
	"escalation_reason" text,
	"valid_until" date,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "niche_assessments_submitted_fields_ck" CHECK ("niche_assessments"."status" NOT IN ('submitted','approved','rejected') OR ("niche_assessments"."score" IS NOT NULL AND "niche_assessments"."band" IS NOT NULL AND "niche_assessments"."section_scores" IS NOT NULL AND "niche_assessments"."submitted_at" IS NOT NULL)),
	CONSTRAINT "niche_assessments_approved_fields_ck" CHECK ("niche_assessments"."status" <> 'approved' OR ("niche_assessments"."reviewed_by" IS NOT NULL AND "niche_assessments"."reviewed_at" IS NOT NULL AND "niche_assessments"."valid_until" IS NOT NULL)),
	CONSTRAINT "niche_assessments_rejection_comment_ck" CHECK ("niche_assessments"."status" <> 'rejected' OR ("niche_assessments"."review_comment" IS NOT NULL AND length(btrim("niche_assessments"."review_comment")) > 0)),
	CONSTRAINT "niche_assessments_reviewer_not_assessor_ck" CHECK ("niche_assessments"."reviewed_by" IS NULL OR "niche_assessments"."reviewed_by" <> "niche_assessments"."assessor_id" OR "niche_assessments"."escalated_at" IS NOT NULL),
	CONSTRAINT "niche_assessments_date_not_future_ck" CHECK ("niche_assessments"."assessment_date" <= CURRENT_DATE)
);
--> statement-breakpoint
CREATE TABLE "niche_brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalised_name" text NOT NULL,
	"customer_reference" text,
	"website" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"merged_into_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "niche_frameworks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"status" "niche_framework_status" DEFAULT 'draft' NOT NULL,
	"payload" jsonb NOT NULL,
	"source_note" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "briefs" ADD COLUMN "niche_brand_id" uuid;--> statement-breakpoint
ALTER TABLE "briefs" ADD COLUMN "niche_assessment_id" uuid;--> statement-breakpoint
ALTER TABLE "briefs" ADD COLUMN "niche_route" "niche_route";--> statement-breakpoint
ALTER TABLE "briefs" ADD COLUMN "niche_route_rationale" text;--> statement-breakpoint
ALTER TABLE "briefs" ADD COLUMN "fine_fragrance_manual_flag" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "niche_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "niche_assessments" ADD CONSTRAINT "niche_assessments_brand_id_niche_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."niche_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "niche_assessments" ADD CONSTRAINT "niche_assessments_framework_id_niche_frameworks_id_fk" FOREIGN KEY ("framework_id") REFERENCES "public"."niche_frameworks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "niche_assessments" ADD CONSTRAINT "niche_assessments_assessor_id_users_id_fk" FOREIGN KEY ("assessor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "niche_assessments" ADD CONSTRAINT "niche_assessments_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "niche_assessments" ADD CONSTRAINT "niche_assessments_supersedes_id_niche_assessments_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."niche_assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "niche_brands" ADD CONSTRAINT "niche_brands_merged_into_id_niche_brands_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."niche_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "niche_brands" ADD CONSTRAINT "niche_brands_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "niche_frameworks" ADD CONSTRAINT "niche_frameworks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "niche_frameworks" ADD CONSTRAINT "niche_frameworks_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "niche_assessments_reference_key" ON "niche_assessments" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "niche_assessments_brand_id_idx" ON "niche_assessments" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "niche_assessments_status_idx" ON "niche_assessments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "niche_brands_normalised_name_key" ON "niche_brands" USING btree ("normalised_name");--> statement-breakpoint
CREATE UNIQUE INDEX "niche_frameworks_version_key" ON "niche_frameworks" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "niche_frameworks_one_published_idx" ON "niche_frameworks" USING btree ("status") WHERE "niche_frameworks"."status" = 'published';--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_niche_brand_id_niche_brands_id_fk" FOREIGN KEY ("niche_brand_id") REFERENCES "public"."niche_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_niche_assessment_id_niche_assessments_id_fk" FOREIGN KEY ("niche_assessment_id") REFERENCES "public"."niche_assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_niche_assessment_brand_ck" CHECK ("briefs"."niche_assessment_id" IS NULL OR "briefs"."niche_brand_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_niche_route_rationale_ck" CHECK ("briefs"."niche_route" IS NULL OR "briefs"."niche_route" = 'standard' OR ("briefs"."niche_route_rationale" IS NOT NULL AND length(btrim("briefs"."niche_route_rationale")) > 0));
--> statement-breakpoint
-- Answers, score, section scores and band are frozen once an assessment leaves
-- draft (build spec §4.5), consistent with the immutability approach in 0001.
CREATE OR REPLACE FUNCTION niche_assessments_freeze_result()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
       NEW.answers IS DISTINCT FROM OLD.answers
    OR NEW.score IS DISTINCT FROM OLD.score
    OR NEW.section_scores IS DISTINCT FROM OLD.section_scores
    OR NEW.band IS DISTINCT FROM OLD.band
    OR NEW.framework_id IS DISTINCT FROM OLD.framework_id
  ) THEN
    RAISE EXCEPTION
      'niche_assessments result is frozen once submitted (assessment %, status %)',
      OLD.id, OLD.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER niche_assessments_freeze_result_trg
  BEFORE UPDATE ON niche_assessments
  FOR EACH ROW
  EXECUTE FUNCTION niche_assessments_freeze_result();
--> statement-breakpoint

-- A published framework's payload is immutable: editing produces a new draft.
CREATE OR REPLACE FUNCTION niche_frameworks_freeze_payload()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status <> 'draft' AND NEW.payload IS DISTINCT FROM OLD.payload THEN
    RAISE EXCEPTION
      'niche_frameworks payload is immutable once published (framework %, version %)',
      OLD.id, OLD.version;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER niche_frameworks_freeze_payload_trg
  BEFORE UPDATE ON niche_frameworks
  FOR EACH ROW
  EXECUTE FUNCTION niche_frameworks_freeze_payload();
