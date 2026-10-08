# Tasks

Status: Planned · In progress · PARTIAL (waits for owner step) · Done (merged) · Live on dev

| Task | Title | Depends on | Status |
|---|---|---|---|
| TASK-001 | Scaffold: Next.js app, tooling, DB, health, Docker, CI, Kamal config | — | Done (PR #1) |
| TASK-002 | First deploy to dev (`dev-postaja.inzenirji.si`) — server check, DNS, secrets, deploy workflow on | TASK-001 | PARTIAL — live on dev; owner checks + rollback drill open |
| TASK-003a | Magic-link sign-in, SMTP, superadmin bootstrap | TASK-002 | Live on dev (PR #6) |
| TASK-003b | Organizations, `org_settings`, `forOrg`, cross-tenant harness, invitations | TASK-003a | Live on dev (PR #7) |
| TASK-003c | Super admin `/admin` basics + audit log; create Data Vallis (comped) there | TASK-003b | Live on dev (PR #8) |
| TASK-004 | Platform rules + format presets (tables, sourced seed, rule engine with boundary tests, admin view) | TASK-003 | Live on dev (PR #9) |
| TASK-004b | Super admin edits platform rules / presets (audited) + quarterly re-verification reminder | TASK-004 | Done (PR #13) |
| TASK-005a | Brands, profile versions, channels, effective rules (no uploads) | TASK-004 | Live on dev (PR #10) |
| TASK-005b | S3 storage + uploads: logo, fonts (diacritics check), brand sources; strict per-org separation | TASK-005a | Done (PR #14, #15; deployed) |
| TASK-005c | Smart uploads: drop zone, auto-sorting, ZIP, WOFF/WOFF2, language fixes (owner feedback 2026-10-06) | TASK-005b | Done (PR #16, deployed) |
| TASK-006 | ~~Brand ingestion: extract + synthesize CGP proposal + review/accept~~ | — | **Dropped** (ADR-035: owner provides the CGP) |
| TASK-007 | Post generation core: CGP + materials + effective rules → text (Claude, JSON schema) → rule check → one auto-fix → `needs_review`; cost recorded | TASK-005c, owner `ANTHROPIC_API_KEY` (set 2026-10-06) | Done (PR #18, deployed) |
| TASK-008 | CGP from a document: upload DOCX/PDF/MD/TXT → text copied verbatim into the CGP editor, owner saves a version | TASK-005c | Done (PR #19, deployed) |
| TASK-009 | Knowledge base: PDF/DOCX/XLSX/PPTX/TXT/CSV text read at upload into `brand_sources.extract`; per post the passages matching the brief (BM25) | TASK-008 | Done |
| TASK-010a | Claude → Postaja over MCP: OAuth 2.1 (DCR, PKCE, consent), `/api/mcp` with `list_brands`, `get_brand`, `propose_cgp` (draft), `add_material`; `/app/connect` | TASK-008 | Live on dev (PR #20; owner tried it) |
| TASK-011 | App frame: sidebar + top bar, dark/light theme, UI kit, dashboard, all-posts table with filters, brands table, brand tabs (ADR-040) | — | Done (PR #22, deployed; owner: "super je") |
| TASK-012 | **Plan import**: upload any content plan (XLSX/CSV/DOCX, any columns or sections, relative dates) → AI maps it to planned posts (date/time, platform, channel, format, topic, text, slides, image prompt, overlay text, hashtags, CTA, status); owner reviews the mapping before saving; already published rows go to history | TASK-011 | Done (PR #23, deployed) |
| TASK-013 | **Plan and history**: planned posts with date/time per channel; table + calendar (week/month) across all brands; history of published posts | TASK-012 | Done (PR #24, deployed) |
| TASK-014 | **Bulk creation**: create all planned posts of one brand, or of every brand for a chosen day, in the background (pg-boss worker), progress + cost cap | TASK-013 | Done (PR #25, deployed) |
| TASK-015 | **Images**: AI background from the image prompt (fal.ai, `FAL_KEY` from owner) + brand templates for text/logo overlays (Satori) matching the owner's examples; carousels slide by slide | TASK-013 | Done (PR #27) |
| TASK-017 | **Brand visual identity by Claude**: per-brand design spec from CGP + description + past posts, revise in words, versions; per-post template/words/illustration by Claude; fal illustrations with style references (ADR-044) | TASK-015 | Done (PR #28) |
| TASK-016 | **One-click download**: a post (images + caption with hashtags) or a whole day as ZIP | TASK-015 | Done (PR #37) |
| TASK-018 | **LinkedIn carousel as PDF**: images of a LinkedIn post as one PDF document (download + in the ZIP) | TASK-016 | Done |
| TASK-019 | **AI post ideas + no-repeat**: "Predlagaj ideje" per brand channel, repeats of the last 180 days replaced, free slots from the channel goal, ticked ideas → planned posts (ADR-048) | TASK-013 | Done |
| TASK-020 | **Dashboard goals**: today per brand × channel against its goal (planned, ready, published, missing), streak per brand, spend per brand this month | TASK-013 | Done |
| TASK-021 | **Ads** (phase 1b): a) ad sets — copy per network (Meta, LinkedIn, Google Display) within limits from data, checks, copy.csv (ADR-049); b) creatives per placement from the brand design, ZIP per ad set | TASK-017 | Done (ADR-049, ADR-050) |
| TASK-022 | **Animation** (phase 1b): animate a post image — clean illustration → fal image-to-video → template burned on with ffmpeg; MP4 in downloads (ADR-051) | TASK-017 | Done; for posts replaced by TASK-023 |
| TASK-023 | **Animation by Claude**: motion spec per image (entrances, word-by-word, rules, illustration drift), drawn frame by frame by Postaja, MP4 (ADR-052); Kling 3.0 kept for persona video | TASK-022 | Done |
| TASK-024 | **Persona** (phase 2): brand tab — DNA framework by hand or filled by Claude from a description/imported DNA; passport pictures (first from the whole DNA, other angles with a reference model; uploads; primary) (ADR-053) | TASK-015 | Done |
| TASK-025 | **Persona video**: Claude writes the shot, first frame 9:16 from the passport (Nano Banana Pro edit), Kling 3.0 image-to-video 5/10 s, 1080×1920 MP4, cost preview (ADR-055) | TASK-024 | Done |
| TASK-026 | **User guide**: customer guide in Slovenian (9 chapters) in `docs/guides/user/sl`, shown in the app under Pomoč; kept current in every PR (ADR-056) | — | Done |
| TASK-027 | **Persona in post images**: illustrations of persona brands show the persona (reference model from the passport); owner toggle; bulk estimate (ADR-057) | TASK-024 | Done |
| TASK-028 | **Team and plan limits**: owners invite/cancel/change role/remove members (Ekipa in paket, audited, last owner kept); limits for brands, members, AI generations per month set in /admin and enforced (ADR-058) | TASK-003b | Done |
| TASK-029 | **No-repeat for posts + published URL**: written posts checked against the brand's posts of the window (warning; close repeats need review, approve = override); "Označi kot objavljeno" with the post's link (ADR-059) | TASK-019 | Done |
| TASK-030 | **Production backups**: nightly `pg_dump` (+ S3 objects) of **production only** to `postaja-backup` (fsn1.your-objectstorage.com), retention, restore drill; owner sets the keys | prod env | Planned (needs prod) |
| TASK-031 | **Persona optional per post**: "S persono" checkbox on the images form, stored per post; the Persona tab sets the default (ADR-060) | TASK-027 | Done |
| TASK-032 | **Keep every video**: animations and persona videos accumulate per post (`post_videos`), delete on purpose, all in the ZIP; images no longer remove videos (ADR-061) | TASK-023, TASK-025 | Done |
| TASK-010b | ~~MCP post tools~~ → **Files from Claude** into the brand (logo, past-post images, PDFs, fonts, ZIP) by URL or base64, upload link for the rest, brand created when missing (ADR-046) | TASK-010a | Done |

Order and scope beyond TASK-003 may change; the next free numbers are always checked here first.
