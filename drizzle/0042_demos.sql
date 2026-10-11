CREATE TABLE "demos" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text,
	"url" text NOT NULL,
	"name_hint" text DEFAULT '' NOT NULL,
	"pasted_text" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"step" text DEFAULT 'site' NOT NULL,
	"error" text,
	"warnings" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"post_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"ad_set_id" text,
	"token_hash" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demos_status_ck" CHECK ("demos"."status" in ('queued','running','ready','failed'))
);
--> statement-breakpoint
ALTER TABLE "demos" ADD CONSTRAINT "demos_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demos" ADD CONSTRAINT "demos_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demos" ADD CONSTRAINT "demos_ad_set_id_ad_sets_id_fk" FOREIGN KEY ("ad_set_id") REFERENCES "public"."ad_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demos" ADD CONSTRAINT "demos_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "demos_token_uq" ON "demos" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "demos_org_idx" ON "demos" USING btree ("org_id","created_at");