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

Downloads: `/api/post-media/[id]` (`?download=1` → `<brand>-<day>-<n>.png`).

## Notes
- Render speed: no `overflow:hidden` (Satori masks make librsvg ~10× slower); only the used font families are passed.
- `satori` is in `serverExternalPackages`; Docker and `scripts/start-standalone.sh` copy `assets/` (fonts).
- Config: `ANTHROPIC_API_KEY`, `FAL_KEY` (dev secrets); `FAL_BASE_URL` only for the E2E stand-in.

## Tests
`design/design.test.ts` (spec rules, fitting, emphasis, rendering at 3 shapes, fonts, prompts), `images/fal.test.ts`,
`design/design.int.test.ts` (Claude inputs, retry, versions, cap, post flow with style references, free word edits,
access, bulk, HTTP), E2E `tests/e2e/images.spec.ts` (design, revision, versions, post images, word edits, bulk carousel).
