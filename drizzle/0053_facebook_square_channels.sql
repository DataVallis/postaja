-- ADR-092 (owner, 2026-10-25): a Facebook channel set to the 4:5 ad size still got 1080x1350 post images after
-- ADR-090. Facebook post images are square: channels on fb_feed_portrait go back to the default (fb_feed_square).
UPDATE "channels" SET "default_preset_key" = NULL, "updated_at" = now()
WHERE "platform" = 'facebook' AND "default_preset_key" = 'fb_feed_portrait';
