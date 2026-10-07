# Handoff — state as of 2026-10-07

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
Owner (2026-10-06): Claude feeds Postaja over MCP (ADR-038); **posts are made only in Postaja, Claude fills the knowledge base and graphics** (ADR-039). Owner (2026-10-06, with real plan files): Postaja must plan, import any plan file (AI sorts it), create texts, images and hashtags, show tables/calendar/history, download in one click, and create in bulk per brand or for all brands of a day. Order: TASK-011 frame (PR #22, done) → TASK-012 plan import (PR #23, done) → TASK-013 plan view (PR #24, done) → TASK-014 bulk (PR #25) → TASK-013 plan/calendar/history → TASK-014 bulk → TASK-015 images (`FAL_KEY` set by owner) → TASK-016 download. Owner (2026-10-06): no locked templates — each brand's look is designed by Claude from its own inputs (TASK-017, ADR-044); everything runs inside Postaja. TASK-010b (files from Claude) done 2026-10-07. Next agreed: bulk creation of a whole brand plan (texts + images) with a cost estimate first.
Latest numbers: TASK-017, ADR-045. Latest PR: #37.

## Servers
- dev: Hetzner VM 91.99.191.8, user `deploy`, 4 vCPU / 8 GB / 80 GB. Shared: asisto (docker compose + host nginx today; must keep running) and later volil.si (ADR-025). Edge: host nginx (80/443, certbot) → kamal-proxy on 127.0.0.1:8080 for Kamal apps (ADR-027). asisto = Laravel on host PHP-FPM + docker compose API; not migrated. Hetzner Cloud Firewall: 22/80/443 only.

## Open items
- ADR-008 embedding provider (Open).
- Default fal models per post type — test round after TASK-006.
