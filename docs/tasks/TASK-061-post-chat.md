# TASK-061 — Conversation next to the post
Depends on: TASK-059
Read first: docs/03-DECISIONS.md (ADR-099, ADR-062, ADR-071), docs/LAUNCH-PLAN.md, docs/technical/posts.md, docs/technical/images.md

## Goal
Making a post feels like a Claude chat: the owner asks, sees the post, and corrects text or images in words in one
thread next to the preview.

## Scope
1. `post_messages` (tenant table, migration 0056); messages kept, never deleted.
2. A new post: the request is the first message; the answer says the text is ready and starts the images when the
   channel takes images (or says why not).
3. Every later message: one free routing call decides text / images / both / answer only.
4. Text: rewrite through the writing loop with the current post and the instruction; failure keeps the post.
5. Images: the existing correction; busy image or text work refuses a new message.
6. Post page: conversation left (below on phones), post right; editor keeps hand edits.
7. Tests: integration (routing, rewrite, images, busy, failure, refusals, cross-tenant), e2e, i18n, a11y.

## Out of scope (follow-up PR)
Undo of a change ("Razveljavi") and the cost shown on each answer.
