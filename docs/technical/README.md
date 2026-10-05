# Technical docs — maintenance map

| Chapter | Covers code | Status |
|---|---|---|
| [app-skeleton.md](app-skeleton.md) | `src/app/**`, `src/i18n/**`, `messages/**`, `src/instrumentation.ts`, `src/server/db/**`, `src/server/health/**`, `drizzle/**`, `Dockerfile`, `.github/workflows/**`, `config/deploy*.yml`, `.kamal/**`, `ops/nginx/**` | Live on dev |
| [auth.md](auth.md) | `src/server/auth/**`, `src/server/email/**`, `src/server/db/schema/auth.ts`, `src/app/api/auth/**`, `src/app/login/**`, `src/app/app/**` | Built |

Every PR that changes covered code updates the chapter in the same PR.
