-- The seller is David Tacer s.p. (owner, 2026-10-09): the sales organization of TASK-040 is renamed (same org, same demos).
UPDATE "organization" SET "name" = 'Postaja – prodaja', "slug" = 'postaja-prodaja' WHERE "slug" = 'data-vallis-prodaja' AND NOT EXISTS (SELECT 1 FROM "organization" WHERE "slug" = 'postaja-prodaja');
