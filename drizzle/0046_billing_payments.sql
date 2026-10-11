CREATE TABLE "billing_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"currency" text NOT NULL,
	"net_cents" integer NOT NULL,
	"tax_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"buyer_name" text DEFAULT '' NOT NULL,
	"buyer_email" text DEFAULT '' NOT NULL,
	"buyer_address" text DEFAULT '' NOT NULL,
	"buyer_country" text DEFAULT '' NOT NULL,
	"buyer_vat_id" text DEFAULT '' NOT NULL,
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"stripe_customer_id" text,
	"invoice_number" text,
	"invoiced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_payments_kind_ck" CHECK ("billing_payments"."kind" in ('plan','pilot','pack'))
);
--> statement-breakpoint
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_payments_paid_idx" ON "billing_payments" USING btree ("paid_at");