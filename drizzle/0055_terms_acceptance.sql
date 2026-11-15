ALTER TABLE "org_settings" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "terms_accepted_by" text;--> statement-breakpoint
ALTER TABLE "signup_requests" ADD COLUMN "terms_version" text;