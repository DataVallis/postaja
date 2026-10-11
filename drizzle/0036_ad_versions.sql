CREATE TABLE "ad_copy_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"ad_set_id" text NOT NULL,
	"copy" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_creative_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"ad_set_id" text NOT NULL,
	"visual" jsonb,
	"kept" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "ad_media_set_kind_variant_placement_uq";--> statement-breakpoint
ALTER TABLE "post_image_runs" ADD COLUMN "kept" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_media" ADD COLUMN "run_id" text;--> statement-breakpoint
ALTER TABLE "ad_media" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_copy_versions" ADD CONSTRAINT "ad_copy_versions_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_copy_versions" ADD CONSTRAINT "ad_copy_versions_ad_set_id_ad_sets_id_fk" FOREIGN KEY ("ad_set_id") REFERENCES "public"."ad_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_copy_versions" ADD CONSTRAINT "ad_copy_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creative_runs" ADD CONSTRAINT "ad_creative_runs_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creative_runs" ADD CONSTRAINT "ad_creative_runs_ad_set_id_ad_sets_id_fk" FOREIGN KEY ("ad_set_id") REFERENCES "public"."ad_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creative_runs" ADD CONSTRAINT "ad_creative_runs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_copy_versions_set_idx" ON "ad_copy_versions" USING btree ("org_id","ad_set_id","created_at");--> statement-breakpoint
CREATE INDEX "ad_creative_runs_set_idx" ON "ad_creative_runs" USING btree ("org_id","ad_set_id","created_at");--> statement-breakpoint
CREATE INDEX "ad_media_run_idx" ON "ad_media" USING btree ("ad_set_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_media_set_kind_variant_placement_uq" ON "ad_media" USING btree ("ad_set_id","kind","variant","placement") WHERE "ad_media"."archived_at" is null;
--> statement-breakpoint
-- Existing creatives become each ad set's first version.
INSERT INTO "ad_creative_runs" ("id","org_id","ad_set_id","visual","created_at")
SELECT gen_random_uuid()::text, a."org_id", a."id", a."visual", COALESCE((SELECT min(m."created_at") FROM "ad_media" m WHERE m."ad_set_id" = a."id"), now())
FROM "ad_sets" a WHERE EXISTS (SELECT 1 FROM "ad_media" m WHERE m."ad_set_id" = a."id");
--> statement-breakpoint
UPDATE "ad_media" m SET "run_id" = r."id" FROM "ad_creative_runs" r WHERE r."ad_set_id" = m."ad_set_id" AND m."run_id" IS NULL;
