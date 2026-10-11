# TASK-056 — Premium first impression: value, posts as they will look, the feed

Owner (2026-10-11): "bolj premium dizajn, da dokazuje vrednost, da nekdo plačuje na tisoče za naročnino". Direction
agreed on the Claude Design canvas "Postaja — premium smer" (dashboard, visual identity, month feed); owner: "mi je kar
top, implementiraj". Owner's correction: images are made on request, so a plan never shows pictures that do not exist.

## Scope
1. Dashboard: headline that says what is planned today (accent words in Instrument Serif italic); "this month with
   Postaja" strip — posts written, graphics, time saved and its value (estimates, said so: 20 min per post, 15 min per
   graphic, 40 €/h; constants in `server/posts/showcase.ts`); today's posts as tiles (cover image, or a dashed tile
   "Slika nastane na klik"); brand cards (logo, design colours, channels, upcoming, next day). Existing goals, stats,
   recent and costs stay.
2. Brand visual identity: input checklist with icons; a working card with the steps of a run; larger template previews;
   each version's first template and colours in the versions table.
3. Plan → **Feed** view: one channel's month as its feed (images where made, dashed tiles otherwise), the picked post on a
   phone with "Ustvari sliko", "Ustvari slike za naslednjih 7 dni (n)" → the existing bulk preview (credits shown there).

## Not in scope
Per-step progress tracking of design runs, white-label approval pages, monthly PDF report, logo on the phone preview.

## Acceptance
- Numbers come from the usage ledger (settled `text` / `illustration` of this month), org-scoped; integration test.
- No image shown for a post that has none; published posts without images say so.
- E2E: dashboard hero, value, tiles, brand cards; feed channel pick, grid, phone with "Ustvari sliko"; axe clean.
