-- Persona passport and keyframe images (TASK-024, ADR-053): image models that take reference pictures of the same
-- person. Default Nano Banana (Gemini 2.5 Flash Image) edit, $0.039 per image, several image_urls, aspect_ratio;
-- Seedream v4 edit ($0.03 per image, up to 10 references) as an enabled alternative. Checked 2026-10-07 on
-- https://fal.ai/models/fal-ai/nano-banana/edit and https://fal.ai/models/fal-ai/bytedance/seedream/v4/edit.
INSERT INTO "model_registry" ("id","provider","model_key","kind","label","input_per_mtok","output_per_mtok","cache_write_per_mtok","cache_read_per_mtok","per_megapixel","per_image","per_second","is_default","enabled","source","verified_at") VALUES
('fal-nano-banana-edit','fal','fal-ai/nano-banana/edit','image_ref','Nano Banana edit (reference)',0,0,0,0,0,39000,0,true,true,'https://fal.ai/models/fal-ai/nano-banana/edit','2026-10-07'),
('fal-seedream-v4-edit','fal','fal-ai/bytedance/seedream/v4/edit','image_ref','Seedream 4.0 edit (reference)',0,0,0,0,0,30000,0,false,true,'https://fal.ai/models/fal-ai/bytedance/seedream/v4/edit','2026-10-07')
ON CONFLICT ("id") DO NOTHING;
