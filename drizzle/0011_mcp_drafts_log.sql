CREATE TABLE "cgp_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"text" text NOT NULL,
	"note" text,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "cgp_drafts_status_ck" CHECK ("cgp_drafts"."status" in ('pending','used','discarded')),
	CONSTRAINT "cgp_drafts_source_ck" CHECK ("cgp_drafts"."source" in ('claude'))
);
--> statement-breakpoint
CREATE TABLE "mcp_tool_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"tool" text NOT NULL,
	"ok" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_tool_calls_ok_ck" CHECK ("mcp_tool_calls"."ok" in ('ok','error'))
);
--> statement-breakpoint
ALTER TABLE "cgp_drafts" ADD CONSTRAINT "cgp_drafts_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cgp_drafts" ADD CONSTRAINT "cgp_drafts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cgp_drafts" ADD CONSTRAINT "cgp_drafts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cgp_drafts_brand_idx" ON "cgp_drafts" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE INDEX "cgp_drafts_org_idx" ON "cgp_drafts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "mcp_tool_calls_org_created_idx" ON "mcp_tool_calls" USING btree ("org_id","created_at");