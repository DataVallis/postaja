# Post images and brand designs (TASK-015, TASK-017; ADR-043, ADR-044)

Every brand has its **own** visual system, designed by Claude inside Postaja. Nothing is shared between brands or
clients; Postaja only renders what the design says.

## Brand design (`src/server/design/`)
- **Spec** (`spec.ts`, zod): `summary` (the common thread), `illustrationStyle`, `palette` (background, surface, text,
  muted, accent, accent2), `typography` (heading/body: `sans` Inter, `grotesk` Space Grotesk, `serif` Playfair Display,
  `mono` JetBrains Mono, or `brand` = the uploaded font), `templates` (2–8). A template has a background (colour,
  gradient or full-bleed illustration with overlay) and elements positioned in percent of the canvas:
  `text` (a slot — headline, subhead, label, body, cta, number, footer — or static text; size range in % of width,
  emphasis colour for `*words*`, chip fill), `shape`, `image` (logo or illustration). Data only, never code.
- **Making it** (`service.ts`, `ai.ts`): owner clicks *Ustvari vizualno podobo* → `brand_designs` row `generating`
  → queue `brand-design` → worker gives Claude the CGP, description, colours, logo and up to 6 past-post images (brand
  sources of kind image) → validated (one retry with the errors) and test-rendered → `ready`, becomes
  `brands.current_design_id`. Failures: `SPEND_CAP`, `INVALID_OUTPUT`, `NO_ACCESS`, provider codes.
- **Revising**: *Popravi* with the owner's words; Claude also sees the current templates rendered. Every version stays;
  *Uporabi* switches back. One design job per brand at a time (`BUSY`, stale after 15 min).
- **Preview**: `/api/designs/[id]/preview?template=&shape=portrait|square|landscape` (members, PNG 540 px, stand-in
  illustration, brand logo and font).

## Post images (`src/server/images/service.ts`)
1. *Ustvari slike* (or a bulk run's `image` step — only brands with a design) claims `posts.media_status` and queues
   `post-image`.
2. The worker (as the member who asked) asks Claude (`plan_post_images`) for each image: template, slot words (the
   plan's text verbatim, `*emphasis*`) and the illustration subject → `posts.visual`.
3. Illustrations only for templates that show one: the brand's past posts (≤ 4) go as style references to the
   `image_style` model (Ideogram V3, $0.06/image); without examples the `image` model (FLUX1.1 pro, $0.04/MP). Prompt =
   subject + design illustration style + "no text". Reserved against the spend cap, settled per image.
4. Postaja renders each slide (`design/render.ts`: Satori → sharp PNG) at the channel's preset size; rows in
   `post_media` (`slide` PNGs, `background` = illustrations per slide position).
5. *Shrani in osveži*: edited words (`setSlideTexts`) re-render on the stored illustrations — no Claude, no fal.
6. *Popravi slike* (owner, 2026-10-07): a correction in words (≤ 1,000 chars, any member) → job mode `revise` with the
   instruction. Claude gets the current plan (`<current_images>`), the current images (JPEG 540 px) and the request,
   and must keep everything it was not asked to change verbatim. An illustration is reused when its image keeps the
   same description and an illustration box of the same proportions; otherwise it is drawn again (paid). The request is
   kept as `posts.visual.revision` ("Zadnji popravek"). The image forms remount when the images change.

Downloads: `/api/post-media/[id]` (`?download=1` → `<brand>-<day>-<n>.png`).

## Notes
- Render speed: no `overflow:hidden` (Satori masks make librsvg ~10× slower); only the used font families are passed.
- `satori` is in `serverExternalPackages`; Docker and `scripts/start-standalone.sh` copy `assets/` (fonts).
- Config: `ANTHROPIC_API_KEY`, `FAL_KEY` (dev secrets); `FAL_BASE_URL` only for the E2E stand-in.

## Tests
`design/design.test.ts` (spec rules, fitting, emphasis, rendering at 3 shapes, fonts, prompts), `images/fal.test.ts`,
`design/design.int.test.ts` (Claude inputs, retry, versions, cap, post flow with style references, free word edits,
access, bulk, HTTP, corrections: words only reuse the illustration, a picture change redraws one, refusals), E2E `tests/e2e/images.spec.ts` (design, revision, versions, post images, word edits, corrections in words, bulk carousel).

## Versions (TASK-033, ADR-062)
Every run of `renderPostImages` creates a `post_image_runs` row (with the words it drew) and tags its new `post_media`
rows with `run_id`; the images it replaces get `archived_at` instead of being deleted (reused illustrations stay
current). Current = `archived_at is null` (one per post/kind/position, partial unique index) — every reader filters on
it. `listImageVersions`, `restoreImageVersion` (archives the current images, un-archives the run, restores its words),
`deleteImageVersion` (archived slides of the run + illustrations no other run draws on, + files). A run records the
illustrations it reused in `post_image_runs.kept` (TASK-034), so restoring a word redraw brings its illustration back. UI: "Prejšnje verzije slik" in `images-section.tsx`.

## Partner logos (TASK-046, ADR-064)
`RenderInput.partnerLogo` + `partnerName`. TASK-047: when a text element of the template says just the partner's name
(`partnerTextIndex`: optional "×", "&", "+", "with", "feat.", "s", "z", "in" before it; diacritics, case and `*` ignored), the
logo is drawn in that text's box instead (as large as fits, aligned like the text) and the brand logo stays alone.
Otherwise, in the template's logo box the brand logo and the partner's logo share the space (side by
side in a wide box, stacked in a tall one, a gap of a quarter of the short side; the partner alone when the brand has no
logo). A template without a logo box gets it in the bottom-right corner of the safe box. Post images, animations and ad
creatives pass the chosen logo (`partnerLogoBytes`). `setPostPartnerLogo` / `setAdPartnerLogo` save the choice; when
images exist they queue a free word redraw (`text` mode: same illustrations, a new version). Tests:
`design/render-partner.test.ts` (pixels), `design.int.test.ts`, `ads.int.test.ts`, `files-http.int.test.ts`, E2E
`images.spec.ts`.

## AI disclosure (TASK-045, ADR-067)
`src/server/images/ai-label.ts`. A background drawn with the persona gets `post_media.ai_person`; so does every slide
drawn on such a background (also when a word redraw reuses it). Those slides are re-encoded with XMP IPTC
`DigitalSourceType = compositeWithTrainedAlgorithmicMedia` (`markAiPng`). Persona videos (`composeVideo`) and
animations of such a slide (`encodeFrames`) get `comment`/`description` metadata. `aiPersonPosts` (download service)
= current AI-person slides or persona videos; exports append `aiDisclosure(language)` to `besedilo.txt` and mark the
day's `pregled.csv` ("Oznaka AI"); the post page shows how to switch on the platform's label. Migration 0040 flags
existing persona illustrations (made by the `image_ref` / `image_persona` models) and their slides.

## Image words and the plan's image prompt (TASK-052, ADR-068)
`postVisualRequest` asks for a short hook that complements the caption (never its sentences, steps or lists) and, when
the plan has `imagePrompt`, an illustrated first image. `planVisual` then: puts the plan's image prompt on the first
illustrated slide as written (`verbatim: true` → `generateIllustration` gets it unchanged, no brand style), and checks
`repeatsCaption` (`src/server/images/repeat.ts`) for every slide unless the plan gives the image words itself
(`overlayText`, `slides`); a repeat or a missing illustration sends Claude one correction round. Corrections in words
(revise) keep Claude's descriptions.

