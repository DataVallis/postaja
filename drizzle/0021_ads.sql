CREATE TABLE "ad_networks" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"fields" jsonb NOT NULL,
	"ctas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"placements" text[] NOT NULL,
	"source" text NOT NULL,
	"confidence" text NOT NULL,
	"verified_at" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"name" text NOT NULL,
	"objective" text NOT NULL,
	"networks" text[] NOT NULL,
	"placements" text[] NOT NULL,
	"offer" text DEFAULT '' NOT NULL,
	"landing_url" text,
	"brief" text DEFAULT '' NOT NULL,
	"language" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"copy" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_sets_status_ck" CHECK ("ad_sets"."status" in ('draft','ready','needs_review')),
	CONSTRAINT "ad_sets_objective_ck" CHECK ("ad_sets"."objective" in ('awareness','traffic','leads','sales'))
);
--> statement-breakpoint
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_sets_org_brand_idx" ON "ad_sets" USING btree ("org_id","brand_id","created_at");