ALTER TABLE "oauth_access_token" DROP CONSTRAINT "oauth_access_token_session_id_session_id_fk";
--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" DROP CONSTRAINT "oauth_refresh_token_session_id_session_id_fk";
--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;