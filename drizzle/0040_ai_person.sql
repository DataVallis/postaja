ALTER TABLE "post_media" ADD COLUMN "ai_person" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Existing persona illustrations (made by the reference / persona image models) and the slides drawn on them.
UPDATE "post_media" SET "ai_person" = true WHERE "kind" = 'background' AND "model" IN (SELECT "model_key" FROM "model_registry" WHERE "kind" IN ('image_ref', 'image_persona'));
--> statement-breakpoint
UPDATE "post_media" s SET "ai_person" = true FROM "post_media" b
WHERE s."kind" = 'slide' AND b."kind" = 'background' AND b."ai_person" AND s."post_id" = b."post_id" AND s."position" = b."position"
  AND (s."run_id" IS NOT DISTINCT FROM b."run_id" OR (s."archived_at" IS NULL AND b."archived_at" IS NULL));
