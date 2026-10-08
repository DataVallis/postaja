# Postaja — Product Spec

Version 0.3 · 2026-10-06 · Owner: David Tacer (Data Vallis) · Host: `postaja.inzenirji.si`
Status of everything in this file: **Planned** unless marked otherwise.
ADRs in `03-DECISIONS.md` override this file.

---

## 1. What Postaja is

Postaja is a multi-brand AI content studio. **It creates posts and ads from the brand's CGP and the materials
the owner delivers** (ADR-035). The owner provides each brand's **CGP** (instructions, voice, rules, visual
identity) and uploads **materials** (logo, fonts, documents, images, ZIPs); Postaja does **not** write or
propose the CGP. The owner imports a content plan or lets AI
propose one, generates ready-to-post content (text, single images, carousels, animations, video, ads in
every required size) in one click, downloads it, publishes manually and sees what is done today.
It never repeats a topic.

**First customer:** Data Vallis (David), plan `comped`. Brands at start:

| Brand | Channel(s) | Main post types |
|---|---|---|
| davidtacer.com | LinkedIn (personal, "davitacer") | text, single image, carousel (PDF) |
| inzenirji.si | Instagram | single image, carousel |
| aibuilders.si | Instagram | single image, carousel |
| cherr.io | X | text, thread, single image |
| AI influencer (persona) | Instagram / TikTok | single image, video |

**Later customers:** solo founders and small agencies running several brands.

**Non-goals for v1:** direct publishing or scheduling to networks, post-performance analytics,
public self-serve signup and payments, team workflows beyond basic roles.

---

## 2. Users and roles

| Role | Scope | Can |
|---|---|---|
| Super admin | Platform (flag on the user, not an org role) | Everything in `/admin`: orgs, plans, caps, usage, model registry |
| Org owner | One organization | Members, brands, settings, (phase 2) own API keys |
| Org editor | One organization | Brands' content: plans, generation, review, export |

- A user can belong to several organizations and switches the active one.
- Data Vallis is an ordinary organization with plan `comped`. David is its owner **and** a super admin.

---

## 3. Core concepts

- **Organization** — tenant. All data belongs to exactly one organization.
- **Brand** (a "project" in Postaja) — CGP, rules, pillars, visual identity, channels, optional persona.
- **Channel** — brand × platform (`instagram`, `linkedin`, `x`, `tiktok`, `facebook`) with format rules and a posting goal.
- **Persona** — AI influencer: DNA + passport images (+ optional LoRA) so the same person appears every time.
- **Plan item** — a planned post: date, channel, type, topic, prompt, text. Source: `import`, `ai`, `manual`.
- **Post** — generated content and its assets, with a lifecycle status.
- **Brand source** — any uploaded file or link about a brand (PDF, DOCX, XLSX/CSV, PPTX, MD/TXT, images, URL). Raw material for the CGP.
- **Post types** — `text` (incl. X thread), `single_image`, `carousel`, `animation`, `video`, `ad` (§5).
- **Format preset** — a named output size for a platform placement (e.g. `ig_story` 1080×1920, safe zones). Data, not code (§5.9).

---

## 4. Brand profile (the brand's CGP)

The CGP is **delivered by the owner** (ADR-035, supersedes ADR-018): written or pasted into the profile
editor (the template `templates/BRAND-CGP-TEMPLATE.md` is a guide). Postaja does not generate, propose or merge
the CGP. The structured profile below is what the owner maintains and what every generation uses.

### 4.1 Brand materials ("upload anything") — inputs for generation

Materials are what Postaja creates **from**, next to the CGP. They are never turned into a CGP.

1. **Upload** to a brand: one drop zone for documents (PDF, DOCX, XLSX/CSV, PPTX, MD/TXT), images, fonts
   (TTF/OTF/WOFF/WOFF2) and whole ZIPs; files are sorted into logos, fonts and sources (ADR-033, ADR-034). **Live on dev.**
2. **Used in generation:**
   - Logo and fonts → rendering of single images, carousels and ads (fonts must cover the brand's language, §13).
   - Images (product photos, past posts, moodboards) → references for image generation and for the visual style.
   - Documents (price lists, product catalogues, FAQs, course syllabus, campaign briefs) → facts the LLM may use
     in a post. Their text is extracted once; long material is chunked and the relevant parts are retrieved per post
     instead of stuffing everything into the prompt (phase 2: embeddings, ADR-008).
   - Spreadsheets that look like a **content plan** (dates + topics/prompts) are offered for plan import (§6.1).
3. Uploaded content is **data, not instructions**: text inside a material that tries to instruct the AI
   (e.g. "ignore previous rules") is never executed; prompts quote materials as data.
4. The CGP always wins over a material when they disagree (e.g. a tone or colour in an old brochure).

| Field | Notes |
|---|---|
| Name, slug, website | |
| Output language(s) | e.g. `sl`, `en`; per channel override |
| CGP | Free-form markdown: who we are, audience, offer, voice, do / don't. Injected into every generation. |
| Rules | List of hard rules. Each: text + optional machine check (`banned_words`, `regex_must`, `regex_must_not`, `max_chars`, `max_hashtags`, `must_end_with_cta`). Machine checks run after generation. |
| Content pillars | Themes with target share (%). Used to balance AI suggestions. |
| Examples | Up to 10 reference posts (text + optional image) used as few-shot examples. |
| Visual style | Image style prompt (prefix/suffix), negative prompt, default image model, colors (hex tokens), fonts (TTF/OTF upload), logo, carousel template. |
| Channels | Platform, handle, goal (posts per day / which weekdays), format rules (max chars, hashtags, links), allowed post types, default aspect ratio. |
| Persona | Optional link to a persona (§5.5). |

**Versioning:** every save of CGP/rules creates a new version. Every post stores the version it was generated with.

---

### 4.2 Platform rules apply to every output

Every output — a plain caption, single image, carousel, thread, animation, video or ad — passes the same
**three rule layers**, most strict wins:

1. **Platform rules** (global data, super admin keeps current): image/video dimensions (format presets §5.9),
   caption max characters, characters before "…more" truncation, max hashtags, max mentions, link behaviour
   (clickable or not), thread part limit, carousel slide count, video duration and file size.
2. **Channel rules** (per brand channel): e.g. "max 5 hashtags", "no links in caption", "always 4:5".
3. **Brand rules** (CGP §4): banned words, CTA, emoji count, etc.

- Limits are passed to the LLM in the prompt **and** machine-checked after generation; a violation triggers
  one automatic fix, otherwise `needs_review` with the exact rule shown ("caption 2.412 / 2.200 chars").
- Character counting matches the platform (X counts URLs as 23 and some emoji as 2; others count Unicode graphemes).
- The editor shows live counters (chars, hashtags, chars before truncation) while the owner edits.
- A post cannot be marked `ready` or downloaded as "ready" while a hard rule fails (owner may override with a reason, logged).
- Seed values (verify against current platform docs in the seeding task; platforms change these):

| Platform | Caption max | Visible before "more" | Hashtags max | Notes |
|---|---|---|---|---|
| Instagram | 2.200 | ~125 | platform limit (verify — recently reduced) | links not clickable; carousel up to 20 |
| LinkedIn | 3.000 | ~210 | no hard limit; default channel rule 3–5 | first comment for links optional |
| X | 280 (non-premium), longer for premium accounts — per channel setting | — | default 1–2 | URL = 23 chars |
| Facebook | 63.206 | ~125 | default 3 | |
| TikTok | 4.000 | ~100 | default 3–5 | |

### 4.3 Competitor research

Goal: see what competitors do, learn what works, and decide explicitly what we adopt and what we reject.

1. **Find** — per brand, "Find competitors": AI uses web search (Claude API web search tool) with the CGP
   (offer, audience, market, language, country) and proposes 5–10 competitors with website and public
   social profiles, and why each is a competitor. Owner keeps, removes or adds their own (URL / handle).
2. **Collect** (only public, ToS-respecting sources):
   - websites, blogs, landing pages (web fetch);
   - public ads from the **Meta Ad Library** (API, EU ads are covered) and the LinkedIn / Google ads transparency pages where accessible;
   - public social profile pages only as far as they are reachable without login;
   - **owner uploads**: screenshots, exported posts, PDFs of competitor carousels — read with vision. This is the reliable path for Instagram/LinkedIn feeds.
   Postaja never logs into networks as the user and never scrapes behind login.
3. **Analyze** per competitor and overall: positioning, content pillars and their mix, post types and formats,
   posting frequency (where visible), hook patterns, CTA patterns, visual style (colors, layouts, faces vs graphics),
   tone, offers in ads, what seems to get engagement (only where public numbers exist — marked as such).
4. **Learnings** — AI produces two lists with reasons and evidence (links/screenshots):
   - **Adopt**: patterns that fit our CGP (e.g. "numbered carousel hooks", "client result in slide 1").
   - **Reject**: patterns that conflict with our CGP or are weak (e.g. "clickbait hooks", "stock photos").
   Owner ticks each item. Accepted "adopt" items become a **CGP proposal** (ADR-018 flow: review → accept → new version);
   "reject" items become brand rules ("do not …").
5. **Gaps and ideas** — topics competitors cover that we don't (and vice versa) → "suggest ideas from gaps" feeds §6.2.
6. **No copying** — competitor posts collected are embedded; our generated posts are checked against them
   (similarity ≥ 0.85 → warn "too close to <competitor post>"). Learnings are patterns, never reproduced text or images.
7. **Refresh** — on demand or monthly (owner setting); report shows what changed since the last run.

## 5. Post types

### 5.1 Text
- LinkedIn post, X post, X thread (2–15 parts; per-part limit from channel rules, default 280).
- Output: text or parts, hashtags, optional first comment (LinkedIn).

### 5.2 Single image
- Caption + one image from the brand's image model on fal.ai.
- Optional headline overlay — **rendered by Postaja, never by the image model** (correct č, š, ž, exact brand fonts).
- Persona brands: the image shows the persona (§5.5).

### 5.3 Carousel
- Default **6 slides**; configurable 2–10 per brand (Instagram allows up to 20).
- Structure: hook slide → content slides → CTA slide.
- LLM returns JSON per slide: `headline`, `body`, `visual_prompt?`, `layout`.
- Visuals: none, one shared generated background, or one generated visual per slide (brand setting).
- Text is rendered by Postaja templates with brand fonts, colors and logo.
- Output: PNG per slide (default 1080×1350), **PDF** for LinkedIn document carousels, caption.
- Editing: change slide text → re-render only (no image cost); regenerate one slide's visual; reorder, add, remove slides.

### 5.4 Video (AI influencer)
- Phase 2. Vertical 9:16, 5–10 s clip in v1 of the feature.
- Pipeline: LLM writes script/caption → keyframe image of the persona (§5.5) → image-to-video model on fal → MP4.
- Later: voiceover (TTS) + lip-sync, several clips stitched, burned-in subtitles.
- Persona video is the `video` type (§5.7) with a persona attached.

### 5.5 Persona consistency (DNA + passport)
- **DNA** — structured description: age, face, hair, eyes, skin, body, signature outfits/style, personality, voice, do / don't. Template in `BRAND-CGP-TEMPLATE.md`.
- **Passport images** — 3–10 reference images (front, profile, expressions); one is marked primary.
- Generation uses a reference-capable model with the passport images as input plus the DNA block in the prompt.
- Optional LoRA trained on fal from the passport set; its URL is stored on the persona and used by compatible models.
- Model per persona from the model registry (§11).
- Phase 2+: face-similarity check against the primary passport image; warn under threshold.

### 5.6 Animation (animate an image)
- Any image Postaja made or the owner uploaded — single image, a carousel slide, an ad visual — gets an
  **"Animate"** action. Also selectable as a post type directly (generates the image first, then animates).
- Input: source image (**without** text overlay), motion prompt (LLM proposes one from the post + brand style;
  owner can edit), duration (default 5 s), target format preset (§5.9).
- Pipeline: image-to-video model on fal (from the model registry) → MP4 → text overlay / logo / subtitles
  **burned in by Postaja** with ffmpeg after generation (same rule as ADR-009: the model never draws text).
- If the source aspect ratio differs from the target preset, the image is first recomposed (§5.9) — never stretched.
- Output: MP4 (H.264, AAC silent track) + poster frame PNG + caption. Optional loop-friendly mode.
- Persona images keep identity: the passport primary image is passed as reference where the model supports it.

### 5.7 Video (posts)
- Short video posts for Reels / TikTok / Shorts / LinkedIn / X: 5–30 s.
- Modes: **text-to-video**, **image-to-video** (from a generated keyframe), **multi-shot** (LLM writes
  2–6 shots → each shot a clip → stitched with ffmpeg, cuts and optional transitions).
- LLM output: script, shot list (`visual_prompt`, `duration`, `on_screen_text`), caption, hashtags.
- On-screen text and subtitles burned in by Postaja; optional TTS voiceover and background music track
  (licensed library or owner-uploaded only) — phase 2+.
- Persona video (§5.4) = this type with a persona.

### 5.8 Ads (ad creatives)
- One **ad set** = one concept rendered for **every selected placement in its exact dimensions**
  (e.g. Meta feed 4:5 + Story/Reels 9:16 + square 1:1, LinkedIn single image, Google Display sizes).
- Owner picks platform(s) + objective (awareness / traffic / leads / sales) + offer, landing URL, CTA.
  Placements default from the platform; owner can tick/untick.
- LLM output per ad set: 3 copy variants, each with fields **per platform with their character limits**
  (e.g. Meta: primary text, headline, description, CTA button from the platform's allowed list;
  Google: short headlines, long headline, descriptions; LinkedIn: intro text, headline). Limits come from the
  preset/platform data and are machine-checked (§4 rules).
- Visuals: one key visual generated at the largest needed aspect, then **recomposed per placement** (§5.9);
  or generated natively per aspect (brand setting). Text, logo and CTA button rendered by Postaja templates
  designed per aspect, respecting **safe zones**.
- Variants: up to 3 visuals × 3 copies; export names `<brand>_<adset>_<placement>_<variant>.png|mp4`.
- Animated ads: any ad visual → Animate (§5.6) in 9:16 / 1:1 / 4:5.
- Ads count in no-repeat memory per brand like posts, but are tracked under "Ads", not the daily goal.
- Postaja does **not** upload to ad managers in v1 (ADR-014); export ZIP per ad set with a `copy.csv`
  (one row per placement × variant) ready for bulk upload.

### 5.9 Formats, dimensions and safe zones
- **Format presets are data** (table `format_presets`, editable by super admin) — platforms change specs.
  Each preset: key, platform, placement, width × height, aspect, max file size, allowed media (image/video),
  video duration range, **safe zone** insets (px from top/bottom/left/right where UI covers the creative),
  text guidelines (max text share, char limits for copy fields).
- Every generation targets a preset; the output is validated against it (exact pixel size, file size, duration).
  Wrong size never reaches "ready".
- **Recompose** to a different aspect: smart crop around the subject (saliency) if no important content is
  lost, otherwise **outpaint** with a fal model; never stretch, never letterbox unless the owner chooses it.
- Templates for overlays (single image, carousel, ad, animation) are defined per aspect family
  (9:16, 4:5, 1:1, 1.91:1 / 16:9, banner) and place text only inside the safe zone.
- Preview shows the platform UI overlay (Story bars, Reels buttons) so the owner sees what will be covered.
- Seed presets (to be verified against current platform docs in the seeding task, then kept current by the super admin):

| Platform | Placement | Size | Notes |
|---|---|---|---|
| Instagram | Feed portrait | 1080×1350 (4:5) | default for posts and carousels |
| Instagram | Feed square | 1080×1080 (1:1) | |
| Instagram | Story / Reels | 1080×1920 (9:16) | safe zone: keep text out of top ~250 px and bottom ~340 px |
| Facebook / Meta ads | Feed | 1080×1350 (4:5), 1080×1080 (1:1) | |
| Meta ads | Stories / Reels | 1080×1920 (9:16) | same safe zones as IG Story |
| Meta ads | Link / right column | 1200×628 (1.91:1) | |
| LinkedIn | Feed image | 1200×1500 (4:5), 1080×1080 (1:1), 1200×627 (1.91:1) | |
| LinkedIn | Document carousel | 1080×1350 PDF pages | |
| LinkedIn ads | Single image | 1200×627, 1200×1200 | |
| X | Image | 1600×900 (16:9), 1080×1080 (1:1) | |
| TikTok | Video | 1080×1920 (9:16) | large bottom/right UI area |
| YouTube | Shorts | 1080×1920 (9:16) | |
| Google Display | Responsive | 1200×628, 1200×1200, logo 1200×1200 | |
| Google Display | Fixed banners | 300×250, 336×280, 728×90, 300×600, 320×50, 160×600 | text-light layouts |

---

## 6. Content plan

### 6.1 Import CSV / XLSX
1. Upload file → 2. map columns (mapping remembered per brand) → 3. validation preview with per-row errors → 4. import.

Recognised columns: `date`, `channel`, `type`, `topic`, `prompt` (image prompt), `text` (ready caption),
`slide_1` … `slide_10` (or `slides` separated by `|`), `notes`. Unknown columns are ignored with a warning.

- Re-import: rows with the same `date + channel + topic` are skipped and reported.
- Row with full `text`: used verbatim (toggle "allow light edits" per import).
- Row with only `topic` / `prompt`: AI writes the rest.

### 6.2 AI suggestions
- "Suggest N ideas" for a brand, channel and date range.
- Input to the LLM: CGP, pillars with their recent distribution, topic summaries of the last 60 posts.
- Output: ideas `{title, angle, pillar, type}`. Ideas failing the no-repeat check (§8) are dropped and replaced (max 2 rounds).
- Accepted ideas become plan items.

### 6.3 Fill the gaps
- When a day in a channel's goal has no plan item, the dashboard offers "propose" for that slot (on demand, not in the background in v1).

---

## 7. Generation

- Start from a plan item, ad hoc ("New post": brand, channel, type, optional topic), or **"Generate today"**
  (all of today's plan items across brands that are not generated yet).
- Steps: **text** (LLM, JSON validated by schema) → **rule check** (machine rules; on failure one automatic fix attempt;
  still failing → `needs_review` with the failed rules shown) → **assets** (image / video jobs) → **render** (overlays, slides, PDF).
- Statuses: `draft → generating → ready | needs_review | failed → approved → published | skipped`.
- Failed provider calls retry twice with backoff, then `failed` with the error and a Retry button.
- Every step records its cost. An organization has a monthly **spend cap**; generation is refused with a clear message when it would be exceeded.

---

## 8. No-repeat memory

- For every post store: one-sentence topic summary (LLM), embedding of summary + caption, pillar.
- Before accepting an idea or a post: cosine similarity against the brand's posts in the last 180 days.
  - ≥ 0.90 → reject (AI ideas) / block with override (manual).
  - 0.82–0.90 → warn "similar to <post, date>".
  - Thresholds and window configurable per organization; defaults tuned after the first ~100 posts.
- Counts: `ready`, `approved`, `published`. Ignored: `skipped`, `failed`.
- Also applies to persona video scripts.

---

## 9. Review, export, publish tracking

- Post detail: platform-like preview (IG 4:5 / 1:1, LinkedIn, X), edit caption, regenerate parts, copy caption.
- Download: single file, or ZIP `<brand>_<date>_<channel>_<type>/` with `01.png…`, `carousel.pdf` (LinkedIn), `video.mp4`, `caption.txt`.
- Ad sets: ZIP with one folder per placement + `copy.csv` (§5.8).
- "Download everything ready for today" (one ZIP, folder per post).
- "Mark published" (optional post URL; timestamp automatic) or "Skip".

---

## 10. Dashboard

- **Today:** brand × channel → goal, ready, published, missing; one-click "generate missing".
- **Week:** calendar grid brand × day with status dots.
- **Streak** per brand (consecutive days meeting the goal).
- **Costs** this month: total and per brand.

---

## 11. Super admin (`/admin`)

- Organizations: list, create, edit, suspend / reactivate; plan (`trial`, `starter`, `pro`, `comped`), spend cap, limits (brands, members, generations per month).
- Members: users per organization; invite an owner.
- Usage: cost per organization per month by provider and model; generation counts; failure rates.
- Model registry: enabled fal models with kind (`image`, `image_ref`, `video`, `lora_train`), unit price (micro-USD), default params.
- Audit log of every super-admin action.
- Impersonation: phase 3, audited, read-only first.

---

## 12. Plans and billing

- v1: no payments. Plans are set by the super admin. `comped` = never charged, limits as configured.
- Phase 2: BYOK — an organization may use its own fal / LLM keys (encrypted at rest).
- Phase 3 (proposed in `docs/business/BUSINESS-PLAN.sl.md` §4, owner to confirm): plans **Solo** (39 €/month, 2 brands,
  1 member, 400 credits), **Studio** (99 €, 6 brands, 3 members, 1.500 credits, + ads, animation, competitor research),
  **Agencija** (249 €, 20 brands, 10 members, 5.000 credits, + 1 persona), **Partner** (custom). No free plan; agency pilot
  99 € / 30 days; 7-day trial for Solo. AI use is counted in **credits** (per-action price table as data, TASK-038); the €
  spend cap stays as a hard safety limit. Add-ons: credit packs, extra brand, extra member, persona.
- Billing provider: Merchant of Record (Paddle / Lemon Squeezy) or Stripe — owner decision. Self-serve signup, trial,
  lifecycle e-mail events, referrals, client approval links: TASK-035…045.

---

## 13. Languages

- UI: Slovenian and English.
- Content: per brand / channel language.
- Slovenian diacritics must render in every overlay. Font upload checks glyph coverage for `č š ž ć đ Č Š Ž Ć Đ` and rejects fonts that lack them.

---

## 14. Roadmap

| Phase | Content |
|---|---|
| 0 | Scaffold, CI, Kamal deploy of an empty app to dev (`postaja.inzenirji.si` dev host) |
| 1 — MVP for David | Auth, orgs, super admin basics, brand materials upload (done) + owner-provided CGP with versioning, rules, channels, **format presets**, text + single image + carousel (PNG + PDF), CSV/XLSX import, AI suggestions, no-repeat, dashboard, export, cost tracking and caps |
| 1b | **Ads** (static, multi-placement, copy variants, `copy.csv`), **Animation** of images (§5.6), **competitor research** (§4.3) |
| 2 | **Video posts** (§5.7), personas (DNA + passport, LoRA), persona video, brand knowledge retrieval, BYOK, consistency check |
| 3 — selling | Production + own domain + landing, billing (plans, credits, add-ons), self-serve signup + trial, lifecycle e-mail events, demo from URL, client approval links, referrals + business metrics, direct publishing / scheduling where platform APIs allow, AI labels (TASK-035…045; business plan `docs/business/BUSINESS-PLAN.sl.md`) |

---

## 15. MVP acceptance (phase 1)

- Each of David's brands is configured with his own CGP and materials (logo, fonts, documents) in under 20 minutes per brand.
- Every output's pixel size matches its format preset exactly (automated check).
- No output marked `ready` violates a platform, channel or brand rule (chars, hashtags, dimensions) without a logged override.
- David's four brands are configured; on a normal day he generates, reviews, downloads and marks as published all channels in **under 15 minutes**.
- A 30-day imported plan generates without manual fixes in **≥ 80 %** of posts.
- No two posts of the same brand above the repeat threshold within 30 days.
- A user of organization B cannot read, change or delete organization A's data (integration-tested, data verified).
- Diacritics correct on every rendered slide.

---

## 16. Open questions

- Embedding provider (ADR-008, Open).
- Default image, image-to-video, text-to-video and outpaint models — chosen after a test round per brand.
- Music for video posts: which licensed library (or owner uploads only).
- Exact current platform specs, caption limits, hashtag limits and safe zones — verified in the seeding task.
- Competitor engagement data: only public numbers; whether to add a paid social-data provider later.
- Paid plan pricing.
