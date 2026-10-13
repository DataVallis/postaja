ALTER TABLE "posts" DROP CONSTRAINT "posts_video_mode_ck";--> statement-breakpoint
ALTER TABLE "post_videos" DROP CONSTRAINT "post_videos_kind_ck";--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_video_mode_ck" CHECK ("posts"."video_mode" in ('motion','persona','reel'));--> statement-breakpoint
ALTER TABLE "post_videos" ADD CONSTRAINT "post_videos_kind_ck" CHECK ("post_videos"."kind" in ('animation','persona','reel'));--> statement-breakpoint
-- TASK-058: a reel's video is booked per second of Kling video (4 credits/s, like the 10 s persona video).
INSERT INTO "credit_prices" ("action","credits") VALUES ('reel_second',4) ON CONFLICT DO NOTHING;
