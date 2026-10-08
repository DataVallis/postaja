CREATE TABLE "org_billing" (
	"org_id" text PRIMARY KEY NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" text DEFAULT 'none' NOT NULL,
	"plan" text,
	"interval" text,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"past_due_since" timestamp with time zone,
	"pilot_ends_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_billing_status_ck" CHECK ("org_billing"."status" in ('none','active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused'))
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"org_id" text,
	"outcome" text DEFAULT '' NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_settings" DROP CONSTRAINT "org_settings_plan_ck";--> statement-breakpoint
ALTER TABLE "org_billing" ADD CONSTRAINT "org_billing_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_billing_customer_uq" ON "org_billing" USING btree ("stripe_customer_id");--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_plan_ck" CHECK ("org_settings"."plan" in ('trial','starter','pro','comped','solo','studio','agency','partner','pilot'));