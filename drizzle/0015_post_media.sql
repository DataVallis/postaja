CREATE TABLE "post_media" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"post_id" text NOT NULL,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" bigint NOT NULL,
	"model" text,
	"prompt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_media_kind_ck" CHECK ("post_media"."kind" in ('slide','background')),
	CONSTRAINT "post_media_size_ck" CHECK ("post_media"."width" > 0 and "post_media"."height" > 0 and "post_media"."size_bytes" > 0 and "post_media"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "model_registry" DROP CONSTRAINT "model_registry_prices_ck";--> statement-breakpoint
ALTER TABLE "bulk_items" DROP CONSTRAINT "bulk_items_step_ck";--> statement-breakpoint
ALTER TABLE "model_registry" ADD COLUMN "per_megapixel" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "media_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "media_error" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "media_requested_by" text;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "megapixels" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_media_org_idx" ON "post_media" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_media_post_kind_pos_uq" ON "post_media" USING btree ("post_id","kind","position");--> statement-breakpoint
CREATE UNIQUE INDEX "post_media_key_uq" ON "post_media" USING btree ("storage_key");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_media_requested_by_user_id_fk" FOREIGN KEY ("media_requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_registry" ADD CONSTRAINT "model_registry_prices_ck" CHECK ("model_registry"."input_per_mtok" >= 0 and "model_registry"."output_per_mtok" >= 0 and "model_registry"."cache_write_per_mtok" >= 0 and "model_registry"."cache_read_per_mtok" >= 0 and "model_registry"."per_megapixel" >= 0);--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_media_status_ck" CHECK ("posts"."media_status" in ('none','queued','rendering','ready','failed'));--> statement-breakpoint
ALTER TABLE "bulk_items" ADD CONSTRAINT "bulk_items_step_ck" CHECK ("bulk_items"."step" in ('text','image'));