ALTER TABLE "post_media" DROP CONSTRAINT "post_media_kind_ck";--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "video_mode" text DEFAULT 'motion' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "video_duration_s" integer;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_video_mode_ck" CHECK ("posts"."video_mode" in ('motion','persona'));--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_kind_ck" CHECK ("post_media"."kind" in ('slide','background','video','keyframe'));