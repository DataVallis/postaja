# Handoff — state as of 2026-10-06

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
- 2026-10-06: TASK-010a Claude → Postaja over MCP (OAuth 2.1 + `/api/mcp`, CGP drafts, `/app/connect`; ADR-038) — PR #20.
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
1. **Connect Claude on dev** (after PR #20 deploys): https://dev-postaja.inzenirji.si/app/connect → copy the URL → Claude: Settings → Connectors → add a custom connector named Postaja with that URL → Connect → sign in with your email (open the mail link in the same browser) → Dovoli. Then in a Claude conversation: "Pošlji ta CGP v Postajo za brand <slug>". The brand page shows "Claude je predlagal CGP" → Vstavi v urejevalnik → Shrani novo verzijo.
2. **Try CGP import on dev** (after PR #19 deploys): a brand → Profil (CGP) → "Uvozi iz dokumenta" → your CGP as Word or PDF → the text appears in the field → "Shrani novo verzijo".
3. **Try post generation on dev** (after PR #18 deploys): a brand with a CGP and an Instagram channel → section "Objave" → write a request → "Ustvari objavo". Expect a post in a few seconds with status "pripravljena" or "za pregled" and a cost line. If it says the AI key is not set, check the secret name `ANTHROPIC_API_KEY` in environment `dev`.
4. **Check uploads on dev** (after PR #16 deploys): https://dev-postaja.inzenirji.si/app/brands → a brand → "Datoteke branda": drop a ZIP (or files) with a logo named `logo…`, a font (WOFF2 is fine) and a PDF; the log shows where each went, the logo shows as a picture, the PDF downloads. If the upload fails with an S3 addressing error, tell the agent (fix: `S3_FORCE_PATH_STYLE=1`).
5. Swap 2 GB (TASK-002 Step B) — optional.
6. Rollback drill once: `kamal app containers -d dev` → `kamal rollback <previous> -d dev` (closes TASK-002).

## Parked ideas
- Showcase on aibuilders.si as a "built with vibe coding" case.

## Next
**Direction (ADR-035, owner 2026-10-06):** Postaja creates posts and ads from the owner's CGP + uploaded materials; it never writes the CGP. TASK-006 (AI CGP ingestion) is dropped.
Owner's choices (2026-10-06): **next = post generation** (TASK-007: CGP + materials + rules → post text → rule check → one auto-fix → `needs_review`); CGP delivered **both** by pasting and by uploading a document copied verbatim (TASK-008, small).
Owner idea (2026-10-06): Claude conversations/projects feed Postaja → **Claude pushes to Postaja's MCP server** (ADR-038). TASK-010a in review (PR #20).
Next: TASK-010b MCP post tools (`create_post`, `list_posts`, `set_post_status`), TASK-009 material text for generation (reuses `extract.ts`), then images/carousels (worker + fal).
Latest numbers: TASK-010b, ADR-038. Latest PR: #20.

## Servers
- dev: Hetzner VM 91.99.191.8, user `deploy`, 4 vCPU / 8 GB / 80 GB. Shared: asisto (docker compose + host nginx today; must keep running) and later volil.si (ADR-025). Edge: host nginx (80/443, certbot) → kamal-proxy on 127.0.0.1:8080 for Kamal apps (ADR-027). asisto = Laravel on host PHP-FPM + docker compose API; not migrated. Hetzner Cloud Firewall: 22/80/443 only.

## Open items
- ADR-008 embedding provider (Open).
- Default fal models per post type — test round after TASK-006.
