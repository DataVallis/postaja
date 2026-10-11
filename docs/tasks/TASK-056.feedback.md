# TASK-056 — feedback

Built on `feat/TASK-056-premium-ui`.

- `src/server/posts/showcase.ts`: `monthValue`, `coverImages`, `brandCards`, `feedChannels` (+ `showcase.int.test.ts`:
  ledger states/actions/months/orgs, archived and other-org media, upcoming/next, archived brands).
- `src/app/app/post-tile.tsx` (shared tile), dashboard `src/app/app/page.tsx`, `plan/feed-view.tsx` + `view=feed` in
  `plan/page.tsx`, design section, Instrument Serif Italic (OFL, self-hosted WOFF2) + `.accent-words`.
- Proof: `pnpm lint`, `typecheck`, `test` (245), `test:int` showcase (3), E2E plan + shell (desktop) green; screenshots
  `dashboard.png`, `feed.png` from the plan spec.
