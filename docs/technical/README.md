# Technical docs — maintenance map

| Chapter | Covers code | Status |
|---|---|---|
| [app-skeleton.md](app-skeleton.md) | `src/app/**`, `src/i18n/**`, `messages/**`, `src/instrumentation.ts`, `src/server/db/**`, `src/server/health/**`, `drizzle/**`, `Dockerfile`, `.github/workflows/**`, `config/deploy*.yml`, `.kamal/**`, `ops/nginx/**` | Live on dev |
| [auth.md](auth.md) | `src/server/auth/**`, `src/server/email/**`, `src/server/db/schema/auth.ts`, `src/app/api/auth/**`, `src/app/login/**`, `src/app/app/**` | Built |
| [tenancy.md](tenancy.md) | `src/server/tenancy/**`, `src/server/orgs/**`, `src/server/db/schema/org.ts`, `src/server/auth/permissions.ts`, `tests/tenancy/**` | Live on dev |
| [admin.md](admin.md) | `src/app/admin/**`, `src/server/admin/**`, `src/server/db/schema/audit.ts`, `src/lib/money/**` | Live on dev |
| [rules.md](rules.md) | `src/lib/rules/**`, `src/server/rules/**`, `src/server/db/schema/platform.ts`, `drizzle/0005_seed_platform_data.sql`, `src/app/admin/platform/**` | Live on dev |
| [brand-files.md](brand-files.md) | `src/server/brands/files.ts`, `src/server/files/**`, `src/server/db/schema/brand-files.ts`, `drizzle/0007_brand_files.sql`, `tests/fixtures/files.ts` | Built |
| [brands.md](brands.md) | `src/server/brands/**`, `src/server/db/schema/brands.ts`, `src/app/app/**`, `src/server/auth/require.ts` | Live on dev |

Every PR that changes covered code updates the chapter in the same PR.
