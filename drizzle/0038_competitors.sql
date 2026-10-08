CREATE TABLE "competitor_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"hint" text DEFAULT '' NOT NULL,
	"error" text,
	"added" integer DEFAULT 0 NOT NULL,
	"model" text,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitor_runs_kind_ck" CHECK ("competitor_runs"."kind" in ('find')),
	CONSTRAINT "competitor_runs_status_ck" CHECK ("competitor_runs"."status" in ('queued','running','done','failed'))
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"handles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitors_source_ck" CHECK ("competitors"."source" in ('ai','manual')),
	CONSTRAINT "competitors_status_ck" CHECK ("competitors"."status" in ('suggested','kept'))
);
--> statement-breakpoint
ALTER TABLE "competitor_runs" ADD CONSTRAINT "competitor_runs_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_runs" ADD CONSTRAINT "competitor_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_runs" ADD CONSTRAINT "competitor_runs_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitor_runs_brand_idx" ON "competitor_runs" USING btree ("org_id","brand_id","created_at");--> statement-breakpoint
CREATE INDEX "competitors_brand_idx" ON "competitors" USING btree ("org_id","brand_id");