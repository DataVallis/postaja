# Platform rules, formats and the rule engine

Status: **Live on dev** (TASK-004, PR #9). Used by generation and the editor from TASK-005+.

## Data (global, not tenant-scoped)
| Table | Key | Content |
|---|---|---|
| `platform_rules` | `platform` | counting (graphemes / x_weighted), caption max, visible chars before "more", hashtags/mentions max, clickable links, thread part/parts max, slides min/max |
| `format_presets` | `key` (e.g. `ig_feed_portrait`) | platform, placement, width × height, media (image/video/pdf), max bytes, video duration range, safe zone `{top,right,bottom,left}` px, enabled |

Every row has `source`, `confidence`, `notes`, `verified_at` (ADR-030). Seed: `drizzle/0005_seed_platform_data.sql` (idempotent, never overwrites edits). View: `/admin/platform` (read-only; editing = TASK-004b).

## Engine — `src/lib/rules` (pure TypeScript, server + browser)
- `measure(text, counting)`: graphemes (č = 1, 👍🏽 = 1) or X weighted (URL = 23, emoji = 2, CJK = 2).
- `hashtags / mentions / urls / emojiCount` (Unicode-aware; `#čebelarstvo` counts, `a#b` and URL fragments do not; emails are not mentions).
- `effectiveRules(platform, channel?, brand?)`: most strict wins — numeric maxima take the minimum, `slidesMin` the maximum, `linksAllowed:false` wins, banned words / regexes are unioned, `counting` cannot be overridden.
- `checkText` → violations (`caption_too_long`, `too_many_hashtags`, `links_not_allowed`, `banned_word`, `regex_must(_not)`, `missing_cta`, …) + warnings (`truncated_preview`). Each violation carries `actual` and `limit` for the UI ("2.412 / 2.200").
- `checkThread`, `checkCarousel`, `checkAsset` (exact pixel size, media, bytes, duration), `safeArea` / `insideSafeArea`.
- DB access: `src/server/rules/repo.ts` (`getPlatformRuleSet`, `getPreset` — disabled/unknown presets throw).

## Seeded values worth knowing (2026-10-05)
| Platform | Caption | Hashtags | Slides | Note |
|---|---|---|---|---|
| Instagram | 2,200 (125 visible) | **5** | 2–10 | links not clickable; 9:16 safe zone 270/65/672/65 px |
| LinkedIn | 3,000 (210 visible) | — | 2–300 (PDF) | |
| X | 280 weighted | — | 2–4 images | threads ≤ 25 parts (Postaja limit) |
| TikTok | 2,200 | — | 2–35 | safe zone low confidence |
| Facebook | 63,206 | — | 2–10 | |

## Tests
Unit (`src/lib/rules/*.test.ts`): exact boundaries (limit / ±1), diacritics, emoji/ZWJ, URLs, layer merging, safe area edges.
Integration (`src/server/rules/repo.int.test.ts`): seed complete and sourced, idempotent without overwriting edits, CHECK constraints, DB rules through the engine.
