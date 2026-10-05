-- Seed platform rules and format presets (TASK-004, ADR-030). Idempotent: existing rows (possibly edited by a super admin) are kept.
-- Where sources disagree the STRICTER value is used, and the conflict is recorded in `notes`.
INSERT INTO "platform_rules" ("platform","counting","caption_max","visible_chars","hashtags_max","mentions_max","links_clickable","thread_part_max","thread_parts_max","slides_min","slides_max","source","confidence","notes","verified_at") VALUES
('instagram','graphemes',2200,125,5,20,false,NULL,NULL,2,10,'socialync.io limits guide 2026; ruche-pollen.com (11 Jun 2026)','medium','Hashtags: sources say 30 (older) or 5 (since Jun 2026) -> 5. Carousel: 10 or 20 -> 10. Links in captions are not clickable.','2026-10-05'),
('facebook','graphemes',63206,125,NULL,NULL,true,NULL,NULL,2,10,'socialync.io limits guide 2026','medium','Preview length varies by device.','2026-10-05'),
('linkedin','graphemes',3000,210,NULL,NULL,true,NULL,NULL,2,300,'postnitro.ai LinkedIn post specs; socialync.io 2026','medium','Document carousels up to 300 pages / 100 MB. Preview ~210 chars desktop, less on mobile.','2026-10-05'),
('x','x_weighted',280,NULL,NULL,NULL,true,280,25,2,4,'X counting rules (URLs 23, emoji/CJK 2); socialync.io 2026','high','280 for non-Premium accounts; Premium allows 25,000 (set per channel later). Thread parts max 25 is a Postaja sanity limit. Max 4 images per post.','2026-10-05'),
('tiktok','graphemes',2200,100,NULL,NULL,false,NULL,NULL,2,35,'socialync.io limits guide 2026','medium','Caption: sources say 2,200 or 4,000 -> 2,200. Photo carousel up to 35.','2026-10-05'),
('youtube','graphemes',5000,NULL,NULL,NULL,true,NULL,NULL,NULL,NULL,'socialync.io limits guide 2026','medium','Shorts description limit; title max 100 handled in a later task.','2026-10-05'),
('google_display','graphemes',90,NULL,0,0,false,NULL,NULL,NULL,NULL,'Google responsive display ads specs','medium','Long headline 90; short headline 30 and description 90 are per-field limits (ads task).','2026-10-05')
ON CONFLICT ("platform") DO NOTHING;
--> statement-breakpoint
INSERT INTO "format_presets" ("key","platform","placement","width","height","media","max_bytes","min_duration_s","max_duration_s","safe_zone","source","confidence","notes","verified_at") VALUES
('ig_feed_portrait','instagram','feed',1080,1350,'image',30000000,NULL,NULL,'{"top":0,"right":0,"bottom":0,"left":0}','postsyncer.com Instagram sizes 2026; socialync.io','high','Default for posts and carousels (4:5).','2026-10-05'),
('ig_feed_square','instagram','feed',1080,1080,'image',30000000,NULL,NULL,'{"top":0,"right":0,"bottom":0,"left":0}','postsyncer.com Instagram sizes 2026','high',NULL,'2026-10-05'),
('ig_story_image','instagram','story',1080,1920,'image',30000000,NULL,NULL,'{"top":270,"right":65,"bottom":672,"left":65}','billo.app Meta safe zones (unified Mar 2026)','medium','Safe zone: top 14%, sides 6%, bottom 20-35% -> 35% (stricter).','2026-10-05'),
('ig_reel','instagram','reels',1080,1920,'video',4000000000,3,900,'{"top":270,"right":65,"bottom":672,"left":65}','billo.app Meta safe zones (unified Mar 2026); socialync.io','medium','Bottom 35% covered by caption and buttons.','2026-10-05'),
('fb_feed_portrait','facebook','feed',1080,1350,'image',30000000,NULL,NULL,'{"top":0,"right":0,"bottom":0,"left":0}','Meta ad specs 2026','high',NULL,'2026-10-05'),
('fb_feed_square','facebook','feed',1080,1080,'image',30000000,NULL,NULL,'{"top":0,"right":0,"bottom":0,"left":0}','Meta ad specs 2026','high',NULL,'2026-10-05'),
('fb_link','facebook','link',1200,628,'image',30000000,NULL,NULL,'{"top":0,"right":0,"bottom":0,"left":0}','Meta ad specs 2026','high','1.91:1 link / right column.','2026-10-05'),
('fb_story_reel','facebook','story_reels',1080,1920,'video',4000000000,3,900,'{"top":270,"right":65,"bottom":672,"left":65}','billo.app Meta safe zones (unified Mar 2026)','medium',NULL,'2026-10-05'),
('li_feed_portrait','linkedin','feed',1080,1350,'image',10000000,NULL,NULL,'{"top":0,"right":0,"bottom":0,"left":0}','postnitro.ai LinkedIn specs','high',NULL,'2026-10-05'),
('li_feed_square','linkedin','feed',1080,1080,'image',10000000,NULL,NULL,'{"top":0,"right":0,"bottom":0,"left":0}','postnitro.ai LinkedIn specs','high',NULL,'2026-10-05'),
('li_feed_landscape','linkedin','feed',1200,627,'image',10000000,NULL,NULL,'{"top":0,"right":0,"bottom":0,"left":0}','postnitro.ai LinkedIn specs','high','Also LinkedIn single-image ads.','2026-10-05'),
('li_document_page','linkedin','document',1080,1350,'pdf',100000000,NULL,NULL,'{"top":0,"right":0,"bottom":0,"left":0}','postnitro.ai LinkedIn specs','high','Carousel as PDF; max 300 pages.','2026-10-05'),
('li_video_vertical','linkedin','video',1080,1920,'video',5000000000,3,600,'{"top":0,"right":0,"bottom":0,"left":0}','postnitro.ai LinkedIn specs','high',NULL,'2026-10-05'),
('x_landscape','x','feed',1600,900,'image',5000000,NULL,NULL,'{"top":0,"right":0,"bottom":0,"left":0}','socialync.io 2026','medium','16:9.','2026-10-05'),
('x_square','x','feed',1080,1080,'image',5000000,NULL,NULL,'{"top":0,"right":0,"bottom":0,"left":0}','socialync.io 2026','medium',NULL,'2026-10-05'),
('x_video','x','feed',1080,1920,'video',512000000,1,140,'{"top":0,"right":0,"bottom":0,"left":0}','socialync.io 2026','medium','Free accounts: max 2:20.','2026-10-05'),
('tiktok_video','tiktok','feed',1080,1920,'video',4000000000,3,600,'{"top":150,"right":140,"bottom":480,"left":60}','industry TikTok safe-zone guides 2026','low','Right column and bottom caption area; verify before ads.','2026-10-05'),
('tiktok_photo','tiktok','photo',1080,1920,'image',72000000,NULL,NULL,'{"top":150,"right":140,"bottom":480,"left":60}','socialync.io 2026','low',NULL,'2026-10-05'),
('yt_short','youtube','shorts',1080,1920,'video',4000000000,1,180,'{"top":150,"right":140,"bottom":400,"left":60}','YouTube Shorts (up to 3 min)','low','Safe zone approximate.','2026-10-05'),
('gdn_responsive_landscape','google_display','responsive',1200,628,'image',5120000,NULL,NULL,'{"top":0,"right":0,"bottom":0,"left":0}','Google responsive display ads specs','high',NULL,'2026-10-05'),
('gdn_responsive_square','google_display','responsive',1200,1200,'image',5120000,NULL,NULL,'{"top":0,"right":0,"bottom":0,"left":0}','Google responsive display ads specs','high',NULL,'2026-10-05'),
('gdn_300x250','google_display','banner',300,250,'image',150000,NULL,NULL,'{"top":0,"right":0,"bottom":0,"left":0}','Google display uploaded ads (150 KB)','high',NULL,'2026-10-05'),
('gdn_336x280','google_display','banner',336,280,'image',150000,NULL,NULL,'{"top":0,"right":0,"bottom":0,"left":0}','Google display uploaded ads (150 KB)','high',NULL,'2026-10-05'),
('gdn_728x90','google_display','banner',728,90,'image',150000,NULL,NULL,'{"top":0,"right":0,"bottom":0,"left":0}','Google display uploaded ads (150 KB)','high',NULL,'2026-10-05'),
('gdn_300x600','google_display','banner',300,600,'image',150000,NULL,NULL,'{"top":0,"right":0,"bottom":0,"left":0}','Google display uploaded ads (150 KB)','high',NULL,'2026-10-05'),
('gdn_320x50','google_display','banner',320,50,'image',150000,NULL,NULL,'{"top":0,"right":0,"bottom":0,"left":0}','Google display uploaded ads (150 KB)','high',NULL,'2026-10-05'),
('gdn_160x600','google_display','banner',160,600,'image',150000,NULL,NULL,'{"top":0,"right":0,"bottom":0,"left":0}','Google display uploaded ads (150 KB)','high',NULL,'2026-10-05')
ON CONFLICT ("key") DO NOTHING;
