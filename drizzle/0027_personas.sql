CREATE TABLE "persona_images" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"angle" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"filename" text,
	"model" text,
	"prompt" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persona_images_angle_ck" CHECK ("persona_images"."angle" in ('front','three_quarter','profile','smile','full_body','other')),
	CONSTRAINT "persona_images_source_ck" CHECK ("persona_images"."source" in ('uploaded','generated')),
	CONSTRAINT "persona_images_size_ck" CHECK ("persona_images"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"name" text NOT NULL,
	"handle" text DEFAULT '' NOT NULL,
	"dna" jsonb NOT NULL,
	"passport_status" text DEFAULT 'none' NOT NULL,
	"passport_error" text,
	"passport_requested_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personas_passport_status_ck" CHECK ("personas"."passport_status" in ('none','queued','rendering','ready','failed'))
);
--> statement-breakpoint
ALTER TABLE "persona_images" ADD CONSTRAINT "persona_images_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_images" ADD CONSTRAINT "persona_images_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_images" ADD CONSTRAINT "persona_images_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_passport_requested_by_user_id_fk" FOREIGN KEY ("passport_requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "persona_images_persona_idx" ON "persona_images" USING btree ("org_id","persona_id");--> statement-breakpoint
CREATE UNIQUE INDEX "persona_images_key_uq" ON "persona_images" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "persona_images_sha_uq" ON "persona_images" USING btree ("persona_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "persona_images_primary_uq" ON "persona_images" USING btree ("persona_id") WHERE "persona_images"."is_primary";--> statement-breakpoint
CREATE INDEX "personas_org_idx" ON "personas" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personas_brand_uq" ON "personas" USING btree ("brand_id");