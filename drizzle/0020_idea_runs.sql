CREATE TABLE "idea_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"ideas" jsonb NOT NULL,
	"replaced" integer DEFAULT 0 NOT NULL,
	"hint" text DEFAULT '' NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idea_runs_status_ck" CHECK ("idea_runs"."status" in ('draft','accepted','discarded'))
);
--> statement-breakpoint
ALTER TABLE "idea_runs" ADD CONSTRAINT "idea_runs_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_runs" ADD CONSTRAINT "idea_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_runs" ADD CONSTRAINT "idea_runs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_runs" ADD CONSTRAINT "idea_runs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idea_runs_org_idx" ON "idea_runs" USING btree ("org_id","created_at");