-- Image-to-video model for animations (TASK-022, ADR-051): MiniMax Hailuo-02 Standard on fal.ai, 768p, $0.045 per
-- second of output (a 6 s clip = $0.27), from https://fal.ai/models/fal-ai/minimax/hailuo-02/standard/image-to-video
-- (checked 2026-10-07; Kling 2.1 Standard is deprecated there). ON CONFLICT DO NOTHING keeps later admin edits.
INSERT INTO "model_registry" ("id","provider","model_key","kind","label","input_per_mtok","output_per_mtok","cache_write_per_mtok","cache_read_per_mtok","per_megapixel","per_image","per_second","is_default","enabled","source","verified_at") VALUES
('fal-hailuo-02-standard-i2v','fal','fal-ai/minimax/hailuo-02/standard/image-to-video','video','Hailuo 02 Standard (768p)',0,0,0,0,0,0,45000,true,true,'https://fal.ai/models/fal-ai/minimax/hailuo-02/standard/image-to-video','2026-10-07')
ON CONFLICT DO NOTHING;
