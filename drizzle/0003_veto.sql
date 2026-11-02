ALTER TABLE "decisions" ADD COLUMN "vetoed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "vetoed_by" uuid;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "veto_reason" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "vetoed_requirement_id" uuid;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_vetoed_by_users_id_fk" FOREIGN KEY ("vetoed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;