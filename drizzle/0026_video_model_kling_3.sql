-- Owner (2026-10-07): the planned video model is Kling 3.0, not Hailuo (agent's pick in 0025). Kling 3.0 Standard
-- image-to-video on fal.ai: $0.084 per second without audio (Postaja adds a silent track), 3–15 s, default 5 s;
-- https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video (checked 2026-10-07). Hailuo stays as an
-- enabled alternative, no longer the default (one default per kind).
UPDATE "model_registry" SET "is_default" = false WHERE "kind" = 'video' AND "id" = 'fal-hailuo-02-standard-i2v';
--> statement-breakpoint
INSERT INTO "model_registry" ("id","provider","model_key","kind","label","input_per_mtok","output_per_mtok","cache_write_per_mtok","cache_read_per_mtok","per_megapixel","per_image","per_second","is_default","enabled","source","verified_at") VALUES
('fal-kling-v3-standard-i2v','fal','fal-ai/kling-video/v3/standard/image-to-video','video','Kling 3.0 Standard',0,0,0,0,0,0,84000,true,true,'https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video','2026-10-07')
ON CONFLICT ("id") DO UPDATE SET "is_default" = true, "enabled" = true;
