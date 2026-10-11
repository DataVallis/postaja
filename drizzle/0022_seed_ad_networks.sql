-- Ad copy fields per network (TASK-021, spec §5.8), checked 2026-10-07. Where sources differ the stricter limit is the
-- hard limit (ADR-030); "recommended" is the length shown before truncation (a warning, not a failure).
-- Meta: primary text 2,200 (125 visible), headline 40 (27), description 30 (27) — Meta ads guide figures as collected in
--   https://adligator.com/tools/ad-copy-length-checker ; CTA buttons from Ads Manager's standard list (medium confidence).
-- LinkedIn single image ads: intro 600 (150 visible), headline 200 (70) — https://zenabm.com/blog/linkedin-single-image-ad-specs/
-- Google responsive display: up to 5 headlines × 30, long headline 90, up to 5 descriptions × 90, business name 25 —
--   https://megadigital.ai/en/blog/google-ads-character-limit/ (matches Google Ads ResponsiveDisplayAdInfo).
-- ON CONFLICT DO NOTHING: later corrections by a super admin are never overwritten.
INSERT INTO "ad_networks" ("key","label","fields","ctas","placements","source","confidence","verified_at") VALUES
('meta','Meta (Facebook, Instagram)',
 '[{"key":"primary_text","label":"Primary text","min":1,"max":1,"maxChars":2200,"recommended":125},
   {"key":"headline","label":"Headline","min":1,"max":1,"maxChars":40,"recommended":27},
   {"key":"description","label":"Description","min":1,"max":1,"maxChars":30,"recommended":27}]'::jsonb,
 '["Learn More","Shop Now","Sign Up","Book Now","Contact Us","Download","Get Offer","Get Quote","Subscribe","Apply Now","Order Now","Send Message"]'::jsonb,
 ARRAY['fb_feed_portrait','fb_feed_square','ig_story_image'],
 'https://adligator.com/tools/ad-copy-length-checker','medium','2026-10-07'),
('linkedin','LinkedIn',
 '[{"key":"intro_text","label":"Introductory text","min":1,"max":1,"maxChars":600,"recommended":150},
   {"key":"headline","label":"Headline","min":1,"max":1,"maxChars":200,"recommended":70}]'::jsonb,
 '["Apply","Download","Get Quote","Learn More","Register","Request Demo","Sign Up","Subscribe","View Jobs"]'::jsonb,
 ARRAY['li_feed_landscape','li_feed_square'],
 'https://zenabm.com/blog/linkedin-single-image-ad-specs/','medium','2026-10-07'),
('google_display','Google Display (responsive)',
 '[{"key":"headlines","label":"Headlines","min":1,"max":5,"maxChars":30,"recommended":null},
   {"key":"long_headline","label":"Long headline","min":1,"max":1,"maxChars":90,"recommended":null},
   {"key":"descriptions","label":"Descriptions","min":1,"max":5,"maxChars":90,"recommended":null},
   {"key":"business_name","label":"Business name","min":1,"max":1,"maxChars":25,"recommended":null}]'::jsonb,
 '[]'::jsonb,
 ARRAY['gdn_responsive_landscape','gdn_responsive_square'],
 'https://megadigital.ai/en/blog/google-ads-character-limit/','high','2026-10-07')
ON CONFLICT DO NOTHING;
