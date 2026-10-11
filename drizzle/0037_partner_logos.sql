ALTER TABLE "brand_assets" DROP CONSTRAINT "brand_assets_kind_ck";--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "partner_logo_id" text;--> statement-breakpoint
ALTER TABLE "ad_sets" ADD COLUMN "partner_logo_id" text;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_partner_logo_id_brand_assets_id_fk" FOREIGN KEY ("partner_logo_id") REFERENCES "public"."brand_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_partner_logo_id_brand_assets_id_fk" FOREIGN KEY ("partner_logo_id") REFERENCES "public"."brand_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_kind_ck" CHECK ("brand_assets"."kind" in ('logo','partner','font'));