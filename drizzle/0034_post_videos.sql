CREATE TABLE "post_videos" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"post_id" text NOT NULL,
	"kind" text NOT NULL,
	"slide_position" integer,
	"storage_key" text NOT NULL,
	"poster_key" text,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" bigint NOT NULL,
	"model" text NOT NULL,
	"spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_videos_kind_ck" CHECK ("post_videos"."kind" in ('animation','persona')),
	CONSTRAINT "post_videos_size_ck" CHECK ("post_videos"."width" > 0 and "post_videos"."height" > 0 and "post_videos"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "post_videos" ADD CONSTRAINT "post_videos_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_videos" ADD CONSTRAINT "post_videos_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_videos" ADD CONSTRAINT "post_videos_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_videos_post_idx" ON "post_videos" USING btree ("org_id","post_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_videos_key_uq" ON "post_videos" USING btree ("storage_key");--> statement-breakpoint
-- Move the existing videos (one per post until now) out of post_media; the persona video's first frame becomes its poster.
INSERT INTO "post_videos" ("id","org_id","post_id","kind","slide_position","storage_key","poster_key","width","height","size_bytes","model","spec","created_at")
SELECT v."id", v."org_id", v."post_id",
  CASE WHEN v."model" = 'postaja-motion' THEN 'animation' ELSE 'persona' END,
  CASE WHEN v."model" = 'postaja-motion' THEN v."position" ELSE NULL END,
  v."storage_key",
  (SELECT k."storage_key" FROM "post_media" k WHERE k."post_id" = v."post_id" AND k."kind" = 'keyframe' LIMIT 1),
  v."width", v."height", v."size_bytes", COALESCE(v."model", 'unknown'),
  CASE WHEN v."prompt" IS NOT NULL AND left(v."prompt", 1) = '{' THEN v."prompt"::jsonb ELSE '{}'::jsonb END,
  v."created_at"
FROM "post_media" v WHERE v."kind" = 'video';
--> statement-breakpoint
DELETE FROM "post_media" WHERE "kind" IN ('video', 'keyframe');
