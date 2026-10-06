CREATE TABLE "brand_designs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"spec" jsonb,
	"brief" text DEFAULT '' NOT NULL,
	"instruction" text,
	"based_on" text,
	"error" text,
	"model" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_designs_status_ck" CHECK ("brand_designs"."status" in ('generating','ready','failed'))
);
--> statement-breakpoint
ALTER TABLE "model_registry" DROP CONSTRAINT "model_registry_prices_ck";--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "current_design_id" text;--> statement-breakpoint
ALTER TABLE "model_registry" ADD COLUMN "per_image" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "visual" jsonb;--> statement-breakpoint
ALTER TABLE "brand_designs" ADD CONSTRAINT "brand_designs_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_designs" ADD CONSTRAINT "brand_designs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_designs" ADD CONSTRAINT "brand_designs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_designs_org_idx" ON "brand_designs" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_designs_brand_version_uq" ON "brand_designs" USING btree ("brand_id","version");--> statement-breakpoint
ALTER TABLE "model_registry" ADD CONSTRAINT "model_registry_prices_ck" CHECK ("model_registry"."input_per_mtok" >= 0 and "model_registry"."output_per_mtok" >= 0 and "model_registry"."cache_write_per_mtok" >= 0 and "model_registry"."cache_read_per_mtok" >= 0 and "model_registry"."per_megapixel" >= 0 and "model_registry"."per_image" >= 0);