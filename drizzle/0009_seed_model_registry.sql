-- Text models for post generation (TASK-007, ADR-036). Prices in micro-USD per million tokens, from
-- https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-06). Model ids as published by Anthropic.
-- ON CONFLICT DO NOTHING: a super admin's later edits are never overwritten (same rule as ADR-030).
INSERT INTO "model_registry" ("id","provider","model_key","kind","label","input_per_mtok","output_per_mtok","cache_write_per_mtok","cache_read_per_mtok","is_default","enabled","source","verified_at") VALUES
('anthropic-claude-sonnet-5-5','anthropic','claude-sonnet-5-5','text','Claude Sonnet 5.5',2000000,10000000,2500000,200000,true,true,'https://platform.claude.com/docs/en/about-claude/pricing','2026-10-06'),
('anthropic-claude-haiku-4-5','anthropic','claude-haiku-4-5-20251001','text','Claude Haiku 4.5',1000000,5000000,1250000,100000,false,true,'https://platform.claude.com/docs/en/about-claude/pricing','2026-10-06'),
('anthropic-claude-opus-5-5','anthropic','claude-opus-5-5','text','Claude Opus 5.5',4000000,20000000,5000000,200000,false,true,'https://platform.claude.com/docs/en/about-claude/pricing','2026-10-06')
ON CONFLICT DO NOTHING;
