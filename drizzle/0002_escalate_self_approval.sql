ALTER TABLE "approval_requirements" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval_requirements" ADD COLUMN "escalation_reason" text;