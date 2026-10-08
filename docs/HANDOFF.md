# Handoff — state as of 2026-10-08

## Working mode
**Mode B (autonomous) — partially.** Owner granted push access to `DataVallis/postaja` on 2026-10-05
("tukaj pa maš git, sem ti dal dostop … začni").
- Agent may: create `feat/*`, `fix/*`, `docs/*` branches, push them, open PRs to `dev`.
- **Standing permission (2026-10-05, owner): agent merges PRs to `dev` itself when every check is green**
  ("grema po pravilu ti sam mergaj ko je zeleno"). Squash merge via REST API; then verify CI + Deploy for the merge SHA.
- Agent never: touches `uat`/`main`, servers, DNS, secrets, GitHub settings.
- Ask the owner only for: keys/secrets, accounts, server actions, product decisions, uat/prod, irreversible steps.

## Git and CI specifics
- Default branch is `dev` (set by owner 2026-10-05). `main` = production releases only.
- Branch protection is **not available** (private repo on the free GitHub plan). The green-only merge rule is enforced by the agent:
  before merging, check that every check run on the PR head SHA is `completed/success`.
- `gh pr create` (GraphQL) is blocked in agent sessions — create PRs with `gh api repos/DataVallis/postaja/pulls --input <json>`,
  merge with `gh api -X PUT repos/DataVallis/postaja/pulls/<n>/merge -f merge_method=squash`. Job logs are not readable from the sandbox;
  failing steps are visible via `gh api repos/.../actions/jobs/<id>` and annotations.
- Bootstrap exception: the repo was empty; the first docs commit was pushed directly to `main` and `dev` was created from it.
  From now on everything goes through PRs.
- Waiting for CI: one polling command every ~30 s.

## Bootstrap a fresh session
```
git clone https://github.com/DataVallis/postaja && cd postaja && git checkout dev
corepack enable && pnpm install --frozen-lockfile
cp .env.example .env            # fill local values only
docker compose up -d            # Postgres+pgvector (5432), MinIO (9000/9001)
# or, without Docker: pip install "moto[server]==5.2.3" && moto_server -H 127.0.0.1 -p 9000  (S3 stand-in, same as CI)
pnpm db:migrate && pnpm dev     # http://localhost:3000
pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm test:e2e
```
No Docker Hub access in some agent sandboxes: run Postgres 16 + pgvector natively and set `TEST_DATABASE_URL`;
for E2E with a preinstalled Chromium set `PW_CHROMIUM_PATH`.

## Repo / environments
| Env | URL | Deploys from | Status |
|---|---|---|---|
| local | http://localhost:3000 | working tree | Built (TASK-001, merged) |
| dev | https://dev-postaja.inzenirji.si | `dev` (auto on merge) | **Live** |
| prod | https://postaja.inzenirji.si | `main` (manual) | Planned |

## Done
- 2026-10-08: **Business plan** `docs/business/BUSINESS-PLAN.sl.md` (Slovenian, owner's document): segment, offer, prices + credits, upsells, sales, automation; phase 3 tasks TASK-035…045 added to `tasks/README.md`, spec §12/§14 updated. Weekly lead-discovery scheduled task (Mondays 6:49) writes to Google Drive folder "Postaja — Prodaja". Docs only.
- 2026-10-07: TASK-023 (owner): post animations are designed by Claude and drawn by Postaja frame by frame (any image, text-only too; optional instructions; one Claude call) — replaces image-to-video for posts. Kling 3.0 is only for AI-influencer videos once personas (DNA + passport, created or imported) exist (ADR-052).
- 2026-10-07: TASK-024 (owner's DNA framework): brand tab **Persona** — DNA by hand or filled by Claude from a rough description / imported DNA; passport pictures generated (first from the whole DNA, then 3/4, profile, smile, full body with Nano Banana edit as reference model) or uploaded; primary picture (ADR-053). Next: TASK-025 persona video with Kling 3.0.
- 2026-10-07: TASK-024 follow-up (owner): the passport is one photoreal close-up with the whole DNA by Nano Banana Pro ($0.15); a new one replaces the old; fal's refusal reason is shown (ADR-054).
- 2026-10-07: TASK-025: persona video on posts of persona brands — Claude's shot → first frame from the passport (Nano Banana Pro edit) → Kling 3.0 (5/10 s) → 1080×1920 MP4; cost preview (ADR-055). Next options: subtitles/TTS for persona videos, persona in post images (spec §5.2), competitor research (needs owner decision).
- 2026-10-08: TASK-026: customer user guide (Slovenian, 9 chapters) in `docs/guides/user/sl`, in the app under Pomoč → Navodila za uporabo; every UI change updates it (ADR-056).
- 2026-10-08: TASK-027: post illustrations of persona brands show the persona (Nano Banana Pro edit from the passport; owner can switch it off on the Persona tab) (ADR-057).
- 2026-10-08: TASK-028: owners manage the team (invite, cancel, change role, remove; last owner kept; audited) on **Ekipa in paket**, which also shows plan use; plan limits (brands, members incl. invitations, AI generations per month) set in /admin and enforced (ADR-058).
- 2026-10-08: TASK-029: no-repeat for every written post (warning, close repeats need review) and the published post's link (ADR-059). E2E flakiness fixed: the file mailer now writes atomically (half-written mail files broke sign-ins in tests).
- 2026-10-08: TASK-031 (owner): persona in post images is a per-post choice ("S persono" next to Ustvari slike), the Persona tab sets the default (ADR-060). Proposed to the owner next: partner logos (e.g. Polygon) as a separate file kind, chosen per post — awaiting OK.
- 2026-10-08: TASK-032 (owner bug report): every video of a post stays until deleted — animations and persona videos side by side, delete per video, all in the ZIP (ADR-061). Owner asked whether earlier image versions should be kept too — open question.
- 2026-10-08: TASK-041 client approval link (ADR-069): brand → Objave → **Povezava za stranko** (who, days) → link shown once; the client approves or asks for changes without an account; feedback on the post and in the table; revocable.
- 2026-10-08: TASK-044: the user guide in English (same chapter URLs) and **Prenesi navodila (PDF)** on the guide page (cover, contents, page numbers, both languages). Next: TASK-041 client approval link.
- 2026-10-08: TASK-052 (owner): words on post images complement the caption instead of repeating it (checked, one retry); the plan's "Prompt za sliko" is used word for word for the first illustration (ADR-068). Owner: everything else stays as it was.
- 2026-10-08: TASK-045 AI label (ADR-067): posts showing a persona (image or video) are flagged; images carry IPTC AI metadata, videos a comment; the ZIP adds a disclosure line to the text and an "Oznaka AI" column to the day overview; the post page explains the platform's AI label switch. Next: TASK-044 English guide + PDF, TASK-041 client approval link.
- 2026-10-08: TASK-050 competitor research step 2: screenshots per competitor, *Analiziraj konkurente* (public websites read safely + screenshots → report: summary, profiles, Prevzamemo / Ne delamo with evidence, topic gaps), Da/Ne per item, owner sends accepted ones as a pending CGP draft, gaps open the ideas form. Next: TASK-051 (no-copy check; Meta Ad Library needs `META_AD_LIBRARY_TOKEN` from the owner).
- 2026-10-08: TASK-049 competitor research step 1 (ADR-066): brand → **Konkurenca**: Claude finds competitors with Anthropic web search from the CGP (suggestions with website, profiles, reason; max cost shown), keep / remove / add own. **Owner:** web search must be enabled for the Anthropic organization (an administrator turns it on in the Claude Console) or the run fails with Anthropic's reason. Next: TASK-050 collect + analyze.
- 2026-10-08: TASK-048 (owner): the published post's link ("odpri objavo") sits next to the status in the brand's post table and in Objave.
- 2026-10-08: TASK-047 (owner feedback on TASK-046): partner logos dropped like other files (several or a ZIP, name from the file, rename in place); where a design writes the partner's name (footer "CHERR.IO | Polygon") the partner's logo replaces that text (ADR-065).
- 2026-10-08: TASK-046 partner logos (owner OK, ADR-064): Brand → Datoteke → *Partnerski logotipi* (name + image); on a post (Slike) or ad (Kreative) choose *Logotip partnerja* → drawn next to the brand logo; changing it redraws for free. Next: competitor research (§4.3, needs owner's sources + Meta Ad Library token), then selling (phase 3, TASK-035…045 in the business plan).
- 2026-10-08: TASK-030 production database backups (ADR-063): nightly `pg_dump` to `postaja-backup`, 30 days, restore tested in CI, admin page *Varnostne kopije*. Off everywhere except production; the owner sets `BACKUP_ENABLED` and `BACKUP_S3_*` (names in CHEATSHEET) when production exists. Owner OK'd partner logos (TASK-046) — next.
- 2026-10-08: TASK-034 (ADR-062): ad copy and ad creatives are kept as versions ("Prejšnja besedila", "Prejšnje verzije kreativ": restore / delete). Versions remember reused illustrations (`kept`), which also fixes post image versions: restoring a word redraw brings its illustration back, deleting an older version keeps illustrations still in use. Next: partner logos (owner OK pending), then backups (prod only, stash `task-030-backups-wip`), competitor research, selling.
- 2026-10-08: TASK-033 (owner rule "nič ne izgine, če uporabnik sam ne izbriše", manifest #13, ADR-062): image versions on posts (restore / delete), re-import archives images, new passport pictures are added. Next: TASK-034 ad copy and creative versions, then partner logos (owner OK pending), then backups (prod only), competitor research, selling.
- 2026-10-07: TASK-022 animation — post page → Animacija: the image's clean illustration becomes a 5 s video (Kling 3.0 Standard on fal — owner's choice, ≈ $0.42), Postaja burns the words/logo back on with ffmpeg at the exact size; MP4 download and in the ZIPs (ADR-051). Docker image now includes ffmpeg.
- 2026-10-07: TASK-021b ad creatives — on an ad set: *Ustvari slike* (max cost shown) → per variant a brand template, short hook and illustration; one illustration per variant, every placement rendered in its exact size with text inside the safe zone (Story UI); word edits redrawn free; ZIP with copy.csv + a folder per placement (ADR-050).
- 2026-10-07: TASK-021a ads (owner chose ads after phase 1) — brand → Oglasi: an ad concept for Meta / LinkedIn / Google Display; Claude writes 3 copy variants per network within each field's limit (limits are data, `ad_networks`), one fix round, checks on save, copy.csv per network × placement × variant (ADR-049). Next: TASK-021b creatives per placement + ZIP.
- 2026-10-07: TASK-019 AI post ideas + no-repeat — brand → Objave → "Predlagaj ideje" (channel, count, from day, wish); Claude proposes topics from the CGP and pillars, ideas repeating the brand's posts of the last 180 days are replaced, close ones are flagged; ideas get the channel's free slots; ticked ones become planned posts (ADR-048).
- 2026-10-07: TASK-020 dashboard goals — "Današnji cilj po kanalih" (goal, planned, ready, published, missing, with "Ustvari" and "Predlagaj ideje"), streak per brand, spend per brand this month.
- 2026-10-07: TASK-018 LinkedIn carousel as PDF — a LinkedIn post with several images downloads as one PDF document ("Prenesi PDF karusel") and the ZIP includes `karusel.pdf`; PDF written in-house.
- 2026-10-07: Owner: post images can be corrected in words ("Kaj naj AI popravi na slikah?" → *Popravi slike*): Claude sees the current images and changes only what is asked; unchanged illustrations are reused for free, a changed picture is drawn again; the last correction is shown.
- 2026-10-07: Owner: bulk creation of a whole plan with the cost first — every bulk button opens "Pregled pred zagonom" (texts, images, AI illustrations, models, expected and at-most cost in €, month's budget, over-budget warning), then starts; a finished import has "Ustvari ves plan" (texts + images for all its posts) (ADR-047).
- 2026-10-07: Owner: the calendar hides published posts by default; a "Prikaži" filter lets him tick which statuses it shows (kept while navigating, "Privzeto" resets). Money is shown with € instead of $ (sign only, amounts unchanged).
- 2026-10-07: Fix (owner): a CHERR.IO X plan was offered AI Builders' X channel (the only X channel was suggested in a one-brand org). No more guessing across brands; the import review asks "Za kateri brand je plan" — an existing brand or "+ Nov brand" (name from the file name, language, channel handles), created right there.
- 2026-10-07: Fix (owner): a CHERR.IO X plan was offered AI Builders' X channel (the only X channel in the org). Import suggestions now follow the account (handle or brand-name word) and the brand named in the file name; the only channel is suggested only in one-brand orgs; the review shows the recognised brand and a link to add its missing channel.
- 2026-10-07: TASK-010b files from Claude — MCP `create_brand`, `add_file` (public URL downloaded by Postaja behind an SSRF guard, or base64 for small files; logo / past-post example / material / font / ZIP through the normal upload checks), `upload_link`; CGP, materials and files create the brand when it does not exist (ADR-046). Owner: refresh the Postaja connector in Claude to see the new tools.
- 2026-10-07: TASK-016 one-click download — post ZIP (text as posted, first comment, images) and day ZIP (all brands or one, folders per post, pregled.csv for Excel), streamed — PR #37. Owner: TASK-010b stays open (files from Claude next to CGP).
- 2026-10-07: New brand/org forms fill the short name (slug) from the name as you type (č→c, đ→d …; a hand-typed slug is kept); import groups without an account read "brez računa v planu" — PR #36.
- 2026-10-06: Fix: LinkedIn plan rows ended up on the Instagram channel (the import let any channel be chosen for any platform). Import rows now only go to channels of their platform (select filtered, server refuses PLATFORM_MISMATCH, old cross-platform choices ignored); "Uvozi manjkajoče" moves misplaced posts of that import to the right channel (images reset) — PR #35.
- 2026-10-06: Owner: channels can be edited (handle, language, goal, types, preset; warning when a channel language is not the brand's); an imported plan can be reopened to import rows whose channel was added later (X, LinkedIn), duplicates skipped — PR #34. Cause of aibuilders' channel saved as "sl" not found in code (validation rejects languages outside the brand); edit fixes it.
- 2026-10-06: Fix: aibuilders.si (brand EN) got Slovenian words on images — the channel kept the "sl" default and plan text was copied verbatim. Post language = channel language only if the brand has it, else the brand's first language (texts and images); Claude translates plan text into it — PR #33.
- 2026-10-06: Owner's first real brand design (aibuilders.si, 6 templates) works and he likes it. Fix: ✓ and other symbols showed as empty boxes — Noto Sans Symbols fallback font for every text — PR #32.
- 2026-10-06: Fix: every Claude call failed on dev — current models refuse forced tool use (400). Adapter uses `tool_choice: auto` + one follow-up turn; E2E stand-in now refuses forced tools; owners pick the brand's Claude model in Profil (CGP) (ADR-045) — PR #31.
- 2026-10-06: Fix: brand design still failed with an Anthropic 400 (cause unknown: only the status was kept). Postaja now records and logs Anthropic's error explanation; slot schemas sent to Claude are plain objects (no propertyNames records) — PR #30.
- 2026-10-06: Fix: brand design calls timed out after 90 s on dev (owner saw "Claude se ni odzval"); design calls now get 8 min, plan calls 3 min, and the provider status is kept on the failed version — PR #29.
- 2026-10-06: TASK-017 brand visual identity designed by Claude (replaces TASK-015's fixed layouts after owner feedback; brand tab *Vizualna podoba*, revisions in words, versions; post images planned by Claude, illustrations via fal with the brand's past posts as style reference; ADR-044) — PR #28.
- 2026-10-06: TASK-015 images (fal.ai background + brand template via Satori; brand "Slike" tab with live preview; post images with download and free text refresh; bulk image step; `FAL_KEY` wired into deploy; ADR-043) — PR #27.
- 2026-10-06: Fix logo thumbnails sticking out of their cards (owner screenshot) — PR #26, deployed. TASK-014 deployed (Deploy dev d64587e green).
- 2026-10-06: TASK-014 bulk creation (day across brands, brand range, single planned post; pg-boss workers in the web container, `RUN_WORKER=1` on dev; ADR-042) — PR #25.
- 2026-10-06: Owner added `FAL_KEY` to GitHub environment `dev` (wired into deploy in TASK-015).
- 2026-10-06: TASK-013 plan view (calendar month/week/day across brands, no-slot, history, slot editing, "Danes") — PR #24.
- 2026-10-06: TASK-012 plan import (Excel/CSV/Word/PDF → planned posts; AI names columns, values read verbatim; review + confirm; history; no duplicates; ADR-041) — PR #23. Tested locally on the owner's three real Excel plans (header fallback reads all columns correctly).
- 2026-10-06: Owner sent his real content plans (CHERR.IO X, AI Builders 30 days, inzenirji.si 100 days IG, davidtacer LinkedIn DOCX), dashboard layout references (TeleCRM) and past posts as the quality bar. Roadmap TASK-011…016 in docs/tasks/README.md. Owner: start with the new dashboard, dark default.
- 2026-10-06: TASK-011 app frame (sidebar, dark/light, UI kit, dashboard, posts/brands tables, brand tabs; ADR-040) — PR #22. TASK-009 merged (PR #21).
- 2026-10-06: TASK-009 knowledge base (PDF/Word/Excel/PowerPoint text read at upload, passages matching the brief go into the post prompt; ADR-039) — PR #21.
- 2026-10-06: Owner tried the MCP connection ("zgleda da dela"). Direction (ADR-039): posts are made only in Postaja; Claude fills the knowledge base and graphics; MCP post tools dropped.
- 2026-10-06: TASK-010a Claude → Postaja over MCP (OAuth 2.1 + `/api/mcp`, CGP drafts, `/app/connect`; ADR-038) — PR #20, deployed (Deploy dev 3223763 green).
- 2026-10-05: product spec v0.2, architecture v0.2, ADR-001…025, manifest, brand identity (logo), brand CGP template.
- 2026-10-05: Hetzner Cloud Firewall on the dev server (asisto 5432/6379/3000 were public; now closed). DNS for dev-postaja/postaja set.
- 2026-10-05: TASK-001 scaffold — PR #1 merged to `dev` (31577b9), CI green.
- 2026-10-06: TASK-008 CGP from a document (verbatim DOCX/PDF/MD/TXT import) — PR #19.
- 2026-10-06: Owner set `ANTHROPIC_API_KEY` in GitHub env `dev`. TASK-007 post generation (text) — PR #18, deployed (Deploy dev 69bcd0c green).
- 2026-10-06: Direction change (ADR-035): no AI-built CGP; owner delivers CGP + materials. TASK-006 dropped — PR #17.
- 2026-10-06: TASK-005c smart uploads (dropzone, auto-sorting, ZIP, WOFF/WOFF2, language fixes; owner feedback) — PR #16, deployed (Deploy dev a2000e6 green).
- 2026-10-05: TASK-005b part 2 (upload UI + routes) — PR #15, deployed (Deploy dev 1018a42 green).
- 2026-10-05: TASK-005b part 1 (server side: S3 storage, brand_sources/brand_assets, sniffing, fonts, sharp, tenant separation) — PR #14. Part 2 = upload UI.
- 2026-10-05: **S3 ready (owner, 19:48)**: Hetzner Object Storage, location **fsn1**, endpoint `https://fsn1.your-objectstorage.com`, bucket **`postaja-dev`** (private); secrets `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` set in GitHub environment `dev`. Owner requirement: files of each organization strictly separated.
- 2026-10-05: TASK-004b super admin edits platform rules/presets (audited) + 90-day re-verification banner — PR #13 (merged by owner).
- 2026-10-05: TASK-005a brands, versioned CGP, channels — PR #10, deployed. Fix: platform sources/notes visible in /admin/platform — PR #11, deployed.
- 2026-10-05: TASK-004 platform rules + presets + rule engine — PR #9, deployed.
- 2026-10-05: TASK-003c admin — PR #8, deployed; owner created **Data Vallis** (comped) and is its owner.
- 2026-10-05: owner confirmed DEPLOY_DEV_ENABLED=true, asisto OK, 8080 closed. TASK-003b organizations — PR #7, auto-deployed.
- 2026-10-05: TASK-003a magic-link sign-in — PR #6, auto-deployed (run 37338983187); owner signed in as super admin, SMTP mail arrived instantly, not spam.
- 2026-10-05: ADR-027 (dev behind host nginx) — PR #4. First deploy: Deploy dev run 37334467728 (setup=true) green; health ok with SHA 8445e2d.

## Owner's open actions
1. **Import your plans on dev** (after PR #23 deploys): each brand needs its channels first (Brandi → brand → Kanali). Then Uvoz planov → drop the Excel/Word plan → check "Kam gredo objave" (pick the channel where none is preselected), the start day for "+N" plans → Uvozi. Objave shows them in plan order; already posted rows are history.
2. **New dashboard on dev**: owner approved ("super je").
3. **Knowledge base on dev** (after PR #21 deploys): a brand → "Datoteke branda": each document shows "N znakov besedila" (older uploads are read on the next post). Ask for a post about something that is only in a PDF/Excel/PowerPoint and check the facts are used.
4. **Connect Claude on dev** (done 2026-10-06, works): https://dev-postaja.inzenirji.si/app/connect → copy the URL → Claude: Settings → Connectors → add a custom connector named Postaja with that URL → Connect → sign in with your email (open the mail link in the same browser) → Dovoli. Then in a Claude conversation: "Pošlji ta CGP v Postajo za brand <slug>". The brand page shows "Claude je predlagal CGP" → Vstavi v urejevalnik → Shrani novo verzijo.
5. **Try CGP import on dev** (after PR #19 deploys): a brand → Profil (CGP) → "Uvozi iz dokumenta" → your CGP as Word or PDF → the text appears in the field → "Shrani novo verzijo".
6. **Try post generation on dev** (after PR #18 deploys): a brand with a CGP and an Instagram channel → section "Objave" → write a request → "Ustvari objavo". Expect a post in a few seconds with status "pripravljena" or "za pregled" and a cost line. If it says the AI key is not set, check the secret name `ANTHROPIC_API_KEY` in environment `dev`.
7. **Check uploads on dev** (after PR #16 deploys): https://dev-postaja.inzenirji.si/app/brands → a brand → "Datoteke branda": drop a ZIP (or files) with a logo named `logo…`, a font (WOFF2 is fine) and a PDF; the log shows where each went, the logo shows as a picture, the PDF downloads. If the upload fails with an S3 addressing error, tell the agent (fix: `S3_FORCE_PATH_STYLE=1`).
8. Swap 2 GB (TASK-002 Step B) — optional.
9. Rollback drill once: `kamal app containers -d dev` → `kamal rollback <previous> -d dev` (closes TASK-002).

## Parked ideas
- Showcase on aibuilders.si as a "built with vibe coding" case.

## Next
**Direction (ADR-035, owner 2026-10-06):** Postaja creates posts and ads from the owner's CGP + uploaded materials; it never writes the CGP. TASK-006 (AI CGP ingestion) is dropped.
Owner's choices (2026-10-06): **next = post generation** (TASK-007: CGP + materials + rules → post text → rule check → one auto-fix → `needs_review`); CGP delivered **both** by pasting and by uploading a document copied verbatim (TASK-008, small).
Owner (2026-10-06): Claude feeds Postaja over MCP (ADR-038); **posts are made only in Postaja, Claude fills the knowledge base and graphics** (ADR-039). Owner (2026-10-06, with real plan files): Postaja must plan, import any plan file (AI sorts it), create texts, images and hashtags, show tables/calendar/history, download in one click, and create in bulk per brand or for all brands of a day. Order: TASK-011 frame (PR #22, done) → TASK-012 plan import (PR #23, done) → TASK-013 plan view (PR #24, done) → TASK-014 bulk (PR #25) → TASK-013 plan/calendar/history → TASK-014 bulk → TASK-015 images (`FAL_KEY` set by owner) → TASK-016 download. Owner (2026-10-06): no locked templates — each brand's look is designed by Claude from its own inputs (TASK-017, ADR-044); everything runs inside Postaja. TASK-010b (files from Claude) done 2026-10-07. Bulk plan with cost preview done 2026-10-07 (ADR-047).
**Owner's order (2026-10-08):** 1) before the first customer: owner invites members + plan limits (TASK-028), no-repeat for posts + published URL (TASK-029), production database backups to bucket `postaja-backup` at `fsn1.your-objectstorage.com` — **production data only, never dev** (TASK-030); 2) competitor research (§4.3); 3) everything needed to sell to others (phase 3: landing, self-serve signup, Stripe, …); 4) last: subtitles and voice in persona videos. English guide and PDF export of the guide: any time in between.
**Selling (2026-10-08):** business plan `docs/business/BUSINESS-PLAN.sl.md`; phase 3 = TASK-035…045 (planned). Before TASK-035/036 the owner decides prices, payment provider (MoR vs Stripe) and domain (plan §15).
Latest numbers: TASK-052 (last done TASK-041; TASK-051, TASK-035…040, 042, 043 planned), ADR-069. Latest PR: see git log.

## Servers
- dev: Hetzner VM 91.99.191.8, user `deploy`, 4 vCPU / 8 GB / 80 GB. Shared: asisto (docker compose + host nginx today; must keep running) and later volil.si (ADR-025). Edge: host nginx (80/443, certbot) → kamal-proxy on 127.0.0.1:8080 for Kamal apps (ADR-027). asisto = Laravel on host PHP-FPM + docker compose API; not migrated. Hetzner Cloud Firewall: 22/80/443 only.

## Open items
- ADR-008 embedding provider (Open).
- Default fal models per post type — test round after TASK-006.
