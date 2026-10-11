# Technical docs — maintenance map

| Chapter | Covers code | Status |
|---|---|---|
| [app-skeleton.md](app-skeleton.md) | `src/app/**`, `src/i18n/**`, `messages/**`, `src/instrumentation.ts`, `src/server/db/**`, `src/server/health/**`, `drizzle/**`, `Dockerfile`, `.github/workflows/**`, `config/deploy*.yml`, `.kamal/**`, `ops/nginx/**` | Live on dev |
| [backups.md](backups.md) | `src/server/backup/**`, `src/app/admin/backups/**` | Built (needs prod) |
| [competitors.md](competitors.md) | `src/server/competitors/**`, `src/app/app/brands/[id]/competitors-section.tsx`, `src/app/app/brands/competitor-actions.ts`, `src/server/db/schema/competitors.ts`, web search in `src/server/llm/**` | Built (step 1) |
| [reviews.md](reviews.md) | `src/server/reviews/**`, `src/app/r/**`, `src/app/app/brands/approval-*.ts(x)`, `src/app/app/brands/[id]/approval-section.tsx`, `src/server/db/schema/reviews.ts` | Built |
| [demos.md](demos.md) | `src/server/demos/**`, `src/app/admin/demos/**`, `src/app/d/**`, `src/server/db/schema/demos.ts` | Built |
| [credits.md](credits.md) | `src/server/credits/**`, `src/server/llm/spend.ts`, `src/app/admin/credits/**`, `src/app/app/team/**`, `src/app/app/credit-banner.tsx`, `src/server/db/schema/credits.ts` | Built |
| [billing.md](billing.md) | `src/server/billing/**`, `src/app/api/stripe/**`, `src/app/admin/billing/**`, `src/app/app/team/billing-section.tsx`, `src/server/db/schema/billing.ts` | Built |
| [auth.md](auth.md) | `src/server/auth/**`, `src/server/email/**`, `src/server/db/schema/auth.ts`, `src/app/api/auth/**`, `src/app/login/**`, `src/app/app/**` | Built |
| [tenancy.md](tenancy.md) | `src/server/tenancy/**`, `src/server/orgs/**`, `src/server/db/schema/org.ts`, `src/server/auth/permissions.ts`, `tests/tenancy/**` | Live on dev |
| [admin.md](admin.md) | `src/app/admin/**`, `src/server/admin/**`, `src/server/db/schema/audit.ts`, `src/lib/money/**` | Live on dev |
| [rules.md](rules.md) | `src/lib/rules/**`, `src/server/rules/**`, `src/server/db/schema/platform.ts`, `drizzle/0005_seed_platform_data.sql`, `src/app/admin/platform/**` | Live on dev |
| [brand-files.md](brand-files.md) | `src/server/brands/files.ts`, `src/server/brands/files-http.ts`, `src/app/api/brands/**`, `src/app/api/brand-files/**`, `src/app/app/brands/upload-form.tsx`, `src/app/app/brands/[id]/files-section.tsx`, `src/server/files/**`, `src/server/db/schema/brand-files.ts`, `drizzle/0007_brand_files.sql`, `tests/fixtures/files.ts` | Built |
| [posts.md](posts.md) | `src/server/posts/**`, `src/server/llm/**`, `src/server/db/schema/generation.ts`, `drizzle/0008_generation.sql`, `drizzle/0009_seed_model_registry.sql`, `src/app/app/posts/**`, `src/app/app/brands/[id]/posts-section.tsx`, `tests/e2e/mock-anthropic.mjs` | Built |
| [brands.md](brands.md) | `src/server/brands/**`, `src/server/files/extract.ts`, `src/app/app/brands/cgp-import.tsx`, `src/app/api/brands/[id]/cgp-import/**`, `src/server/db/schema/brands.ts`, `src/app/app/**`, `src/server/auth/require.ts` | Live on dev |
| [ui.md](ui.md) | `src/components/**`, `src/lib/theme.ts`, `src/app/globals.css`, `src/app/app/layout.tsx`, `src/app/admin/layout.tsx`, `src/app/app/page.tsx`, `src/app/app/posts/page.tsx`, `src/app/app/brands/page.tsx`, `src/server/posts/overview.ts` | Built |
| [plans.md](plans.md) | `src/server/plans/**`, `src/app/app/import/**`, `src/app/api/imports/**`, `src/server/db/schema/plans.ts`, `drizzle/0013_plan_imports.sql`, post plan fields in `src/server/db/schema/generation.ts` | Built |
| [plan-view.md](plan-view.md) | `src/app/app/plan/**`, `src/server/posts/calendar.ts`, `src/lib/dates/**`, slot form in `src/app/app/posts/[id]/page.tsx` | Built |
| [bulk.md](bulk.md) | `src/server/bulk/**`, `src/server/jobs/**`, `src/instrumentation*.ts`, `generateForPost`/`planBrief` in `src/server/posts/generate.ts`, `src/app/app/plan/{actions,bulk-runs,auto-refresh}.tsx`, `drizzle/0014_bulk_runs.sql` | Built |
| [mcp.md](mcp.md) | `src/server/mcp/**`, `src/app/api/mcp/**`, `src/app/api/well-known/**`, `src/app/connect/**`, `src/app/app/connect/**`, `src/server/db/schema/{oauth,mcp}.ts`, `drizzle/0010…0012`, OAuth part of `src/server/auth/auth.ts`, `next.config.ts` rewrite | Built |
| [help.md](help.md) | `docs/guides/user/**`, `src/server/guide/**`, `src/components/guide/**`, `src/app/app/help/**` | Built |

Every PR that changes covered code updates the chapter in the same PR.
