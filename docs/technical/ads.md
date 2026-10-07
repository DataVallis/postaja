# Ads (ad sets)

Status: **Built** (TASK-021a: copy per network, checks, copy.csv; TASK-021b: creatives per placement, ZIP).
Decisions: ADR-049, ADR-050. Spec §5.8, §5.9.

## What the owner does
Brand → **Oglasi** → "Nov oglas": objective (prepoznavnost / obiski / kontakti / prodaja), landing page, offer, instructions,
networks (Meta, LinkedIn, Google Display) and their placements (ticked by default), optional name, language when the
brand has several. "Ustvari oglas" → Claude writes **3 copy variants**, each complete for every chosen network, in that
network's fields. The ad set page shows every field with its character count (limit and visible length), the issues per
field, the CTA button per network; **Shrani besedila** checks again (pripravljen / za pregled); **Napiši znova** asks
Claude for new copy; **Prenesi copy.csv** — one row per network × placement × variant (`;`, UTF-8 BOM for Excel).

**Kreative** (on the ad set page, once the copy exists and the brand has a visual identity): *Ustvari slike* (shows
"~N AI ilustracij · največ X €" first) → in the background Claude picks per copy variant a brand template, the few words on
the image (a short hook, label, CTA text) and the illustration subject; fal draws **one square illustration per
illustrated variant** (style reference = the brand's past posts); Postaja renders **every chosen placement in its exact
size** (Meta 4:5 / 1:1 / Story 9:16, LinkedIn 1.91:1 / 1:1, Google 1.91:1 / 1:1). Text and logo stay inside the
preset's **safe zone** (Story: top 270 px, bottom 672 px, sides 65 px are UI). *Tekst na slikah* edits the words per
variant and redraws all placements on the same illustrations for free. *Prenesi ZIP*: `copy.csv` (now with
`image_file` per row) + a folder per placement with `<brand>_<adset>_<placement>_v<n>.png`.

## How
- `ad_networks` (migration 0021/0022): per network the fields (`key`, count min–max, `maxChars` hard limit,
  `recommended` visible length), CTA buttons, offered placements (format preset keys); sourced and dated like platform
  rules (ADR-030). Seed: Meta primary text 2,200 (125 visible), headline 40 (27), description 30 (27), 12 CTAs; LinkedIn
  intro 600 (150), headline 200 (70), 9 CTAs; Google responsive display 1–5 headlines × 30, long headline 90, 1–5
  descriptions × 90, business name 25. Placements: Meta 4:5, 1:1, 9:16; LinkedIn 1.91:1, 1:1; Google 1.91:1, 1:1
  (fixed Google banners later).
- `ad_sets`: brand, objective, networks, placements, offer, landing URL (http(s) only, https added), brief, language,
  status, `copy` (variants → network → field → text or list), `issues`, model, error.
- `src/server/ads/ai.ts`: one Claude call (tool `submit_ad_copy`, limits written into the JSON schema: maxLength,
  maxItems, CTA enum), CGP + offer + brief + the brand's 30 latest post topics. Facts only from CGP/offer/brief.
- `src/server/ads/check.ts`: grapheme count (č, emoji = 1) per field, counts, banned words (brand rules), CTA from the
  network's list; `long_visible` is a warning only. Generation: one automatic fix round with the exact issues, then
  `needs_review` if still broken. Spend cap via `cappedCall`; failures are stored on the ad set (`SPEND_CAP`,
  `AI_FAILED:…`) with "Poskusi znova".
- Any member creates and edits (the cap guards cost); tenancy via `forOrg`.
- Creatives (`src/server/ads/creatives.ts`): queue `ad-image` (pg-boss, 1 retry, 15 min), claimed via
  `ad_sets.media_status` (one run at a time, stale after 10 min), the worker acts as the member who asked (re-verified).
  `adVisualRequest` (tool `plan_ad_visuals`, one visual per copy variant, brand templates only, one retry with the zod
  errors). Illustrations: `generateIllustration` booked on the brand (post id null), cropped into each template's box.
  `renderTemplate(..., { safe })`: the background fills the canvas, every element is laid out in the box inside the
  insets (sizes in % of that box). Rows in `ad_media` (illustration per variant; creative per placement × variant), S3
  `org/<org>/ads/<id>/…`, served by `/api/ad-media/[id]` (302 to a presigned URL) and `/api/ads/[id]/zip` (streamed).

## Tests
`src/server/ads/check.test.ts` (limits, graphemes, counts, banned words, CTA, warnings, tool schema),
`ads.int.test.ts` (seeded networks, prompt inputs, fix round, needs review, provider failure + retry, spend cap,
refusals, save re-check, copy.csv rows, other org), E2E `tests/e2e/ads.spec.ts` (create → copy → over-long headline
caught → fixed → copy.csv → brand design → creatives per placement → words redrawn without fal → ZIP; axe).
Creatives: `ads.int.test.ts` (plan inputs, illustrations only where the template has one, exact sizes incl. 9:16,
costs booked on the brand, copy.csv image files, ZIP layout, free word redraw keeps illustrations and deletes old
creatives, other org refused), `design/render-safe.test.ts` (pixels: nothing under a Story's UI, background full).
