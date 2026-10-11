CREATE TABLE "competitor_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"competitor_id" text NOT NULL,
	"kind" text NOT NULL,
	"url" text,
	"title" text,
	"text" text,
	"error" text,
	"storage_key" text,
	"filename" text,
	"width" integer,
	"height" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitor_items_kind_ck" CHECK ("competitor_items"."kind" in ('web_page','upload'))
);
--> statement-breakpoint
CREATE TABLE "competitor_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"summary" text NOT NULL,
	"profiles" jsonb NOT NULL,
	"learnings" jsonb NOT NULL,
	"gaps" jsonb NOT NULL,
	"draft_id" text,
	"model" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cgp_drafts" DROP CONSTRAINT "cgp_drafts_source_ck";--> statement-breakpoint
ALTER TABLE "competitor_runs" DROP CONSTRAINT "competitor_runs_kind_ck";--> statement-breakpoint
ALTER TABLE "competitor_runs" ADD COLUMN "report_id" text;--> statement-breakpoint
ALTER TABLE "competitor_items" ADD CONSTRAINT "competitor_items_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_items" ADD CONSTRAINT "competitor_items_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_items" ADD CONSTRAINT "competitor_items_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_reports" ADD CONSTRAINT "competitor_reports_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_reports" ADD CONSTRAINT "competitor_reports_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_reports" ADD CONSTRAINT "competitor_reports_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitor_items_competitor_idx" ON "competitor_items" USING btree ("org_id","competitor_id");--> statement-breakpoint
CREATE INDEX "competitor_reports_brand_idx" ON "competitor_reports" USING btree ("org_id","brand_id","created_at");--> statement-breakpoint
ALTER TABLE "cgp_drafts" ADD CONSTRAINT "cgp_drafts_source_ck" CHECK ("cgp_drafts"."source" in ('claude','competitors'));--> statement-breakpoint
ALTER TABLE "competitor_runs" ADD CONSTRAINT "competitor_runs_kind_ck" CHECK ("competitor_runs"."kind" in ('find','analyze'));