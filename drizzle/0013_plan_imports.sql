CREATE TABLE "plan_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"filename" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"tables" jsonb,
	"mappings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"items" jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reader" jsonb NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"imported_at" timestamp with time zone,
	CONSTRAINT "plan_imports_kind_ck" CHECK ("plan_imports"."kind" in ('table','document')),
	CONSTRAINT "plan_imports_status_ck" CHECK ("plan_imports"."status" in ('draft','imported','discarded'))
);
--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT "posts_status_ck";--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "format" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "scheduled_on" date;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "scheduled_time" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "plan" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "import_id" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plan_imports" ADD CONSTRAINT "plan_imports_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_imports" ADD CONSTRAINT "plan_imports_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_imports_org_idx" ON "plan_imports" USING btree ("org_id","created_at");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_import_id_plan_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."plan_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_org_scheduled_idx" ON "posts" USING btree ("org_id","scheduled_on");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_format_ck" CHECK ("posts"."format" in ('text','image','carousel','thread','video'));--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_time_ck" CHECK ("posts"."scheduled_time" is null or "posts"."scheduled_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_status_ck" CHECK ("posts"."status" in ('planned','generating','ready','needs_review','failed','approved','published','skipped'));