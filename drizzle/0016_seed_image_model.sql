-- Image model for post backgrounds (TASK-015, ADR-043). Price in micro-USD per megapixel, billed per image rounded up
-- to the next megapixel, from https://fal.ai/models/fal-ai/flux-pro/v1.1 (checked 2026-10-06: $0.04 per megapixel).
-- ON CONFLICT DO NOTHING: a super admin's later edits are never overwritten (same rule as ADR-030).
INSERT INTO "model_registry" ("id","provider","model_key","kind","label","input_per_mtok","output_per_mtok","cache_write_per_mtok","cache_read_per_mtok","per_megapixel","is_default","enabled","source","verified_at") VALUES
('fal-flux-pro-v1-1','fal','fal-ai/flux-pro/v1.1','image','FLUX1.1 [pro]',0,0,0,0,40000,true,true,'https://fal.ai/models/fal-ai/flux-pro/v1.1','2026-10-06')
ON CONFLICT DO NOTHING;
