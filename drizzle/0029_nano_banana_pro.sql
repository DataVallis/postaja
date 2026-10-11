-- Owner (2026-10-07): persona pictures must look like a real person — Nano Banana Pro (Gemini 3 Pro Image) on fal.ai,
-- $0.15 per image (1K/2K; 4K double). Checked 2026-10-07 on https://fal.ai/models/fal-ai/nano-banana-pro.
-- "image_persona": text-to-image for the persona's passport picture; "image_ref" default moves to its /edit endpoint
-- (for keyframes with the persona's pictures as reference). Nano Banana and Seedream edit stay as alternatives.
UPDATE "model_registry" SET "is_default" = false WHERE "kind" = 'image_ref';
--> statement-breakpoint
INSERT INTO "model_registry" ("id","provider","model_key","kind","label","input_per_mtok","output_per_mtok","cache_write_per_mtok","cache_read_per_mtok","per_megapixel","per_image","per_second","is_default","enabled","source","verified_at") VALUES
('fal-nano-banana-pro','fal','fal-ai/nano-banana-pro','image_persona','Nano Banana Pro (persona)',0,0,0,0,0,150000,0,true,true,'https://fal.ai/models/fal-ai/nano-banana-pro','2026-10-07'),
('fal-nano-banana-pro-edit','fal','fal-ai/nano-banana-pro/edit','image_ref','Nano Banana Pro edit (reference)',0,0,0,0,0,150000,0,true,true,'https://fal.ai/models/fal-ai/nano-banana-pro/edit','2026-10-07')
ON CONFLICT ("id") DO UPDATE SET "is_default" = true, "enabled" = true;
