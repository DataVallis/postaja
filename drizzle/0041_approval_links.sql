CREATE TABLE "approval_links" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_links_range_ck" CHECK ("approval_links"."to_date" >= "approval_links"."from_date")
);
--> statement-breakpoint
CREATE TABLE "post_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"post_id" text NOT NULL,
	"link_id" text,
	"decision" text NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"reviewer" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_reviews_decision_ck" CHECK ("post_reviews"."decision" in ('approved','changes'))
);
--> statement-breakpoint
ALTER TABLE "approval_links" ADD CONSTRAINT "approval_links_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_links" ADD CONSTRAINT "approval_links_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_links" ADD CONSTRAINT "approval_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reviews" ADD CONSTRAINT "post_reviews_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reviews" ADD CONSTRAINT "post_reviews_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reviews" ADD CONSTRAINT "post_reviews_link_id_approval_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."approval_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_links_token_uq" ON "approval_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "approval_links_brand_idx" ON "approval_links" USING btree ("org_id","brand_id");--> statement-breakpoint
CREATE INDEX "post_reviews_post_idx" ON "post_reviews" USING btree ("org_id","post_id","created_at");