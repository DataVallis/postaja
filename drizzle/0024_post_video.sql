ALTER TABLE "model_registry" DROP CONSTRAINT "model_registry_prices_ck";--> statement-breakpoint
ALTER TABLE "post_media" DROP CONSTRAINT "post_media_kind_ck";--> statement-breakpoint
ALTER TABLE "model_registry" ADD COLUMN "per_second" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "video_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "video_error" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "video_requested_by" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "video_motion" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "video_position" integer;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_video_requested_by_user_id_fk" FOREIGN KEY ("video_requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_registry" ADD CONSTRAINT "model_registry_prices_ck" CHECK ("model_registry"."input_per_mtok" >= 0 and "model_registry"."output_per_mtok" >= 0 and "model_registry"."cache_write_per_mtok" >= 0 and "model_registry"."cache_read_per_mtok" >= 0 and "model_registry"."per_megapixel" >= 0 and "model_registry"."per_image" >= 0 and "model_registry"."per_second" >= 0);--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_video_status_ck" CHECK ("posts"."video_status" in ('none','queued','rendering','ready','failed'));--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_kind_ck" CHECK ("post_media"."kind" in ('slide','background','video'));