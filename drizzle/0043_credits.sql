CREATE TABLE "credit_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"credits" integer NOT NULL,
	"remaining" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_packs_amount_ck" CHECK ("credit_packs"."credits" > 0 and "credit_packs"."remaining" >= 0 and "credit_packs"."remaining" <= "credit_packs"."credits"),
	CONSTRAINT "credit_packs_source_ck" CHECK ("credit_packs"."source" in ('grant','purchase'))
);
--> statement-breakpoint
CREATE TABLE "credit_prices" (
	"action" text PRIMARY KEY NOT NULL,
	"credits" integer NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_prices_credits_ck" CHECK ("credit_prices"."credits" >= 0 and "credit_prices"."credits" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "credit_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"pack" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" text,
	"resolved_by" text,
	"pack_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "credit_requests_pack_ck" CHECK ("credit_requests"."pack" in ('small','large')),
	CONSTRAINT "credit_requests_status_ck" CHECK ("credit_requests"."status" in ('pending','granted','declined'))
);
--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "action" text DEFAULT 'assist' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "pack_draws" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_packs" ADD CONSTRAINT "credit_packs_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_packs" ADD CONSTRAINT "credit_packs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_prices" ADD CONSTRAINT "credit_prices_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_requests" ADD CONSTRAINT "credit_requests_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_requests" ADD CONSTRAINT "credit_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_requests" ADD CONSTRAINT "credit_requests_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_requests" ADD CONSTRAINT "credit_requests_pack_id_credit_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."credit_packs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_packs_org_idx" ON "credit_packs" USING btree ("org_id","expires_at");--> statement-breakpoint
CREATE INDEX "credit_requests_org_idx" ON "credit_requests" USING btree ("org_id","created_at");--> statement-breakpoint
INSERT INTO "credit_prices" ("action","credits") VALUES ('text',1),('illustration',2),('animation',1),('persona_image',5),('persona_video_5s',25),('persona_video_10s',40),('research',5),('assist',0) ON CONFLICT DO NOTHING;
