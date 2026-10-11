CREATE TABLE "bulk_items" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"org_id" text NOT NULL,
	"post_id" text NOT NULL,
	"step" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bulk_items_status_ck" CHECK ("bulk_items"."status" in ('queued','running','done','skipped','failed')),
	CONSTRAINT "bulk_items_step_ck" CHECK ("bulk_items"."step" in ('text'))
);
--> statement-breakpoint
CREATE TABLE "bulk_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text,
	"scope" jsonb NOT NULL,
	"steps" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"total" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "bulk_runs_status_ck" CHECK ("bulk_runs"."status" in ('queued','running','done','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "bulk_items" ADD CONSTRAINT "bulk_items_run_id_bulk_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."bulk_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_items" ADD CONSTRAINT "bulk_items_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_items" ADD CONSTRAINT "bulk_items_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_runs" ADD CONSTRAINT "bulk_runs_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_runs" ADD CONSTRAINT "bulk_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_runs" ADD CONSTRAINT "bulk_runs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_items_run_idx" ON "bulk_items" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "bulk_items_org_idx" ON "bulk_items" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bulk_items_run_post_step_uq" ON "bulk_items" USING btree ("run_id","post_id","step");--> statement-breakpoint
CREATE INDEX "bulk_runs_org_idx" ON "bulk_runs" USING btree ("org_id","created_at");