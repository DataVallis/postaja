CREATE TABLE "brand_profile_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"version" integer NOT NULL,
	"cgp" text DEFAULT '' NOT NULL,
	"rules" jsonb NOT NULL,
	"pillars" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visual" jsonb NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bpv_version_ck" CHECK ("brand_profile_versions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"website" text,
	"languages" text[] DEFAULT ARRAY['sl']::text[] NOT NULL,
	"current_profile_version_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"platform" text NOT NULL,
	"handle" text NOT NULL,
	"language" text DEFAULT 'sl' NOT NULL,
	"goal" jsonb NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allowed_types" text[] NOT NULL,
	"default_preset_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_profile_versions" ADD CONSTRAINT "brand_profile_versions_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_profile_versions" ADD CONSTRAINT "brand_profile_versions_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_profile_versions" ADD CONSTRAINT "brand_profile_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_default_preset_key_format_presets_key_fk" FOREIGN KEY ("default_preset_key") REFERENCES "public"."format_presets"("key") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bpv_brand_version_uq" ON "brand_profile_versions" USING btree ("brand_id","version");--> statement-breakpoint
CREATE INDEX "bpv_org_idx" ON "brand_profile_versions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_org_slug_uq" ON "brands" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "brands_org_idx" ON "brands" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "channels_org_idx" ON "channels" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "channels_brand_idx" ON "channels" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_brand_platform_handle_uq" ON "channels" USING btree ("brand_id","platform","handle");