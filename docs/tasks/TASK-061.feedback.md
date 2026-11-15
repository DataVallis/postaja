# TASK-061 feedback
Status: DONE (core; undo and cost per answer follow in the next PR)

## What I implemented
A conversation next to each post (ADR-099): the request opens it, later messages are routed by one free Claude call
to a text rewrite, an image correction, both, or an answer only.

## Files changed (path — why)
- `src/server/db/schema/chat.ts`, `src/server/db/schema.ts`, `drizzle/0056_post_messages.sql` (+ snapshot, journal) — messages.
- `src/server/chat/service.ts` — `listMessages`, `chatTurn`, `startConversation`.
- `src/server/posts/{prompt.ts,generate.ts}` — revision prompt, `revisePostText`, rollback on failure.
- `src/app/app/posts/actions.ts` — `chatAction`; a new post opens its conversation.
- `src/app/app/posts/[id]/{chat-panel.tsx,page.tsx}` — panel and two-column layout; editor resets only after a conversation rewrite.
- `messages/{sl,en}.json` — `Chat` texts.
- Tests: `src/server/chat/chat.int.test.ts`, e2e `posts.spec.ts`, `tests/e2e/mock-anthropic.mjs` (`route_message`).
- Docs: ADR-099, this task, tasks README, HANDOFF, `technical/posts.md`, user guide chapter 4 (sl, en).

## Deviations from the task (and why)
- When a post has no images yet, an image message starts new images with mode "new"; the wording of the message is
  not passed to the image plan yet.
- Without a brand design a new post's answer says so instead of staying silent (owner can then set the design up).

## New dependencies
None.

## How to verify
- dev → a brand → Objave → request → the post page shows *Pogovor* on the left with the request and "Besedilo je
  pripravljeno."; write "naj bo krajše" → *Pošlji* → the text on the right changes; write "na sliki naj bo drug
  naslov" → the images are corrected.

## Test results (this session, 2026-11-15)
- `pnpm lint` — 0 errors (1 old warning). `pnpm typecheck` — clean.
- `pnpm test` — 271 passed.
- `pnpm test:int` — 367 passed, 1 failed locally: `migrate.int.test.ts › vector type works after migration` (local
  pgvector stand-in; CI uses real pgvector).
- `pnpm exec playwright test` — 47 passed, 1 failed (`bulk.spec.ts`, caused by the editor key; fixed), then
  `posts.spec.ts` + `bulk.spec.ts` 2 passed.

## Deliberate breaks
- Revision prompt removed → `chat.int.test.ts` text correction failed.
- Rollback removed → `chat.int.test.ts` failed rewrite keeps the post failed. Both restored → 6 passed.

## NOT RUN
- Real Claude and fal on dev until the deploy (checked after merge).

## Open questions / risks
- Routing quality with the real model: watched on dev.
