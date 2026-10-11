CREATE TABLE "brand_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"filename" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "brand_assets_kind_ck" CHECK ("brand_assets"."kind" in ('logo','font')),
	CONSTRAINT "brand_assets_size_ck" CHECK ("brand_assets"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "brand_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"filename" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"extract" jsonb,
	"error" text,
	CONSTRAINT "brand_sources_kind_ck" CHECK ("brand_sources"."kind" in ('pdf','docx','xlsx','csv','pptx','text','image')),
	CONSTRAINT "brand_sources_status_ck" CHECK ("brand_sources"."status" in ('uploaded','extracting','extracted','failed')),
	CONSTRAINT "brand_sources_size_ck" CHECK ("brand_sources"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_sources" ADD CONSTRAINT "brand_sources_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_sources" ADD CONSTRAINT "brand_sources_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_sources" ADD CONSTRAINT "brand_sources_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_assets_org_idx" ON "brand_assets" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "brand_assets_brand_idx" ON "brand_assets" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_assets_key_uq" ON "brand_assets" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_assets_brand_sha_uq" ON "brand_assets" USING btree ("brand_id","sha256");--> statement-breakpoint
CREATE INDEX "brand_sources_org_idx" ON "brand_sources" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "brand_sources_brand_idx" ON "brand_sources" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_sources_key_uq" ON "brand_sources" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_sources_brand_sha_uq" ON "brand_sources" USING btree ("brand_id","sha256");