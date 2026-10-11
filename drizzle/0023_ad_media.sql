CREATE TABLE "ad_media" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"ad_set_id" text NOT NULL,
	"kind" text NOT NULL,
	"variant" integer NOT NULL,
	"placement" text DEFAULT '' NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" bigint NOT NULL,
	"model" text,
	"prompt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_media_kind_ck" CHECK ("ad_media"."kind" in ('illustration','creative'))
);
--> statement-breakpoint
ALTER TABLE "ad_sets" ADD COLUMN "visual" jsonb;--> statement-breakpoint
ALTER TABLE "ad_sets" ADD COLUMN "media_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_sets" ADD COLUMN "media_error" text;--> statement-breakpoint
ALTER TABLE "ad_sets" ADD COLUMN "media_requested_by" text;--> statement-breakpoint
ALTER TABLE "ad_media" ADD CONSTRAINT "ad_media_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_media" ADD CONSTRAINT "ad_media_ad_set_id_ad_sets_id_fk" FOREIGN KEY ("ad_set_id") REFERENCES "public"."ad_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_media_org_idx" ON "ad_media" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_media_set_kind_variant_placement_uq" ON "ad_media" USING btree ("ad_set_id","kind","variant","placement");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_media_key_uq" ON "ad_media" USING btree ("storage_key");--> statement-breakpoint
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_media_requested_by_user_id_fk" FOREIGN KEY ("media_requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_media_status_ck" CHECK ("ad_sets"."media_status" in ('none','queued','rendering','ready','failed'));