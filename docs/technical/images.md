# Post images (TASK-015, ADR-043)

## Flow
1. A member clicks **Ustvari slike** on a post (or a bulk run has the `image` step). `requestImages` claims the post
   (`posts.media_status` none/ready/failed → `queued`; stale `queued/rendering` after 10 min may be claimed again) and
   queues `post-image` `{ postId, mode }` (singleton `post:<id>:image`).
2. The worker (`RUN_WORKER=1`) claims `queued → rendering`, re-resolves the requester's org context, and runs
   `renderPostImages`:
   - template + colours from the brand's current profile (`visual.template`, `visual.colors`; defaults otherwise);
   - size from the channel's image preset, else the platform's feed default (IG/FB/LinkedIn 1080×1350, X 1600×900, …);
   - background (template `background: "ai"`): mode `text` reuses the stored background; otherwise fal.ai with the
     plan's image prompt + brand image style + "no text"; ≤ 1 MP (`generationSize`), reserved against the spend cap,
     settled with the billed megapixels;
   - texts: carousel → `plan.slides` (one image each, label on the first); else `overlayText` → `topic` → brief;
   - Satori renders each slide (brand font first, else Inter / JetBrains Mono), sharp writes PNG;
   - new objects are written, then rows swapped in one transaction, then the replaced objects deleted.
3. Expected failures (`NO_IMAGE_KEY`, `IMAGE_*`, `SPEND_CAP`, `NO_ACCESS`) are stored on the post
   (`media_status=failed`, `media_error`); anything else is retried once by pg-boss.

## Pieces
- `src/server/images/template.ts` — pure Satori tree (card / center / photo), `headlineLines`, `fitSize`, `onColor`.
- `src/server/images/render.ts` — fonts (`assets/fonts`, `FONT_DIR` override), logo/background fitting, PNG output.
- `src/server/images/fal.ts` — queue API client; result URLs only from fal hosts (or `FAL_BASE_URL` origin);
  downloaded bytes are decoded and re-encoded by sharp.
- `src/server/images/service.ts` — request, render, list, presigned URLs, text on images.
- `src/server/images/http.ts` — `/api/post-media/[id]` (302 to a 5-min presigned URL; `?download=1` attachment
  named `<brand>-<day>-<n>.png`) and `/api/brands/[id]/image-preview` (PNG, unsaved values from the query, stand-in
  photo instead of the AI background, nothing stored).
- Brand page tab **Slike** (`template-form.tsx`): owner saves a new profile version (`note = image-template`); a
  later CGP save keeps the template.

## Config
`FAL_KEY` (secret: GitHub env `dev` → deploy workflow → `.kamal/secrets.dev` → `config/deploy.dev.yml`). Without it,
AI backgrounds fail with `NO_IMAGE_KEY`; brand-colour templates still work. `FAL_BASE_URL` only for the E2E stand-in.
`satori` is in `serverExternalPackages` (its WebAssembly must stay next to it in the standalone output); the Docker
image and `scripts/start-standalone.sh` copy `assets/`.

## Tests
Unit `images.test.ts` (helpers, rendering, glyph coverage, fal protocol with a fake fetch); integration
`images.int.test.ts` (claim/queue, storage, cost, text refresh, cap and provider errors, access, bulk, HTTP);
E2E `tests/e2e/images.spec.ts` (template preview, images for a planned post, download, text refresh, bulk carousel).
