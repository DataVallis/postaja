CREATE TABLE "signup_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"org_name" text NOT NULL,
	"ip_hash" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "first_download_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "org_billing" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "org_billing" ADD COLUMN "trial_notice_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "signup_requests_email_idx" ON "signup_requests" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "signup_requests_ip_idx" ON "signup_requests" USING btree ("ip_hash","created_at");