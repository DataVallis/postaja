CREATE TABLE "model_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model_key" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"input_per_mtok" bigint NOT NULL,
	"output_per_mtok" bigint NOT NULL,
	"cache_write_per_mtok" bigint NOT NULL,
	"cache_read_per_mtok" bigint NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"source" text NOT NULL,
	"verified_at" date NOT NULL,
	CONSTRAINT "model_registry_prices_ck" CHECK ("model_registry"."input_per_mtok" >= 0 and "model_registry"."output_per_mtok" >= 0 and "model_registry"."cache_write_per_mtok" >= 0 and "model_registry"."cache_read_per_mtok" >= 0)
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"channel_id" text,
	"profile_version_id" text NOT NULL,
	"type" text DEFAULT 'text' NOT NULL,
	"brief" text NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"content" jsonb,
	"topic_summary" text,
	"rule_failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fix_attempts" integer DEFAULT 0 NOT NULL,
	"model" text,
	"error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_status_ck" CHECK ("posts"."status" in ('generating','ready','needs_review','failed','approved','published','skipped')),
	CONSTRAINT "posts_type_ck" CHECK ("posts"."type" in ('text'))
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text,
	"post_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"state" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_ledger_state_ck" CHECK ("usage_ledger"."state" in ('reserved','settled')),
	CONSTRAINT "usage_ledger_cost_ck" CHECK ("usage_ledger"."cost_micro_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_profile_version_id_brand_profile_versions_id_fk" FOREIGN KEY ("profile_version_id") REFERENCES "public"."brand_profile_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_registry_provider_key_uq" ON "model_registry" USING btree ("provider","model_key");--> statement-breakpoint
CREATE UNIQUE INDEX "model_registry_default_uq" ON "model_registry" USING btree ("kind") WHERE "model_registry"."is_default";--> statement-breakpoint
CREATE INDEX "posts_org_idx" ON "posts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "posts_brand_created_idx" ON "posts" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_ledger_org_created_idx" ON "usage_ledger" USING btree ("org_id","created_at");