-- Image model that takes the brand's example images as a style reference (TASK-017, ADR-044): Ideogram V3 on fal.ai,
-- BALANCED speed, $0.06 per image, from https://fal.ai/models/fal-ai/ideogram/v3 (checked 2026-10-06).
-- ON CONFLICT DO NOTHING: a super admin's later edits are never overwritten (same rule as ADR-030).
INSERT INTO "model_registry" ("id","provider","model_key","kind","label","input_per_mtok","output_per_mtok","cache_write_per_mtok","cache_read_per_mtok","per_megapixel","per_image","is_default","enabled","source","verified_at") VALUES
('fal-ideogram-v3','fal','fal-ai/ideogram/v3','image_style','Ideogram V3 (style reference)',0,0,0,0,0,60000,true,true,'https://fal.ai/models/fal-ai/ideogram/v3','2026-10-06')
ON CONFLICT DO NOTHING;
