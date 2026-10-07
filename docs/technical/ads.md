# Ads (ad sets)

Status: **Part A built** (TASK-021a: copy per network, checks, copy.csv). Part B (creatives per placement, ZIP) next.
Decision: ADR-049. Spec §5.8.

## What the owner does
Brand → **Oglasi** → "Nov oglas": objective (prepoznavnost / obiski / kontakti / prodaja), landing page, offer, instructions,
networks (Meta, LinkedIn, Google Display) and their placements (ticked by default), optional name, language when the
brand has several. "Ustvari oglas" → Claude writes **3 copy variants**, each complete for every chosen network, in that
network's fields. The ad set page shows every field with its character count (limit and visible length), the issues per
field, the CTA button per network; **Shrani besedila** checks again (pripravljen / za pregled); **Napiši znova** asks
Claude for new copy; **Prenesi copy.csv** — one row per network × placement × variant (`;`, UTF-8 BOM for Excel).

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

## Tests
`src/server/ads/check.test.ts` (limits, graphemes, counts, banned words, CTA, warnings, tool schema),
`ads.int.test.ts` (seeded networks, prompt inputs, fix round, needs review, provider failure + retry, spend cap,
refusals, save re-check, copy.csv rows, other org), E2E `tests/e2e/ads.spec.ts` (create → copy → over-long headline
caught → fixed → copy.csv; axe).
