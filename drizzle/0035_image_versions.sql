CREATE TABLE "post_image_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"post_id" text NOT NULL,
	"visual" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "post_media_post_kind_pos_uq";--> statement-breakpoint
ALTER TABLE "post_media" ADD COLUMN "run_id" text;--> statement-breakpoint
ALTER TABLE "post_media" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "post_image_runs" ADD CONSTRAINT "post_image_runs_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_image_runs" ADD CONSTRAINT "post_image_runs_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_image_runs" ADD CONSTRAINT "post_image_runs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_image_runs_post_idx" ON "post_image_runs" USING btree ("org_id","post_id","created_at");--> statement-breakpoint
CREATE INDEX "post_media_run_idx" ON "post_media" USING btree ("post_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_media_post_kind_pos_uq" ON "post_media" USING btree ("post_id","kind","position") WHERE "post_media"."archived_at" is null;--> statement-breakpoint
-- Existing images become each post's first version (with the post's current words).
INSERT INTO "post_image_runs" ("id","org_id","post_id","visual","created_at")
SELECT gen_random_uuid()::text, p."org_id", p."id", p."visual", COALESCE((SELECT min(m."created_at") FROM "post_media" m WHERE m."post_id" = p."id"), now())
FROM "posts" p WHERE EXISTS (SELECT 1 FROM "post_media" m WHERE m."post_id" = p."id");
--> statement-breakpoint
UPDATE "post_media" m SET "run_id" = r."id" FROM "post_image_runs" r WHERE r."post_id" = m."post_id" AND m."run_id" IS NULL;
